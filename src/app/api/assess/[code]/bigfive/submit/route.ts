import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase-server'
import bigfiveTestJson from '@/data/bigfive-test.json'
import { scoreBigFive } from '@/lib/bigfive-scoring'
import type { BigFiveAnswers, BigFiveTestJson } from '@/types/bigfive'

const JSON_DATA = bigfiveTestJson as unknown as BigFiveTestJson

// POST /api/assess/[code]/bigfive/submit
// body: { submission_id, answers }
// 完成作答 → 計分 → 標記 completed → 回傳分數
export async function POST(request: Request) {
  let body: { submission_id?: string; answers?: BigFiveAnswers }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  const id = (body.submission_id || '').trim()
  if (!id) return NextResponse.json({ error: '缺少 submission_id' }, { status: 400 })
  if (!body.answers) return NextResponse.json({ error: '缺少 answers' }, { status: 400 })

  // 檢查每題都有作答
  const missing = JSON_DATA.items.filter(it => body.answers![it.id] == null).map(it => it.id)
  if (missing.length > 0) {
    return NextResponse.json({ error: `尚有 ${missing.length} 題未作答` }, { status: 400 })
  }

  const scores = scoreBigFive(JSON_DATA, body.answers)

  const admin = createServiceRoleClient()
  const { error } = await admin
    .from('assessment_submissions')
    .update({
      bigfive_answers: body.answers,
      bigfive_scores: scores,
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'in_progress')

  if (error) return NextResponse.json({ error: '提交失敗：' + error.message }, { status: 500 })
  return NextResponse.json({ success: true, scores })
}
