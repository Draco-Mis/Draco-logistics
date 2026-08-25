import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'
import type { BigFiveScores, BigFiveDimension } from '@/types/bigfive'

const DIM_KEYS: BigFiveDimension[] = ['E', 'A', 'C', 'N', 'O']

// GET /api/admin/bigfive/job-profiles/match?submission_id=...
// 計算指定受測者對所有 job profile 的 fit score（0-100）
// 演算法：對每個維度，距離理想值越近 fit 越高，依 weights 加權
export async function GET(request: Request) {
  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: '未登入' }, { status: 401 })
  const { data: profile } = await supa.from('users').select('role, team, is_active').eq('id', authUser.id).single()
  const allowed = !!profile && profile.is_active !== false && (
    ['admin', 'chairman', 'director', 'hr'].includes(profile.role) || profile.team === '財管部'
  )
  if (!allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const submissionId = (searchParams.get('submission_id') || '').trim()
  if (!submissionId) return NextResponse.json({ error: '缺少 submission_id' }, { status: 400 })

  const admin = createServiceRoleClient()
  const { data: sub } = await admin
    .from('assessment_submissions')
    .select('bigfive_scores')
    .eq('id', submissionId)
    .maybeSingle()
  if (!sub || !sub.bigfive_scores) return NextResponse.json({ error: '該紀錄尚無 Big Five 分數' }, { status: 404 })

  const { data: profiles } = await admin
    .from('bigfive_job_profiles')
    .select('id, name, description, ideal, weights')
    .order('name', { ascending: true })
  if (!profiles) return NextResponse.json({ matches: [] })

  const scores = sub.bigfive_scores as BigFiveScores
  const matches = (profiles as Array<{
    id: string; name: string; description: string | null;
    ideal: Record<string, number>; weights: Record<string, number> | null;
  }>).map(p => {
    let totalWeight = 0
    let totalScore = 0
    const dimBreakdown: Array<{ dim: BigFiveDimension; you: number; ideal: number; fit: number; weight: number }> = []
    for (const k of DIM_KEYS) {
      const you = scores.dimensions[k]?.pct ?? 0
      const ideal = p.ideal[k] ?? 50
      const weight = p.weights?.[k] ?? 1
      // 距離 0 = 完美吻合；距離越大 fit 越低。100 是最大可能距離
      const dist = Math.abs(you - ideal)
      const dimFit = Math.max(0, 100 - dist * 1.5)  // 容差線性遞減
      totalWeight += weight
      totalScore += dimFit * weight
      dimBreakdown.push({ dim: k, you, ideal, fit: Math.round(dimFit), weight })
    }
    const overallFit = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      fit: overallFit,
      breakdown: dimBreakdown,
    }
  })
  matches.sort((a, b) => b.fit - a.fit)

  return NextResponse.json({ matches })
}
