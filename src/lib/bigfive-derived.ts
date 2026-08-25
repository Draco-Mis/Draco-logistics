// Big Five 衍生分析：從五大維度推導的規則映射（無 AI 成本）
// - 人格原型卡
// - 壓力反應預測
// - 決策風格雷達
// - 風險偏好分數
// - 學習偏好分類
import type { BigFiveScores } from '@/types/bigfive'

type Dims = BigFiveScores['dimensions']

const isHigh = (v: number) => v >= 65
const isLow = (v: number) => v <= 35
const isMidHigh = (v: number) => v >= 50

// ============================================================
// 1. 人格原型卡（12 種）
// ============================================================
export interface PersonalityArchetype {
  key: string
  name: string
  emoji: string
  short: string
}

export function deriveArchetype(d: Dims): PersonalityArchetype {
  const e = d.E.pct, a = d.A.pct, c = d.C.pct, n = d.N.pct, o = d.O.pct

  // 依組合模式優先 match（極端組合先判斷）
  if (isHigh(e) && isHigh(c) && isHigh(a)) {
    return { key: 'executive_leader', name: '執行型領導者', emoji: '👑',
      short: '充滿幹勁、目標明確、與人為善。能帶領團隊一起達標、用熱情感染他人。' }
  }
  if (isHigh(e) && isHigh(c) && isLow(a)) {
    return { key: 'commander', name: '果斷指揮官', emoji: '⚡',
      short: '行動快、要求高、敢於做不討好的決定。在需要強推進度的場合最具價值。' }
  }
  if (isHigh(e) && isLow(c) && isHigh(a)) {
    return { key: 'connector', name: '熱情串聯者', emoji: '🤝',
      short: '社交能量充沛、樂於連結人與資源。是 BD 業務、社群活動的天然好手。' }
  }
  if (isLow(e) && isHigh(c) && isHigh(a)) {
    return { key: 'steady_executor', name: '沈穩執行者', emoji: '🏗',
      short: '低調可靠、把事情做完做好。是組織的基石，能讓系統穩定運轉。' }
  }
  if (isLow(e) && isHigh(c) && isLow(a)) {
    return { key: 'perfectionist', name: '完美主義專家', emoji: '🔬',
      short: '獨立、要求精準、對品質敏感。在需要專業深度的工作上發揮極致。' }
  }
  if (isHigh(o) && isLow(c)) {
    return { key: 'creative_explorer', name: '創意探索者', emoji: '💡',
      short: '點子源源不絕、不喜歡被框架綁住。在新領域開拓、創新發想上表現亮眼。' }
  }
  if (isLow(o) && isHigh(c)) {
    return { key: 'guardian', name: '守護穩定者', emoji: '🛡️',
      short: '尊重既有流程、紀律強。能維護組織的穩定性與可預測性。' }
  }
  if (isHigh(a) && isLow(e)) {
    return { key: 'harmonizer', name: '同理協調者', emoji: '🕊',
      short: '善於聆聽與化解衝突，是團隊裡的潤滑劑。在需要 mediation 的場合特別重要。' }
  }
  if (isLow(e) && isLow(a) && isHigh(o)) {
    return { key: 'independent_thinker', name: '獨立思考者', emoji: '🦉',
      short: '深度思考、不從眾、敢提反對意見。是組織中防止 group-think 的關鍵角色。' }
  }
  if (isLow(n) && !isHigh(e) && !isLow(e)) {
    return { key: 'calm_anchor', name: '抗壓守備員', emoji: '🪨',
      short: '情緒穩定、抗壓強。危機處理時不慌亂，能讓團隊心安。' }
  }
  if (isHigh(n) && isHigh(o)) {
    return { key: 'sensitive_observer', name: '敏銳觀察者', emoji: '🔍',
      short: '對細節與情緒敏感、想得深。在品質把關、UX 設計、研究分析上特別出色。' }
  }
  if (isHigh(e) && isHigh(o)) {
    return { key: 'visionary', name: '願景傳道者', emoji: '🚀',
      short: '充滿想像力 + 喜歡分享。能描繪未來藍圖並激勵他人共同前進。' }
  }
  // 預設：平衡多面手
  return { key: 'balanced', name: '平衡多面手', emoji: '⚖️',
    short: '五大維度均衡、無明顯極端。適應力高，能在多種職務中發揮一定水準。' }
}

