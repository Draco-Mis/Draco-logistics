import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'

// 列出某個活動下所有已生成的 Big Five AI artifact（配對 + 團隊化學作用）
// 給 admin/assessments/[id] 頁面用：使用者重新進來時就能看見歷史分析清單，
// 點一筆即可載入內容，不必再重選一次成員 + 重新生成。
export async function GET(request: Request) {
  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: '未登入' }, { status: 401 })
  const { data: profile } = await supa.from('users').select('role, team, is_active').eq('id', authUser.id).single()
  const allowed = !!profile && profile.is_active !== false && (
    ['admin', 'director', 'hr'].includes(profile.role) || profile.team === '財管部'
  )
  if (!allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 })

  const url = new URL(request.url)
  const eventId = (url.searchParams.get('event_id') || '').trim()
  if (!eventId) return NextResponse.json({ error: '缺少 event_id' }, { status: 400 })

  const admin = createServiceRoleClient()

  // team 直接用 event_id 篩；pair 用 submission_ids 在 event 內的成員交集
  // 簡化：先撈該 event 底下所有 submission ids，再用 .overlaps 篩 pair
  const { data: subs, error: subsErr } = await admin
    .from('assessment_submissions')
    .select('id')
    .eq('event_id', eventId)
  if (subsErr) console.error('[bigfive/artifacts] 查詢 submissions 失敗:', subsErr.message)
  const subIds = ((subs || []) as Array<{ id: string }>).map(s => s.id)

  // team artifacts
  const { data: teamRows, error: teamErr } = await admin
    .from('bigfive_ai_artifacts')
    .select('id, artifact_type, profile, meta, submission_ids, created_at')
    .eq('artifact_type', 'team_chemistry')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
  if (teamErr) console.error('[bigfive/artifacts] 查詢 team 歷史失敗（可能是 migration 034 未套用）:', teamErr.message)

  // pair artifacts：用 submission_ids @> 或 && 篩選 — 只要兩位都在此 event 就視為相關
  let pairRows: Array<{
    id: string; artifact_type: string; profile: string;
    meta: { a?: { name: string }; b?: { name: string } } | null;
    submission_ids: string[]; created_at: string;
  }> = []
  if (subIds.length >= 2) {
    const { data, error: pairErr } = await admin
      .from('bigfive_ai_artifacts')
      .select('id, artifact_type, profile, meta, submission_ids, created_at')
      .eq('artifact_type', 'pair')
      .overlaps('submission_ids', subIds)
      .order('created_at', { ascending: false })
    if (pairErr) console.error('[bigfive/artifacts] 查詢 pair 歷史失敗（可能是 migration 034 未套用）:', pairErr.message)
    // 還要再過濾：必須兩位都在 subIds 裡才算這個 event 的配對
    pairRows = ((data || []) as typeof pairRows).filter(r =>
      Array.isArray(r.submission_ids) && r.submission_ids.length === 2 &&
      r.submission_ids.every(id => subIds.includes(id))
    )
  }

  return NextResponse.json({
    team: teamRows || [],
    pair: pairRows,
  })
}
