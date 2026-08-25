// Big Five (BFI-44) 計分
import type {
  BigFiveTestJson, BigFiveAnswers, BigFiveScores,
  BigFiveDimension, BigFiveLevel, BigFiveDimensionScore,
} from '@/types/bigfive'

function levelFromPct(pct: number): BigFiveLevel {
  if (pct >= 80) return '高'
  if (pct >= 65) return '中高'
  if (pct >= 45) return '中'
  if (pct >= 30) return '中低'
  return '低'
}

export function scoreBigFive(
  json: BigFiveTestJson,
  answers: BigFiveAnswers,
): BigFiveScores {
  const dims: Record<string, { sum: number; count: number }> = {}
  for (const key of Object.keys(json.dimensions)) {
    dims[key] = { sum: 0, count: 0 }
  }

  for (const item of json.items) {
    const raw = answers[item.id]
    if (raw == null) continue
    // 反向題：6 - 原始分數（1↔5, 2↔4, 3↔3）
    const score = item.reverse ? 6 - raw : raw
    dims[item.dimension].sum += score
    dims[item.dimension].count += 1
  }

  const dimensions = {} as Record<BigFiveDimension, BigFiveDimensionScore>
  for (const key of Object.keys(dims) as BigFiveDimension[]) {
    const { sum, count } = dims[key]
    const max = count * 5
    const pct = max > 0 ? Math.round((sum / max) * 100) : 0
    dimensions[key] = {
      raw: sum,
      max,
      pct,
      level: levelFromPct(pct),
    }
  }

  return {
    dimensions,
    completed_at: new Date().toISOString(),
  }
}
