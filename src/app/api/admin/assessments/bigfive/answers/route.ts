import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'
import bigfiveTestJson from '@/data/bigfive-test.json'
import { scoreBigFive } from '@/lib/bigfive-scoring'
import type { BigFiveAnswers, BigFiveTestJson } from '@/types/bigfive'

const JSON_DATA = bigfiveTestJson as unknown as BigFiveTestJson

// POST /api/admin/assessments/bigfive/answers
// body: { id, bigfive_answers }
// HR 修正受測者的 Big Five 作答並自動重新計分
export async function POST(request: Request) {
  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: '未登入' }, { status: 401 })
  const { data: profile } = await supa.from('users').select('role, team, is_active').eq('id', authUser.id).single()
  const allowed = !!profile && profile.is_active !== false && (
    ['admin', 'director', 'hr'].includes(profile.role) || profile.team === '財管部'
  )
  if (!allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 })

  let body: { id?: string; bigfive_answers?: BigFiveAnswers }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  const id = (body.id || '').trim()
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })
  if (!body.bigfive_answers || typeof body.bigfive_answers !== 'object') {
    return NextResponse.json({ error: '缺少 bigfive_answers' }, { status: 400 })
  }

  const admin = createServiceRoleClient()
  const { data: sub, error: subErr } = await admin
    .from('assessment_submissions')
    .select('id, status')
    .eq('id', id)
    .single()
  if (subErr || !sub) return NextResponse.json({ error: '找不到該紀錄' }, { status: 404 })
  if (sub.status !== 'completed') {
    return NextResponse.json({ error: '此紀錄尚未完成，無法修改' }, { status: 400 })
  }

  const newScores = scoreBigFive(JSON_DATA, body.bigfive_answers)

  const { error: updErr } = await admin
    .from('assessment_submissions')
    .update({
      bigfive_answers: body.bigfive_answers,
      bigfive_scores: newScores,
    })
    .eq('id', id)
  if (updErr) return NextResponse.json({ error: '更新失敗：' + updErr.message }, { status: 500 })

  return NextResponse.json({ success: true, bigfive_scores: newScores })
}
