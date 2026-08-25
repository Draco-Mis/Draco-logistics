// 邏輯思維評估（IPIP 風格之內部測驗）型別
export type LogicTestVersion = 'A' | 'B' | 'C' | 'D' | 'E'
export type LogicTestLevel = '優秀' | '良好' | '中等' | '待加強'

export interface LogicItem {
  id: string
  category: string
  difficulty: string
  question: string
  options: string[]    // 4 個選項
  answer: number       // 正確選項在原始 options 中的 index (0-3)
  explanation: string
}

export interface LogicTestJson {
  meta: {
    name: string
    version: string
    total_items: number
    estimated_minutes: number
    versions: LogicTestVersion[]
    note: string
  }
  categories: Record<string, { label: string; count: number }>
  scoring: {
    method: string
    // 類別等級門檻（每題佔比較大、粒度有限，沿用較寬鬆設定）
    levels: { label: LogicTestLevel; min_pct: number }[]
    // 總分等級門檻（可選；若未提供則沿用 levels）
    total_levels?: { label: LogicTestLevel; min_pct: number }[]
    category_interpretations: Record<string, Record<LogicTestLevel, string>>
  }
  items: LogicItem[]
}

// 客戶端看到的（順序已 shuffle，且 options 也 shuffle，不含答案）
export interface ShuffledLogicItem {
  id: string                // 原始題號（保留以便對應分類）
  category: string
  difficulty: string
  question: string
  options: string[]         // 已重新排序的選項文字
}

export interface CategoryScore {
  score: number
  max: number
  level: LogicTestLevel
}

export interface LogicScores {
  total: { score: number; max: number; pct: number; level: LogicTestLevel }
  categories: Record<string, CategoryScore>
}

// 儲存到 DB 的作答格式：{ "NS1": 2, "VR1": 0, ... }
// 注意：value 是「打亂後的選項 index」（使用者實際點到的那個格子），
//      不是原始選項 index。Server 端會用 version 還原出 option_perm 來反推正確性。
export type LogicAnswers = Record<string, number>

export interface AssessmentEvent {
  id: string
  code: string
  name: string
  test_types: string[]
  deadline: string | null
  is_active: boolean
  created_by: string
  created_at: string
  // 目標員工分類（對應 src/data/employees.json 的 category key）；null 表示不限分類
  target_categories?: string[] | null
  // 活動類型：員工測驗 / 面試人員測驗
  kind?: 'employee' | 'interview'
}

// 個人結果頁顯示用的對照基準
// 每個類別的平均百分比（0–100）
// dept 為 undefined 表示同部門人數不足，無法顯示部門平均（避免反推個別分數）
export interface LogicBenchmark {
  overall: {
    n: number
    avgPctByCategory: Record<string, number>
  }
  dept?: {
    name: string
    n: number
    avgPctByCategory: Record<string, number>
  }
}

export interface AssessmentSubmission {
  id: string
  event_id: string
  respondent_name: string
  english_name?: string | null
  department: string
  employee_code: string | null
  version: LogicTestVersion
  logic_answers: LogicAnswers
  logic_scores: LogicScores | null
  status: 'in_progress' | 'completed'
  started_at: string
  completed_at: string | null
  ip_address: string | null
  ai_profile?: string | null
  ai_profile_generated_at?: string | null
  // 面試錄取狀態（僅 kind='interview' 活動使用）
  hired_at?: string | null
  hired_employee_id?: string | null
  hire_notes?: string | null
  // Big Five 人格測驗（test_types 含 'bigfive' 時使用）
  bigfive_answers?: Record<string, number> | null
  bigfive_scores?: import('./bigfive').BigFiveScores | null
  // 兩種視角獨立儲存，不互相覆蓋
  bigfive_ai_profile_manager?: string | null
  bigfive_ai_profile_manager_at?: string | null
  bigfive_ai_profile_staff?: string | null
  bigfive_ai_profile_staff_at?: string | null
  // 舊欄位（向後相容用，新版本不再寫入）
  bigfive_ai_profile?: string | null
  bigfive_ai_profile_generated_at?: string | null
  bigfive_ai_profile_viewpoint?: 'manager' | 'staff' | null
}