// ============================================================
// 2. 壓力反應預測（4 種情境）
// ============================================================
export interface StressResponse {
  type: string
  emoji: string
  score: number      // 0-100，越高代表越能扛得住這類壓力
  label: string      // 5 級：強項 / 穩定 / 中等 / 須留意 / 弱項
  rank: 'best' | 'worst' | 'normal'  // 相對於該人其他三項的位置
  note: string       // 一句話建議
}

function stressLabel(score: number): string {
  if (score >= 75) return '強項'
  if (score >= 60) return '穩定'
  if (score >= 45) return '中等'
  if (score >= 30) return '須留意'
  return '弱項'
}

export function deriveStressResponse(d: Dims): StressResponse[] {
  const e = d.E.pct, a = d.A.pct, c = d.C.pct, n = d.N.pct, o = d.O.pct

  // 加大主導維度的權重，讓四個壓力情境的分數彼此差距更明顯
  // 1. 截止期限：主要看 C，次要看 N
  const deadline = Math.round(c * 0.7 + (100 - n) * 0.3)
  // 2. 人際衝突：主要看 A，次要看 N
  const interpersonal = Math.round(a * 0.55 + (100 - n) * 0.35 + Math.min(e, 60) * 0.1)
  // 3. 變動環境：主要看 O，次要看 N
  const change = Math.round(o * 0.6 + (100 - n) * 0.4)
  // 4. 不確定性：主要看 N（情緒穩定）+ O
  const ambiguity = Math.round((100 - n) * 0.55 + o * 0.3 + c * 0.15)

  const clamp = (v: number) => Math.max(0, Math.min(100, v))
  const items = [
    { type: '截止期限', emoji: '⏰', rawScore: clamp(deadline) },
    { type: '人際衝突', emoji: '💬', rawScore: clamp(interpersonal) },
    { type: '變動環境', emoji: '🌪', rawScore: clamp(change) },
    { type: '不確定性', emoji: '❓', rawScore: clamp(ambiguity) },
  ]

  // 找出該人 4 項中的最高最低（差距 > 5 分才標示，避免幾乎一樣時誤導）
  const maxScore = Math.max(...items.map(i => i.rawScore))
  const minScore = Math.min(...items.map(i => i.rawScore))
  const spread = maxScore - minScore

  function buildNote(type: string, score: number, rank: 'best' | 'worst' | 'normal'): string {
    const base: Record<string, [string, string, string]> = {
      // [強項/穩定, 中等, 須留意/弱項]
      '截止期限': ['能在期限前主動推進、自我節奏穩', '在 deadline 前需要適度提醒與里程碑檢核', '建議拆分小目標 + 提早預警節點，並由主管輕度推進'],
      '人際衝突': ['能在衝突中保持冷靜並引導對話', '需先冷靜再回應，避免被情緒帶走', '建議由中介者緩衝，盡量避免一對一直接對立'],
      '變動環境': ['能主動擁抱變化、快速調整步調', '需要清楚的變動理由與時程才能跟上', '建議先給穩定預告，分階段過渡而非突變'],
      '不確定性': ['能在資訊不全下做出合理判斷', '需要部分依據才願意下決定', '建議提供結構化決策框架與階段性驗證'],
    }
    const triplet = base[type] || ['', '', '']
    const tier = score >= 60 ? 0 : score >= 45 ? 1 : 2
    const note = triplet[tier]
    if (rank === 'best') return '★ 你在四項壓力中最強的一項。' + note
    if (rank === 'worst') return '⚠ 你在四項壓力中相對最弱的一項，建議多加練習：' + note
    return note
  }

  return items.map(it => {
    const rank: 'best' | 'worst' | 'normal' =
      spread >= 5 && it.rawScore === maxScore ? 'best'
      : spread >= 5 && it.rawScore === minScore ? 'worst'
      : 'normal'
    return {
      type: it.type,
      emoji: it.emoji,
      score: it.rawScore,
      label: stressLabel(it.rawScore),
      rank,
      note: buildNote(it.type, it.rawScore, rank),
    }
  })
}

