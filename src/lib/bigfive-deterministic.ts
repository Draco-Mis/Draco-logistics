// Big Five 確定性分析引擎
// 從五大維度推導所有結論（強項/弱點/激勵/回饋/職涯/領導風格/練習...），
// 同一人輸入永遠產生同一結論。AI 只負責用這些結論寫敘述
import type { BigFiveScores, BigFiveDimension } from '@/types/bigfive'
import { deriveArchetype, deriveStressResponse, deriveDecisionStyle, deriveRiskProfile } from './bigfive-derived'

type Dims = BigFiveScores['dimensions']
const isHigh = (v: number) => v >= 65
const isMid = (v: number) => v >= 45 && v < 65
const isLow = (v: number) => v < 45
const isVeryHigh = (v: number) => v >= 75
const isVeryLow = (v: number) => v < 30

export type Viewpoint = 'manager' | 'staff'

export interface DetAnalysis {
  // 強項（最高的 2-3 個維度）
  strengths: Array<{ dim: BigFiveDimension | 'low_N'; label: string; behavior: string }>
  // 弱點（1-2 個需注意的維度）
  weaknesses: Array<{ dim: BigFiveDimension | 'high_N'; label: string; behavior: string }>
  // 激勵驅動因子（從 6 個挑 2-3）
  motivations: Array<{ key: string; label: string; why: string; manager_action: string }>
  // 回饋風格四維
  feedback: { tone: '直接' | '鋪墊'; setting: '公開' | '私下'; timing: '即時' | '定期'; medium: '口頭' | '書面'; bad_example: string }
  // 適合的職涯/角色方向（3 個）
  careers: Array<{ title: string; why: string }>
  // 領導風格（manager 視角）/ 工作風格（staff 視角）
  primary_style: { name: string; description: string }
  // 協作配對
  collab: { best_with: string; friction_with: string; friction_reason: string; common_misread: string; adjust_actions: string[] }
  // 暗影（強項過度發揮的副作用）
  shadow: { strength: string; becomes: string }
  // 刻意練習
  practice: { behavior: string; why_hard: string; trigger_situations: string[]; tomorrow_action: string }
}

