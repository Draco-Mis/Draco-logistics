import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'
import logicTestJson from '@/data/logic-test.json'
import { scoreLogicTest } from '@/lib/logic-test-scoring'
import type { LogicTestJson, LogicAnswers, LogicTestVersion, AssessmentEvent } from '@/types/logic-test'

const JSON_DATA = logicTestJson as unknown as LogicTestJson

// POST /api/admin/assessments/submission/answers
// body: { id, logic_answers }
// HR 修正受測者的選項並自動重新計分
export async function POST(request: Request) {
  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: '未登入' }, { status: 401 })
  const { data: profile } = await supa.from('users').select('role, team, is_active').eq('id', authUser.id).single()
  const allowed = !!profile && profile.is_active !== false && (
    ['admin', 'director', 'hr'].includes(profile.role) || profile.team === '財管部'
  )
  if (!allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 })

  let body: { id?: string; logic_answers?: LogicAnswers }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  const id = (body.id || '').trim()
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })
  if (!body.logic_answers || typeof body.logic_answers !== 'object') {
    return NextResponse.json({ error: '缺少 logic_answers' }, { status: 400 })
  }

  const admin = createServiceRoleClient()

  // 拉出原本的 submission 取得 event_id + version
  const { data: sub, error: subErr } = await admin
    .from('assessment_submissions')
    .select('id, event_id, version, status')
    .eq('id', id)
    .single()
  if (subErr || !sub) return NextResponse.json({ error: '找不到該紀錄' }, { status: 404 })
  if (sub.status !== 'completed') {
    return NextResponse.json({ error: '此紀錄尚未完成，無法修改' }, { status: 400 })
  }

  // 拉出活動 code
  const { data: ev } = await admin
    .from('assessment_events')
    .select('code')
    .eq('id', sub.event_id)
    .single()
  if (!ev) return NextResponse.json({ error: '找不到對應活動' }, { status: 404 })

  // 重新計分
  const newScores = scoreLogicTest(JSON_DATA, ev.code, sub.version as LogicTestVersion, body.logic_answers)

  // 寫回（保留原本的 ai_profile，HR 想換時可手動點重新生成）
  const { error: updErr } = await admin
    .from('assessment_submissions')
    .update({
      logic_answers: body.logic_answers,
      logic_scores: newScores,
    })
    .eq('id', id)
  if (updErr) return NextResponse.json({ error: '更新失敗：' + updErr.message }, { status: 500 })

  return NextResponse.json({ success: true, logic_scores: newScores })
}
