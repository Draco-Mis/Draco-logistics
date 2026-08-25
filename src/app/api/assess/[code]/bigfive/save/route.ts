import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase-server'
import type { BigFiveAnswers } from '@/types/bigfive'

// POST /api/assess/[code]/bigfive/save
// body: { submission_id, answers: { BF01: 3, ... } }
// 自動暫存
export async function POST(request: Request) {
  let body: { submission_id?: string; answers?: BigFiveAnswers }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  const id = (body.submission_id || '').trim()
  if (!id) return NextResponse.json({ error: '缺少 submission_id' }, { status: 400 })
  if (!body.answers || typeof body.answers !== 'object') {
    return NextResponse.json({ error: '缺少 answers' }, { status: 400 })
  }

  const admin = createServiceRoleClient()
  const { error } = await admin
    .from('assessment_submissions')
    .update({ bigfive_answers: body.answers })
    .eq('id', id)
    .eq('status', 'in_progress')

  if (error) return NextResponse.json({ error: '暫存失敗：' + error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