export function analyzeDeterministic(scores: BigFiveScores, viewpoint: Viewpoint): DetAnalysis {
  const d = scores.dimensions
  const E = d.E.pct, A = d.A.pct, C = d.C.pct, N = d.N.pct, O = d.O.pct

  // === 1. 強項 ===
  const strengthCandidates: Array<{ dim: BigFiveDimension | 'low_N'; score: number; label: string; behavior: string }> = []
  if (isHigh(E)) strengthCandidates.push({ dim: 'E', score: E, label: '社交能量與激勵力', behavior: '在會議或團體中能主動發聲、感染他人情緒、推動討論前進' })
  if (isHigh(A)) strengthCandidates.push({ dim: 'A', score: A, label: '同理心與協調力', behavior: '能聆聽不同立場、化解衝突、團隊裡的潤滑劑' })
  if (isHigh(C)) strengthCandidates.push({ dim: 'C', score: C, label: '紀律與執行可靠度', behavior: '事情交給他不用催、會自己訂節點推進、品質有保證' })
  if (isHigh(O)) strengthCandidates.push({ dim: 'O', score: O, label: '創新思考與好奇心', behavior: '能跳出框架想新作法、樂於嘗試新工具/方法、跨領域學習快' })
  if (isLow(N)) strengthCandidates.push({ dim: 'low_N', score: 100 - N, label: '情緒穩定與抗壓', behavior: '壓力下不慌、客訴或衝突時能保持理性溝通、危機處理冷靜' })
  if (strengthCandidates.length === 0) {
    // 平均型：取相對最高的 2 個
    const sorted = [
      { dim: 'E' as const, score: E, label: '社交能量', behavior: '能適度主動交流' },
      { dim: 'A' as const, score: A, label: '同理心', behavior: '能配合團隊節奏' },
      { dim: 'C' as const, score: C, label: '執行可靠度', behavior: '能按交辦完成任務' },
      { dim: 'O' as const, score: O, label: '開放心態', behavior: '對新事物有基本接受度' },
      { dim: 'low_N' as const, score: 100 - N, label: '情緒穩定', behavior: '一般情況不易過度情緒化' },
    ].sort((a, b) => b.score - a.score)
    strengthCandidates.push(sorted[0], sorted[1])
  }
  const strengths = strengthCandidates.sort((a, b) => b.score - a.score).slice(0, 3)

  // === 2. 弱點 ===
  const weaknessCandidates: Array<{ dim: BigFiveDimension | 'high_N'; score: number; label: string; behavior: string }> = []
  if (isLow(C)) weaknessCandidates.push({ dim: 'C', score: 100 - C, label: '紀律與收尾力較弱', behavior: '容易拖延、流程不嚴謹、deadline 前才趕工' })
  if (isLow(A)) weaknessCandidates.push({ dim: 'A', score: 100 - A, label: '人際細膩度需留意', behavior: '直率易被誤解為冷漠、給回饋方式可能傷到團隊感受' })
  if (isHigh(N)) weaknessCandidates.push({ dim: 'high_N', score: N, label: '情緒敏感容易內耗', behavior: '壓力下易焦慮、被質疑時情緒反應較大、需要恢復時間' })
  if (isLow(O)) weaknessCandidates.push({ dim: 'O', score: 100 - O, label: '彈性與創新意願較低', behavior: '習慣既有做法、面對新工具或變化需要較多時間適應' })
  if (isLow(E)) weaknessCandidates.push({ dim: 'E', score: 100 - E, label: '主動發聲較少', behavior: '會議中傾向觀察而非發言、想法不容易被看見、人脈拓展慢' })
  // 若無明顯弱點，挑相對最弱的 1 個
  if (weaknessCandidates.length === 0) {
    const sorted = [
      { dim: 'C' as const, score: 100 - C, label: '紀律可再加強', behavior: '偶爾會有 deadline 壓力' },
      { dim: 'A' as const, score: 100 - A, label: '溝通可更細膩', behavior: '回饋方式偶爾偏直接' },
      { dim: 'high_N' as const, score: N, label: '壓力反應較明顯', behavior: '面對重大壓力時需要時間' },
      { dim: 'O' as const, score: 100 - O, label: '對新事物可更開放', behavior: '改變需要清楚理由' },
      { dim: 'E' as const, score: 100 - E, label: '主動發聲可加強', behavior: '習慣先觀察再行動' },
    ].sort((a, b) => b.score - a.score)
    weaknessCandidates.push(sorted[0])
  }
  const weaknesses = weaknessCandidates.sort((a, b) => b.score - a.score).slice(0, 2)

  // === 3. 激勵驅動因子 ===
  const motivationScores: Record<string, { score: number; label: string; why: string; manager_action: string }> = {
    autonomy: { score: (100 - A) * 0.4 + (100 - N) * 0.3 + O * 0.3, label: '自主性',
      why: '不喜歡被微管理、希望有自己的決策空間', manager_action: '給目標而非步驟，定期 check-in 不過度盯細節' },
    mastery: { score: O * 0.5 + C * 0.5, label: '精熟感',
      why: '在意做到「真正會」、追求技藝精進', manager_action: '給挑戰性技術任務 + 半年內可見的成長路徑' },
    purpose: { score: A * 0.5 + O * 0.3 + (100 - N) * 0.2, label: '目的感',
      why: '希望工作對團隊/組織/社會有貢獻', manager_action: '說明任務的「why」連結到組織目標，讓他看到自己的貢獻' },
    recognition: { score: E * 0.6 + N * 0.4, label: '被認可',
      why: '需要看見自己的成果被注意到', manager_action: '及時、具體的口頭/書面肯定，公開讚許他的具體貢獻' },
    safety: { score: C * 0.4 + (100 - O) * 0.3 + N * 0.3, label: '安全感',
      why: '需要清楚的規範、預期、穩定的環境', manager_action: '給清楚的 SOP、可預期的工作節奏、明確的角色定位' },
    connection: { score: E * 0.5 + A * 0.5, label: '連結感',
      why: '與同事的關係品質會直接影響工作投入', manager_action: '安排團隊活動、建立 1-on-1 信任、不要把他孤立起來' },
  }
  const motivations = Object.entries(motivationScores)
    .map(([key, m]) => ({ key, ...m }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ score, ...rest }) => { void score; return rest })

  // === 4. 回饋風格四維 ===
  const feedback = {
    tone: (isHigh(A) || isHigh(N) ? '鋪墊' : '直接') as '直接' | '鋪墊',
    setting: (isHigh(E) && !isHigh(N) ? '公開' : '私下') as '公開' | '私下',
    timing: (isHigh(C) ? '即時' : '定期') as '即時' | '定期',
    medium: (isHigh(N) || isLow(E) ? '書面' : '口頭') as '口頭' | '書面',
    bad_example: '',
  }
  // 錯誤示範依組合
  if (feedback.tone === '鋪墊' && feedback.setting === '私下') {
    feedback.bad_example = '在週會當眾直接點名說「你這次做得很糟」會讓他感到強烈受傷且難復原'
  } else if (feedback.tone === '直接' && feedback.setting === '公開') {
    feedback.bad_example = '私下委婉地說「最近狀況好像不太好」對他來說沒有訊號，他會覺得沒問題'
  } else if (feedback.tone === '鋪墊' && feedback.setting === '公開') {
    feedback.bad_example = '在會議上直接指出他的失誤 + 沒有先說優點，他會當場僵住且難消化'
  } else {
    feedback.bad_example = '只說「很好繼續加油」這種空洞鼓勵，他會覺得你沒在認真給建議'
  }

  // === 5. 職涯方向（依 E/A/C/O 組合，給 3 個） ===
  const careerOptions: Array<{ title: string; why: string; score: number }> = []
  // 對外面向
  if (isHigh(E) && isHigh(A)) careerOptions.push({ score: 90, title: '客戶關係 / BD / 業務開發', why: '社交能量 + 同理心，能快速建立客戶信任' })
  if (isHigh(E) && isLow(A)) careerOptions.push({ score: 88, title: '談判 / 採購 / 競爭情報', why: '善於主動進攻 + 不被人情綁住，能談下硬條件' })
  if (isHigh(E) && isHigh(O)) careerOptions.push({ score: 85, title: '行銷企劃 / 品牌經理 / PR', why: '能對外傳遞訊息 + 點子多，適合品牌建立' })
  // 對內專業
  if (isLow(E) && isHigh(C)) careerOptions.push({ score: 90, title: '專業深耕（會計 / 法務 / 技術專家）', why: '能耐住寂寞做深的事 + 紀律高，產出穩定可靠' })
  if (isHigh(O) && isHigh(C)) careerOptions.push({ score: 88, title: '創新領導 / 研發 / 內部創業', why: '創意 + 落地執行同時具備，少見且珍貴的組合' })
  if (isLow(O) && isHigh(C)) careerOptions.push({ score: 85, title: '流程優化 / SOP 制定 / 內控', why: '尊重既有架構 + 紀律強，能維護系統穩定' })
  // 服務面向
  if (isHigh(A) && isLow(E)) careerOptions.push({ score: 85, title: '客服 / HR / 教練 / 心理諮商', why: '深度同理 + 不需高頻社交，適合幫助個別人' })
  // 整合面向
  if (isHigh(A) && isHigh(C) && isMid(E)) careerOptions.push({ score: 85, title: '專案管理 / PM / 跨部門協調', why: '同理 + 紀律，能調和多方意見並推動進度' })
  // 創意面向
  if (isHigh(O) && isLow(C)) careerOptions.push({ score: 80, title: '設計 / 創意工作者 / 文案企劃', why: '點子源源不絕，適合 flexible 環境' })
  // 後援面向
  if (isLow(O) && isMid(E)) careerOptions.push({ score: 75, title: '行政 / 助理 / 內勤支援', why: '尊重流程 + 不需主動找事做，是穩定後援' })
  // 領導面向
  if (isHigh(E) && isHigh(C) && (isHigh(A) || isHigh(N))) careerOptions.push({ score: 88, title: '部門主管 / 中階管理', why: '帶人能量 + 紀律 + 對人感受敏銳' })

  // 至少要 3 個。如果不夠則加 fallback
  const fallbackCareers = [
    { score: 60, title: '一般職務（依產業而定）', why: '能適應多種工作環境' },
    { score: 55, title: '行政支援', why: '尊重流程' },
    { score: 50, title: '客服 / 接待', why: '能與人應對' },
  ]
  const allCareers = [...careerOptions, ...fallbackCareers].sort((a, b) => b.score - a.score)
  const careers = allCareers.slice(0, 3).map(c => ({ title: c.title, why: c.why }))

  // === 6. 主導風格 ===
  const primary_style = (() => {
    if (viewpoint === 'manager') {
      // 領導風格
      if (isHigh(A) && isHigh(C)) return { name: '支援型 + 教練型', description: '傾向多花時間在 1-on-1 對話、用提問引導、會議中先聽完意見再表態' }
      if (isLow(A) && isHigh(C)) return { name: '指揮型 + 紀律導向', description: '明確訂定方向與標準、敢做不討好的決定、要求結果' }
      if (isHigh(E) && isHigh(O)) return { name: '願景型 / Transformational', description: '善於描繪未來、用熱情感染團隊、激發成員自主性' }
      if (isHigh(A) && isLow(C)) return { name: '人和型 / 民主型', description: '重視團隊感受與共識、決策前廣徵意見、避免強推' }
      if (isLow(E) && isHigh(C)) return { name: '幕後型 / Servant', description: '不愛站台、把舞台留給團隊，從後方提供資源與保護' }
      return { name: '平衡型', description: '能依情境調整領導風格、不極端，適合穩健帶領中型團隊' }
    } else {
      // 工作風格（staff）
      if (isHigh(C) && isLow(O)) return { name: '流程派 + 細節導向', description: '依既有 SOP 穩定推進、品質為先、不喜歡臨時改規則' }
      if (isHigh(C) && isHigh(O)) return { name: '紀律派 + 創新嘗試', description: '會主動優化既有流程、邊做邊改善、不滿足現狀' }
      if (isLow(C) && isHigh(O)) return { name: '變通派 + 點子發想', description: '彈性處理變動、不被框架限制、適合快速試錯環境' }
      if (isHigh(A) && isHigh(E)) return { name: '協作派 + 主動串聯', description: '把人連起來、主動同步資訊、會把同事的需求放進自己工作' }
      if (isLow(E) && isHigh(C)) return { name: '專注派 + 深度產出', description: '能耐住寂寞做深的事、不愛多人會議、產出穩定' }
      return { name: '平衡型工作風格', description: '能依情境調整節奏，多數情況都能配合團隊' }
    }
  })()

  // === 7. 協作配對 ===
  const collab = (() => {
    const myA = isHigh(A) ? '高 A' : isLow(A) ? '低 A' : '中 A'
    const myE = isHigh(E) ? '高 E' : isLow(E) ? '低 E' : '中 E'
    const myC = isHigh(C) ? '高 C' : isLow(C) ? '低 C' : '中 C'
    const myO = isHigh(O) ? '高 O' : isLow(O) ? '低 O' : '中 O'

    const best_with = (() => {
      if (isHigh(C) && isLow(O)) return '高開放性、能帶來新點子的夥伴。你提供紀律與落地，對方提供變化與創新，互補性強'
      if (isLow(C) && isHigh(O)) return '高盡責、會幫你收尾與設定節奏的夥伴。你提供點子，對方確保產出'
      if (isHigh(A) && isLow(E)) return '主動性高的外向同事。你提供深度與穩定，對方幫你曝光與連結'
      if (isLow(A)) return '高親和、能緩衝你直接溝通的同事。你提供決斷，對方避免衝突升級'
      if (isHigh(N)) return '情緒穩定、能在你焦慮時提供 grounding 的同事'
      return '與你某維度相反（互補）+ 在另一維度同調（共識）的對象'
    })()

    const friction_with = (() => {
      if (isHigh(A)) return '低親和性、直率甚至冷淡的人。你會覺得「為什麼要這樣說話」，對方覺得「你太玻璃心」'
      if (isLow(A)) return '高親和、需要鋪墊才敢說真話的人。你會覺得「直接講就好幹嘛繞」，對方覺得你「太衝」'
      if (isHigh(C)) return '低盡責性、拖延或臨時改規則的人。你會煩躁、對方覺得你「太死板」'
      if (isLow(C)) return '高盡責、要求嚴格的人。你會覺得壓力大、對方覺得你「不專業」'
      if (isHigh(O)) return '低開放、堅持「以前都這樣做」的保守派。你會覺得停滯、對方覺得你「不切實際」'
      return '在你主要強項上是相反方向的人，互動時容易踩到對方的痛點'
    })()

    const friction_reason = (() => {
      if (isHigh(A) && isLow(N)) return '你的高同理心讓你期望被體貼回應，但情緒穩定的人不會主動回應情緒訊號，會讓你感到「他不在乎」'
      if (isLow(A) && isHigh(N)) return '你的直率讓敏感的人感到受傷，但你並無惡意，溝通頻道完全錯位'
      if (isHigh(C) && isLow(C)) return '雙方對「事情該如何完成」的基本假設不同，光是流程就會吵很久'
      return '雙方在某個核心維度方向相反，互動時對方的標準是你的痛點，反之亦然'
    })()

    const common_misread = (() => {
      if (isLow(E)) return '被誤認為「冷淡、不合群、不主動」——其實只是不擅長公開表達，私下對話深度可能更高'
      if (isHigh(N)) return '被誤認為「玻璃心、抗壓性差」——其實是對細節與情緒敏感，這份敏感同時也是強項'
      if (isLow(A)) return '被誤認為「不近人情、太直接」——其實是重視效率與真實，沒有想傷人'
      if (isHigh(C) && isLow(O)) return '被誤認為「死板、不知變通」——其實是重視承諾與品質的可預期性'
      if (isLow(C)) return '被誤認為「不負責任、隨便」——其實是節奏不同 + 在乎的事情不同'
      return '同事可能誤讀你的某個外顯特質，而錯估你的真實動機'
    })()

    const adjust_actions = (() => {
      const acts: string[] = []
      if (isLow(E)) acts.push('週會主動發言一次（即使只是「我同意 X 的意見」）')
      if (isLow(A)) acts.push('給回饋前先講一句肯定（如「這部分做得很好，但…」）')
      if (isHigh(N)) acts.push('被質疑時先深呼吸 5 秒再回應，避免情緒回擊')
      if (isHigh(C) && isLow(O)) acts.push('遇到別人提新做法時先說「我先想想」再評估，不要立刻拒絕')
      if (acts.length < 2) acts.push('每週主動找一位較少互動的同事聊 10 分鐘')
      return acts.slice(0, 3)
    })()

    return { best_with, friction_with, friction_reason, common_misread, adjust_actions }
  })()

  // === 8. 暗影（強項過度發揮） ===
  const shadow = (() => {
    const topStrength = strengths[0]
    if (!topStrength) return { strength: '平衡', becomes: '面對極端壓力時，平衡可能變成猶豫不決' }
    if (topStrength.dim === 'C') return { strength: '高盡責性', becomes: '在 deadline 壓力下可能演變成完美主義癱瘓、不敢提交未完美的版本，反而延誤' }
    if (topStrength.dim === 'A') return { strength: '高親和性', becomes: '需要做不討好決定時可能過度體貼、犧牲團隊整體效益、最終讓所有人都不滿意' }
    if (topStrength.dim === 'E') return { strength: '高外向性', becomes: '在需要深度思考時可能變成「先說再想」、讓團隊以為已下決定其實還在思考' }
    if (topStrength.dim === 'O') return { strength: '高開放性', becomes: '面對需要快速收斂的場景時可能不斷探索新方向、團隊無法跟上' }
    if (topStrength.dim === 'low_N') return { strength: '極度情緒穩定', becomes: '面對團隊成員的情緒風暴時可能反應太冷淡、被誤認為不在乎' }
    return { strength: topStrength.label, becomes: '在壓力下可能過度發揮，反而成為阻礙' }
  })()

  // === 9. 刻意練習 ===
  const practice = (() => {
    // 找最極端的維度 → 對應練習
    const extremes = [
      { dim: 'C', diff: Math.abs(C - 50), high: C >= 50 },
      { dim: 'A', diff: Math.abs(A - 50), high: A >= 50 },
      { dim: 'E', diff: Math.abs(E - 50), high: E >= 50 },
      { dim: 'N', diff: Math.abs(N - 50), high: N >= 50 },
      { dim: 'O', diff: Math.abs(O - 50), high: O >= 50 },
    ].sort((a, b) => b.diff - a.diff)
    const top = extremes[0]

    const map: Record<string, { high: { behavior: string; why_hard: string; triggers: string[]; tomorrow: string }; low: { behavior: string; why_hard: string; triggers: string[]; tomorrow: string } }> = {
      C: {
        high: {
          behavior: '練習接受「先 80 分先送出再優化」',
          why_hard: '你的高盡責性讓你需要事前完全規劃才動手，所以「先動手再優化」會直接挑戰你的安全感基底',
          triggers: ['對客戶/主管交付前，會反覆檢查超過必要次數', '別人提出新意見時會抗拒（怕推翻原計畫）', '不熟悉的工具上手前會研究太久'],
          tomorrow: '今天挑一個小任務，做到 80% 就送出，把剩 20% 的修改放在收到回饋後再做',
        },
        low: {
          behavior: '練習收斂並完成「不那麼有趣的最後 10%」',
          why_hard: '你的低盡責性讓你享受開頭與發想，但收尾的細節調整對你來說很無聊，所以總是留尾巴',
          triggers: ['有新點子或新任務時，會放下手邊未完成的事', '進入「差不多就好」階段時失去動力', '看到細節錯誤覺得「之後再說」'],
          tomorrow: '明早第一件事：列出三個「90% 完成但沒收尾」的任務，挑一個今天結束前 100% 收掉',
        },
      },
      A: {
        high: {
          behavior: '練習建設性提出反對意見而不傷感情',
          why_hard: '你的高親和性讓表達反對意見會喚起「可能傷害關係」的不安，所以你選擇沉默或附和',
          triggers: ['會議上多數人意見一致但你不同意', '對主管/權威人物有不同想法', '需要婉拒同事請求時'],
          tomorrow: '今天找一個小場合練「我有點不同想法，可能不對但分享看看…」開頭，至少說出一個反對意見',
        },
        low: {
          behavior: '練習在給回饋前先肯定對方付出',
          why_hard: '你的低親和性讓你直接表達真實判斷，但對方接收到的是「你只看到我的問題」，關係累積消耗',
          triggers: ['對品質不滿意時', '別人沒達到你預期時', '看到不合理的事情想直接指出'],
          tomorrow: '今天給任何人回饋前，**先寫下 1 個具體的肯定點再開口**，連續一週',
        },
      },
      E: {
        high: {
          behavior: '練習「先聽完再說」',
          why_hard: '你的高外向性讓你需要透過說話思考，但在團隊中可能讓內向同事沒空間發言',
          triggers: ['會議靜默 3 秒以上時你會自動填補', '別人在思考時你會打斷給建議', '群組訊息你會率先回'],
          tomorrow: '明天會議中，刻意等到至少 2 個人先發言後才表態，連續一週',
        },
        low: {
          behavior: '練習主動發聲',
          why_hard: '你的低外向性讓你習慣觀察、等待最佳時機。但職場上「不發聲 = 沒想法」的誤解很常見',
          triggers: ['會議室人多時', '面對權威或新團隊時', '需要爭取資源/曝光時'],
          tomorrow: '明早會議輪到你發言時，**逼自己第一個說話**，不論說什麼都先發聲，持續一週',
        },
      },
      N: {
        high: {
          behavior: '練習在情緒湧上時先暫停 5 秒再回應',
          why_hard: '你的高神經質讓情緒訊號很快淹沒理性，5 秒看似簡單但需要刻意建立習慣',
          triggers: ['被質疑或批評時', '時程壓力大時', '不確定的情境（如等回覆）', '連續工作沒休息超過 4 小時'],
          tomorrow: '今天找一個會引發情緒的小情境（如收到不耐煩的訊息），刻意等 5 秒再回，連續一週',
        },
        low: {
          behavior: '練習對他人情緒訊號更敏感',
          why_hard: '你的低神經質讓你很穩，但同事的情緒波動可能完全沒進入你的雷達，被視為冷漠',
          triggers: ['同事看起來不太對勁但沒明說時', '別人對你的話有微表情變化時', '團隊氣氛突然降溫時'],
          tomorrow: '今天觀察一位同事的情緒狀態並主動關心一句（如「最近還好嗎」），連續一週',
        },
      },
      O: {
        high: {
          behavior: '練習在收斂期忍住不再發散',
          why_hard: '你的高開放性讓你永遠想試新東西，但執行期需要的是聚焦不是探索',
          triggers: ['專案進入細節執行階段', '看到 shiny new thing', '對既有方案開始覺得無聊時'],
          tomorrow: '今天設一個「48 小時不開新分頁學新工具」的限制，把所有點子寫進 backlog 留待之後',
        },
        low: {
          behavior: '練習對新方法的初次接受度',
          why_hard: '你的低開放性讓你倚賴熟悉的方法，但組織進化需要持續吸收新做法',
          triggers: ['同事提議改變現有 SOP 時', '上層推動新工具時', '看到「之前都這樣做」失效的訊號時'],
          tomorrow: '本週至少嘗試一個你過去抗拒的小工具或方法，給它 30 分鐘試用',
        },
      },
    }

    const entry = map[top.dim]
    const pick = top.high ? entry.high : entry.low
    return {
      behavior: pick.behavior,
      why_hard: pick.why_hard,
      trigger_situations: pick.triggers,
      tomorrow_action: pick.tomorrow,
    }
  })()

  return { strengths, weaknesses, motivations, feedback, careers, primary_style, collab, shadow, practice }
}

