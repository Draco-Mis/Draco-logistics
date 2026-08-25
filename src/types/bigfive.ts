// Big Five (BFI-44) 人格特質測驗型別
export type BigFiveDimension = 'O' | 'C' | 'E' | 'A' | 'N'
// O = Openness 開放性
// C = Conscientiousness 盡責性
// E = Extraversion 外向性
// A = Agreeableness 親和性
// N = Neuroticism 神經質

export interface BigFiveItem {
  id: string                // BF01, BF02, ...
  dimension: BigFiveDimension
  reverse: boolean          // 反向題
  statement: string         // 「我認為自己是個...」後接的描述
}

export interface BigFiveTestJson {
  meta: {
    name: string
    version: string
    total_items: number
    estimated_minutes: number
    likert_labels: string[]  // 5 點量表標籤（從不同意到同意）
  }
  dimensions: Record<BigFiveDimension, {
    label: string            // 中文：開放性 / 盡責性 / ...
    short_desc: string       // 一句話描述
    high_desc: string        // 高分人格描述
    low_desc: string         // 低分人格描述
  }>
  items: BigFiveItem[]
}

// 作答：{ "BF01": 1-5 (Likert), ... }
export type BigFiveAnswers = Record<string, number>

export type BigFiveLevel = '高' | '中高' | '中' | '中低' | '低'

export interface BigFiveDimensionScore {
  raw: number          // 該維度題目總分（反向題已倒轉）
  max: number          // 該維度最高分
  pct: number          // 百分比（raw / max * 100）
  level: BigFiveLevel
}

export interface BigFiveScores {
  dimensions: Record<BigFiveDimension, BigFiveDimensionScore>
  completed_at: string
}
