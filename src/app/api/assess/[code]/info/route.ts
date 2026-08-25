import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase-server'
import { computeBenchmark } from '@/lib/logic-test-benchmark'
import type { LogicBenchmark, LogicScores } from '@/types/logic-test'

// GET /api/assess/[code]/info?submission_id=...
// 回傳活動狀態與（如有 submission_id）目前作答狀態
// 公開：無需登入
export async function GET(request: Request, { params }: { params: { code: string } }) {
  const admin = createServiceRoleClient()
  const code = params.code

  const { data: event } = await admin
    .from('assessment_events')
    .select('*')
    .eq('code', code)
    .maybeSingle()

  if (!event) {
    return NextResponse.json({ error: '找不到此測驗連結' }, { status: 404 })
  }

  const expired = event.deadline && new Date(event.deadline) < new Date()
  const ended = !event.is_active || expired

  const submissionId = new URL(request.url).searchParams.get('submission_id')
  let submission = null
  let benchmark: LogicBenchmark | null = null
  if (submissionId) {
    const { data } = await admin
      .from('assessment_submissions')
      .select('*')
      .eq('id', submissionId)
      .eq('event_id', event.id)
      .maybeSingle()
    if (data) {
      submission = data
      // 重訪已完成連結時，補上對照基準（N>=3 才會回傳）
      if (data.status === 'completed' && data.logic_scores) {
        const { data: allCompleted } = await admin
          .from('assessment_submissions')
          .select('department, logic_scores')
          .eq('event_id', event.id)
          .eq('status', 'completed')
        benchmark = computeBenchmark(
          (allCompleted ?? []) as { department: string; logic_scores: LogicScores | null }[],
          data.department
        )
      }
    }
  }

  return NextResponse.json({
    event: {
      id: event.id,
      code: event.code,
      name: event.name,
      deadline: event.deadline,
      is_active: event.is_active,
      test_types: event.test_types || ['logic'],
    },
    ended,
    submission,
    benchmark,
  })
}