// ============================================================
// 3. 決策風格雷達（4 軸）
// ============================================================
export interface DecisionStyle {
  axes: Array<{ name: string; left: string; right: string; position: number }>
}

export function deriveDecisionStyle(d: Dims): DecisionStyle {
  const e = d.E.pct, a = d.A.pct, c = d.C.pct, n = d.N.pct, o = d.O.pct
  // position 0-100，0 = 左端，100 = 右端
  return {
    axes: [
      // 分析 vs 直覺：高 O 偏直覺，高 C 偏分析
      { name: '思考模式', left: '分析', right: '直覺',
        position: Math.round((o * 0.6 + (100 - c) * 0.4)) },
      // 快速 vs 審慎：高 N + 高 C 偏審慎
      { name: '決策速度', left: '快速', right: '審慎',
        position: Math.round((c * 0.5 + n * 0.5)) },
      // 獨立 vs 共識：高 E + 高 A 偏共識
      { name: '參與方式', left: '獨立', right: '共識',
        position: Math.round((e * 0.5 + a * 0.5)) },
      // 保守 vs 冒險：高 O + 低 N 偏冒險
      { name: '風險態度', left: '保守', right: '冒險',
        position: Math.round((o * 0.6 + (100 - n) * 0.4)) },
    ],
  }
}

// ============================================================
// 4. 風險偏好分數
// ============================================================
export interface RiskProfile {
  score: number  // 0-100，越高越偏冒險
  label: string  // '高風險偏好' / '中度' / '保守'
  note: string
}

export function deriveRiskProfile(d: Dims): RiskProfile {
  const n = d.N.pct, o = d.O.pct
  const score = Math.round((o * 0.6 + (100 - n) * 0.4))
  let label = '中度'
  let note = '在保守與冒險之間能依情境調整'
  if (score >= 70) { label = '高風險偏好'; note = '勇於嘗試新方法，但需要 sanity check 避免冒進' }
  else if (score <= 35) { label = '偏保守'; note = '重視穩定與可預測性，新挑戰需要清楚的成功路徑' }
  return { score, label, note }
}

// ============================================================
// 5. 學習偏好分類（3 軸）
// ============================================================
export interface LearningStyle {
  structure: { position: number; left: string; right: string }   // 結構化 vs 自學
  social: { position: number; left: string; right: string }      // 獨自 vs 社交
  modality: { position: number; left: string; right: string }    // 實作 vs 理論
}

export function deriveLearningStyle(d: Dims): LearningStyle {
  const e = d.E.pct, c = d.C.pct, o = d.O.pct
  return {
    structure: { left: '結構化', right: '自學', position: Math.round(o * 0.6 + (100 - c) * 0.4) },
    social: { left: '獨自', right: '社交', position: Math.round(e) },
    modality: { left: '實作', right: '理論', position: Math.round(o * 0.5 + (100 - e) * 0.5) },
  }
}

// ============================================================
// 6. 簡易公司內常模（z-score）— 給足夠樣本時用
// ============================================================
export interface NormalizedScore {
  raw: number
  zScore: number | null
  percentile: number | null  // 0-100
}

export function computeNorms(
  scores: Dims,
  groupAvgs?: Record<string, { avg: number; std: number }>,
): Record<string, NormalizedScore> | null {
  if (!groupAvgs) return null
  const out: Record<string, NormalizedScore> = {}
  for (const key of Object.keys(scores)) {
    const me = scores[key as keyof Dims].pct
    const meta = groupAvgs[key]
    if (!meta || meta.std === 0) {
      out[key] = { raw: me, zScore: null, percentile: null }
      continue
    }
    const z = (me - meta.avg) / meta.std
    // 用累積標準常態分布近似（Hastings approximation）
    const p = z >= 0
      ? 100 * (1 - 0.5 * Math.exp(-Math.abs(z) * 1.5957))
      : 100 * (0.5 * Math.exp(-Math.abs(z) * 1.5957))
    out[key] = { raw: me, zScore: Number(z.toFixed(2)), percentile: Math.round(p) }
  }
  return out
}
