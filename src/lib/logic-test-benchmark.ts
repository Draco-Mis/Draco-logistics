import type { AssessmentSubmission, LogicBenchmark, LogicScores } from '@/types/logic-test'

const MIN_N = 3

interface SubLike {
  department: string
  logic_scores: LogicScores | null
}

function avgPctByCategory(subs: SubLike[]): Record<string, number> {
  const sums: Record<string, { sum: number; n: number }> = {}
  for (const s of subs) {
    const cats = s.logic_scores?.categories
    if (!cats) continue
    for (const [k, v] of Object.entries(cats)) {
      if (v.max <= 0) continue
      const pct = (v.score / v.max) * 100
      if (!sums[k]) sums[k] = { sum: 0, n: 0 }
      sums[k].sum += pct
      sums[k].n++
    }
  }
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(sums)) {
    out[k] = v.n > 0 ? Math.round(v.sum / v.n) : 0
  }
  return out
}

export function computeBenchmark(
  allCompleted: SubLike[],
  departmentName: string,
  opts: { requireMinN?: boolean } = {}
): LogicBenchmark | null {
  const requireMinN = opts.requireMinN ?? true
  const completed = allCompleted.filter(s => s.logic_scores != null)
  if (requireMinN && completed.length < MIN_N) return null
  if (completed.length === 0) return null

  const overall = {
    n: completed.length,
    avgPctByCategory: avgPctByCategory(completed),
  }

  const deptSubs = completed.filter(s => s.department === departmentName)
  const deptOk = requireMinN ? deptSubs.length >= MIN_N : deptSubs.length > 0
  const dept = deptOk
    ? {
        name: departmentName,
        n: deptSubs.length,
        avgPctByCategory: avgPctByCategory(deptSubs),
      }
    : undefined

  return { overall, dept }
}

// 給 admin 用：直接從 AssessmentSubmission[] 計算（沒有 N>=3 限制）
export function computeBenchmarkForAdmin(
  subs: AssessmentSubmission[],
  departmentName: string
): LogicBenchmark | null {
  return computeBenchmark(subs, departmentName, { requireMinN: false })
}
