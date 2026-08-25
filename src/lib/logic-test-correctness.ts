// 給 AI 性向分析 prompt 用：依答題資料計算每題的對錯狀態
import type { LogicAnswers, LogicTestJson, LogicTestVersion } from '@/types/logic-test'
import { shuffleForVersion } from './logic-test-shuffle'

export interface ItemCorrectness {
  id: string
  category: string
  difficulty: string
  question: string
  correct: boolean
  unanswered: boolean
}

/**
 * 依 (eventCode, version) 還原洗牌結果，計算每一題的對錯。
 * 用於組 prompt 給 Claude，讓它知道受測者具體哪些題目錯了。
 */
export function computeItemCorrectness(
  json: LogicTestJson,
  eventCode: string,
  version: LogicTestVersion,
  answers: LogicAnswers,
): ItemCorrectness[] {
  const { optionPerms } = shuffleForVersion(eventCode, version, json.items)
  return json.items.map(item => {
    const shuffledPick = answers[item.id]
    if (shuffledPick == null || shuffledPick < 0 || shuffledPick > 3) {
      return {
        id: item.id,
        category: item.category,
        difficulty: item.difficulty,
        question: item.question,
        correct: false,
        unanswered: true,
      }
    }
    const perm = optionPerms[item.id]
    if (!perm) {
      return {
        id: item.id,
        category: item.category,
        difficulty: item.difficulty,
        question: item.question,
        correct: false,
        unanswered: false,
      }
    }
    const originalPick = perm.perm[shuffledPick]
    return {
      id: item.id,
      category: item.category,
      difficulty: item.difficulty,
      question: item.question,
      correct: originalPick === item.answer,
      unanswered: false,
    }
  })
}