// 把確定性分析格式化成可餵給 AI 的「結構化輸入」
export function formatAnalysisForAI(analysis: DetAnalysis, viewpoint: Viewpoint, scores: BigFiveScores): string {
  const archetype = deriveArchetype(scores.dimensions)
  const stress = deriveStressResponse(scores.dimensions)
  const decision = deriveDecisionStyle(scores.dimensions)
  const risk = deriveRiskProfile(scores.dimensions)

  const bestStress = stress.find(s => s.rank === 'best')
  const worstStress = stress.find(s => s.rank === 'worst')

  return `【系統已演算的結論 — 你必須完全採用，不要重新分析或推翻】

## 同類型族群（粗分類）
${archetype.emoji} ${archetype.name}：${archetype.short}

## 確定強項（請完整論述這 ${analysis.strengths.length} 項，不要新增也不要省略）
${analysis.strengths.map((s, i) => `${i + 1}. ${s.label} — 典型行為：${s.behavior}`).join('\n')}

## 確定弱點（請完整論述這 ${analysis.weaknesses.length} 項）
${analysis.weaknesses.map((w, i) => `${i + 1}. ${w.label} — 典型行為：${w.behavior}`).join('\n')}

## 激勵驅動因子（請完整論述這 ${analysis.motivations.length} 項，主管行動部分要具體展開）
${analysis.motivations.map((m, i) => `${i + 1}. ${m.label}（${m.why}）→ 主管行動：${m.manager_action}`).join('\n')}

## 回饋風格偏好（請完整論述四面向）
- 語氣：${analysis.feedback.tone}
- 場合：${analysis.feedback.setting}
- 時機：${analysis.feedback.timing}
- 媒介：${analysis.feedback.medium}
- 錯誤示範：${analysis.feedback.bad_example}

## ${viewpoint === 'manager' ? '領導風格' : '工作風格'}
${analysis.primary_style.name}：${analysis.primary_style.description}

## 協作配對
- 最順暢對象：${analysis.collab.best_with}
- 容易摩擦對象：${analysis.collab.friction_with}
- 摩擦根源：${analysis.collab.friction_reason}
- 最常被誤解的點：${analysis.collab.common_misread}
- 可主動調整的行為：${analysis.collab.adjust_actions.join('；')}

## 暗影（強項過度發揮）
${analysis.shadow.strength} → ${analysis.shadow.becomes}

## 適合的職涯方向（請完整論述這 3 條）
${analysis.careers.map((c, i) => `${i + 1}. ${c.title} — ${c.why}`).join('\n')}

## 壓力應對
- 最強的壓力情境：${bestStress?.type || '—'}（${bestStress?.score ?? '—'}/100）
- 最弱的壓力情境：${worstStress?.type || '—'}（${worstStress?.score ?? '—'}/100）

## 決策風格四軸
${decision.axes.map(a => `- ${a.name}：${a.position >= 60 ? a.right : a.position <= 40 ? a.left : '兩端之間'}（${a.position}）`).join('\n')}

## 風險偏好
${risk.label}（${risk.score}/100）：${risk.note}

## 刻意練習路徑（必須完全採用以下結論）
- 要練的具體行為：${analysis.practice.behavior}
- 為何特別難改：${analysis.practice.why_hard}
- 退回舊模式的情境（請完整列出這 ${analysis.practice.trigger_situations.length} 個）：
${analysis.practice.trigger_situations.map(t => `  - ${t}`).join('\n')}
- 明天就開始的小練習：${analysis.practice.tomorrow_action}

【你的任務】
依上述確定性結論，用具體職場情境與生動敘述把它們寫成 1400-1700 字的人格適性報告。
**禁止改變上述任何結論**，**禁止新增上述沒有的項目**，你只負責「文字敘述」與「人格原型命名」。
`
}
