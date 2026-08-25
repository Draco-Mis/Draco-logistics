import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase-server'
import type { LogicAnswers } from '@/types/logic-test'

// POST /api/assess/[code]/save
// body: { submission_id, answers }
// 暫存（status 維持 in_progress）
export async function POST(request: Request, { params }: { params: { code: string } }) {
  const admin = createServiceRoleClient()

  let body: { submission_id?: string; answers?: LogicAnswers }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  const submissionId = body.submission_id
  const answers = body.answers
  if (!submissionId || !answers || typeof answers !== 'object') {
    return NextResponse.json({ error: '缺少 submission_id 或 answers' }, { status: 400 })
  }

  // 驗證 submission 存在 + status=in_progress + 屬於這個 code 的活動
  const { data: sub } = await admin
    .from('assessment_submissions')
    .select('id, status, event_id, assessment_events!event_id(code)')
    .eq('id', submissionId)
    .maybeSingle()
  if (!sub) return NextResponse.json({ error: '找不到作答紀錄' }, { status: 404 })
  if (sub.status !== 'in_progress') {
    return NextResponse.json({ error: '此測驗已完成，無法再修改' }, { status: 409 })
  }
  const eventCode = (sub as { assessment_events?: { code: string } }).assessment_events?.code
  if (eventCode !== params.code) {
    return NextResponse.json({ error: '連結與作答紀錄不符' }, { status: 400 })
  }

  const { error } = await admin
    .from('assessment_submissions')
    .update({ logic_answers: answers })
    .eq('id', submissionId)

  if (error) return NextResponse.json({ error: '儲存失敗：' + error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
