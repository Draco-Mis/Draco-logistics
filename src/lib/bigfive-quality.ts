// Big Five 作答品質檢測：偵測 response bias / 反向題矛盾 / 過快交卷
import type { BigFiveAnswers, BigFiveTestJson } from '@/types/bigfive'

export interface QualityFlags {
  // 反應集中度（standard deviation of answers across 5-point scale）
  // 過低 → 受測者可能都選同一格（如全部選 3）
  stdDev: number
  isLowVariance: boolean

  // 反向題一致性：與同維度正向題的「方向相關性」
  // 若反向題作答跟正向題作答方向一致（沒反向），代表受測者沒看清題目
  reverseConsistency: number  // 0-100 分數，越高越一致
  isReverseInconsistent: boolean

  // 連續同分長串：找出最長的一段「連續選同一格」
  longestRun: number
  hasLongRun: boolean

  // 是否疑似草率作答（綜合警示）
  hasQualityConcerns: boolean
  // 警示說明
  warnings: string[]
}

export function detectBigFiveQuality(
  json: BigFiveTestJson,
  answers: BigFiveAnswers,
  durationMs?: number,
): QualityFlags {
  const values: number[] = []
  for (const it of json.items) {
    const v = answers[it.id]
    if (v != null) values.push(v)
  }
  if (values.length === 0) {
    return {
      stdDev: 0, isLowVariance: true,
      reverseConsistency: 0, isReverseInconsistent: true,
      longestRun: 0, hasLongRun: false,
      hasQualityConcerns: true,
      warnings: ['沒有作答資料'],
    }
  }

  // 1. 標準差
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  const stdDev = Math.sqrt(variance)
  // 5 點量表的理想隨機分布 std ~= 1.4；過低 (<0.6) 代表大部分選同一格
  const isLowVariance = stdDev < 0.7

  // 2. 反向題一致性：對於每個維度，計算正向題平均 vs 反向題的「反轉後」平均，差距應小
  //    若差距大代表受測者沒看清反向題（兩者方向同步而非相反）
  const dimGroups: Record<string, { normal: number[]; reverse: number[] }> = {}
  for (const it of json.items) {
    const v = answers[it.id]
    if (v == null) continue
    if (!dimGroups[it.dimension]) dimGroups[it.dimension] = { normal: [], reverse: [] }
    if (it.reverse) dimGroups[it.dimension].reverse.push(v)
    else dimGroups[it.dimension].normal.push(v)
  }
  const dimDiffs: number[] = []
  for (const k of Object.keys(dimGroups)) {
    const { normal, reverse } = dimGroups[k]
    if (normal.length === 0 || reverse.length === 0) continue
    const avgN = normal.reduce((a, b) => a + b, 0) / normal.length
    const avgR_inverted = (6 - reverse.reduce((a, b) => a + b, 0) / reverse.length)
    // avgN 跟 inverted reverse 應該接近（如果作答用心）
    dimDiffs.push(Math.abs(avgN - avgR_inverted))
  }
  const avgDiff = dimDiffs.length > 0 ? dimDiffs.reduce((a, b) => a + b, 0) / dimDiffs.length : 0
  // 差距 0 = 完美一致；差距越大越糟。換成 0-100 一致性分數
  // 4 是 5 點量表最大可能差距
  const reverseConsistency = Math.max(0, Math.round((1 - avgDiff / 4) * 100))
  const isReverseInconsistent = reverseConsistency < 60

  // 3. 連續同分（用 items 的原始順序）
  let longestRun = 1
  let currentRun = 1
  for (let i = 1; i < values.length; i++) {
    if (values[i] === values[i - 1]) {
      currentRun += 1
      if (currentRun > longestRun) longestRun = currentRun
    } else {
      currentRun = 1
    }
  }
  const hasLongRun = longestRun >= 10  // 連續 10 題以上同分視為警示

  // 綜合警示
  const warnings: string[] = []
  if (isLowVariance) warnings.push(`回應變化度低（標準差 ${stdDev.toFixed(2)}，多數題目選同一格）`)
  if (isReverseInconsistent) warnings.push(`反向題一致性偏低（${reverseConsistency}%，可能沒看清反向題目）`)
  if (hasLongRun) warnings.push(`連續 ${longestRun} 題選同一格`)
  if (durationMs != null && durationMs < 60 * 1000) {
    warnings.push(`作答時間僅 ${Math.round(durationMs / 1000)} 秒（過快）`)
  }

  return {
    stdDev: Number(stdDev.toFixed(2)),
    isLowVariance,
    reverseConsistency,
    isReverseInconsistent,
    longestRun,
    hasLongRun,
    hasQualityConcerns: warnings.length > 0,
    warnings,
  }
}
