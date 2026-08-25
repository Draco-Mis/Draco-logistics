import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase-server'
import logicTestJson from '@/data/logic-test.json'
import { scoreLogicTest } from '@/lib/logic-test-scoring'
import { computeBenchmark } from '@/lib/logic-test-benchmark'
import type { LogicTestJson, LogicAnswers, LogicScores, LogicTestVersion } from '@/types/logic-test'

const JSON_DATA = logicTestJson as unknown as LogicTestJson

// POST /api/assess/[code]/submit
// body: { submission_id, answers }
// 流程：驗 submission 屬於此 code → 驗 20 題答完 → server 計分 → 寫 completed
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

  // 驗證 submission 存在 + status=in_progress + 屬於此 code
  const { data: sub } = await admin
    .from('assessment_submissions')
    .select('id, status, version, event_id, respondent_name, department, assessment_events!event_id(code, is_active, deadline)')
    .eq('id', submissionId)
    .maybeSingle()
  if (!sub) return NextResponse.json({ error: '找不到作答紀錄' }, { status: 404 })
  if (sub.status !== 'in_progress') {
    return NextResponse.json({ error: '此測驗已完成，無法重複送出' }, { status: 409 })
  }
  const ev = (sub as { assessment_events?: { code: string; is_active: boolean; deadline: string | null } }).assessment_events
  if (!ev || ev.code !== params.code) {
    return NextResponse.json({ error: '連結與作答紀錄不符' }, { status: 400 })
  }
  if (!ev.is_active) return NextResponse.json({ error: '此測驗已停用' }, { status: 410 })
  if (ev.deadline && new Date(ev.deadline) < new Date()) {
    return NextResponse.json({ error: '此測驗已截止' }, { status: 410 })
  }

  // 確認 20 題全部有答 + 範圍 0-3
  for (const item of JSON_DATA.items) {
    const v = answers[item.id]
    if (!Number.isInteger(v) || v < 0 || v > 3) {
      return NextResponse.json({ error: '尚未完成所有題目' }, { status: 400 })
    }
  }

  // 計分
  const scores = scoreLogicTest(JSON_DATA, params.code, sub.version as LogicTestVersion, answers)

  // 再次防重複：可能有人在 in_progress 期間另一個瀏覽器已送出
  // partial unique index 會擋第二筆 completed，這裡先檢查給友善訊息
  const { data: alreadyCompleted } = await admin
    .from('assessment_submissions')
    .select('id')
    .eq('event_id', sub.event_id)
    .eq('respondent_name', sub.respondent_name)
    .eq('department', sub.department)
    .eq('status', 'completed')
    .maybeSingle()
  if (alreadyCompleted) {
    return NextResponse.json({ error: '此姓名+部門已有完成的紀錄' }, { status: 409 })
  }

  const { error: updErr } = await admin
    .from('assessment_submissions')
    .update({
      status: 'completed',
      logic_answers: answers,
      logic_scores: scores,
      completed_at: new Date().toISOString(),
    })
    .eq('id', submissionId)

  if (updErr) return NextResponse.json({ error: '送出失敗：' + updErr.message }, { status: 500 })

  // 算對照基準（已包含本次提交，因為剛 update 為 completed）
  // N < 3 時不回傳，避免反推到個別員工分數
  const { data: allCompleted } = await admin
    .from('assessment_submissions')
    .select('department, logic_scores')
    .eq('event_id', sub.event_id)
    .eq('status', 'completed')
  const benchmark = computeBenchmark(
    (allCompleted ?? []) as { department: string; logic_scores: LogicScores | null }[],
    sub.department
  )

  return NextResponse.json({ success: true, scores, benchmark })
}
