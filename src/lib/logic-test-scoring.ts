// 後端計分：給 /api/assess/[code]/submit 用
import type {
  LogicTestJson,
  LogicAnswers,
  LogicScores,
  LogicTestLevel,
  CategoryScore,
  LogicTestVersion,
} from '@/types/logic-test'
import { shuffleForVersion, shuffledIndexToOriginal } from './logic-test-shuffle'

function levelFromPct(pct: number, levels: LogicTestJson['scoring']['levels']): LogicTestLevel {
  // levels 已從高到低排序：80 → 60 → 40 → 0
  for (const l of levels) {
    if (pct >= l.min_pct) return l.label
  }
  return '待加強'
}

/**
 * 依照 (eventCode, version) 重建選項排序，反推使用者每題的「原始答案 index」並比對。
 * answers 的 value 是「使用者點到的打亂後 index」。
 */
export function scoreLogicTest(
  json: LogicTestJson,
  eventCode: string,
  version: LogicTestVersion,
  answers: LogicAnswers,
): LogicScores {
  const { optionPerms } = shuffleForVersion(eventCode, version, json.items)

  // 各類別 max & score
  const catTotals: Record<string, { score: number; max: number }> = {}
  for (const key of Object.keys(json.categories)) {
    catTotals[key] = { score: 0, max: json.categories[key].count }
  }

  let totalScore = 0
  for (const item of json.items) {
    const shuffledPick = answers[item.id]
    if (shuffledPick == null) continue
    const perm = optionPerms[item.id]
    if (!perm) continue
    const originalPick = shuffledIndexToOriginal(shuffledPick, perm)
    if (originalPick === item.answer) {
      catTotals[item.category].score += 1
      totalScore += 1
    }
  }

  const totalMax = json.items.length
  const totalPct = Math.round((totalScore / totalMax) * 100)
  const categoryLevels = json.scoring.levels
  const totalLevels = json.scoring.total_levels ?? categoryLevels

  const categories = {} as Record<string, CategoryScore>
  for (const [key, t] of Object.entries(catTotals)) {
    const pct = Math.round((t.score / t.max) * 100)
    categories[key] = { score: t.score, max: t.max, level: levelFromPct(pct, categoryLevels) }
  }

  return {
    total: { score: totalScore, max: totalMax, pct: totalPct, level: levelFromPct(totalPct, totalLevels) },
    categories,
  }
}
