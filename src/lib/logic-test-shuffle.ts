// 依據 (event_code, version) 推導出題序與每題選項的順序
// server 與 client 都會用這份邏輯，確保「使用者看到的順序」與「server 用來計分的順序」一致
import { mulberry32, seedFromString, seededShuffle } from './seeded-random'
import type { LogicItem, LogicTestVersion } from '@/types/logic-test'

export interface OptionPerm {
  // shuffledIndex → originalIndex
  // 例如 [2, 0, 3, 1] 代表「打亂後第 0 格 = 原始第 2 格」
  perm: number[]
}

export interface ShuffleResult {
  itemOrder: LogicItem[]                       // 題目順序（已打亂）
  optionPerms: Record<string, OptionPerm>      // itemId → 該題的選項打亂表
  // 給 client 顯示用的形狀
  shuffledItems: {
    id: string
    category: string
    difficulty: string
    question: string
    options: string[]   // 已重新排序的選項文字
  }[]
}

export function shuffleForVersion(
  eventCode: string,
  version: LogicTestVersion,
  allItems: LogicItem[],
): ShuffleResult {
  // 1. 題序打亂
  const seedQ = seedFromString(`${eventCode}:${version}:Q`)
  const itemOrder = seededShuffle(allItems, mulberry32(seedQ))

  // 2. 每題選項打亂
  const optionPerms: Record<string, OptionPerm> = {}
  const shuffledItems = itemOrder.map(item => {
    const seedO = seedFromString(`${eventCode}:${version}:O:${item.id}`)
    const rand = mulberry32(seedO)
    const indices = item.options.map((_, i) => i)
    const perm = seededShuffle(indices, rand)
    optionPerms[item.id] = { perm }
    return {
      id: item.id,
      category: item.category,
      difficulty: item.difficulty,
      question: item.question,
      options: perm.map(originalIdx => item.options[originalIdx]),
    }
  })

  return { itemOrder, optionPerms, shuffledItems }
}

/**
 * 將「使用者點到的打亂後索引」轉回「原始選項索引」。
 * 例：原始正確答案是 index 2；perm 是 [2, 0, 3, 1]，
 *      則打亂後 index 0 對應原始 2（=正解）。
 */
export function shuffledIndexToOriginal(shuffledIndex: number, perm: OptionPerm): number {
  return perm.perm[shuffledIndex]
}
