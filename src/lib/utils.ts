import { differenceInDays, format, parseISO } from 'date-fns'
import { CustomerStatus, WarningTier, UserRole } from '@/types/database'

export function getRoleLabel(role: UserRole | undefined): string {
  if (!role) return ''
  const labels: Record<UserRole, string> = {
    admin: '管理員',
    chairman: '董事長',
    director: '部長',
    manager: '課長',
    deputy_manager: '副課長',
    finance: '財務',
    hr: '人資',
    sales: '業務',
  }
  return labels[role]
}

export function getRoleColor(role: UserRole | undefined): string {
  if (!role) return 'bg-gray-100 text-gray-600'
  const colors: Record<UserRole, string> = {
    admin: 'bg-purple-100 text-purple-800',
    chairman: 'bg-yellow-100 text-yellow-800',
    director: 'bg-indigo-100 text-indigo-800',
    manager: 'bg-blue-100 text-blue-800',
    deputy_manager: 'bg-sky-100 text-sky-800',
    finance: 'bg-emerald-100 text-emerald-800',
    hr: 'bg-pink-100 text-pink-800',
    sales: 'bg-gray-100 text-gray-600',
  }
  return colors[role]
}

// 已成交 / 長期合作 / 未成交 / 鎖檔：不受 90 天限制，回傳 0
const EXEMPT_FROM_LOCK: CustomerStatus[] = ['locked', 'completed', 'long_term', 'abandoned']

export function getRemainingDays(createdDate: string, status: CustomerStatus): number {
  if (EXEMPT_FROM_LOCK.includes(status)) return 0
  const start = parseISO(createdDate)
  const today = new Date()
  const elapsed = differenceInDays(today, start)
  return Math.max(0, 90 - elapsed)
}

export function getElapsedDays(createdDate: string): number {
  const start = parseISO(createdDate)
  const today = new Date()
  return differenceInDays(today, start)
}

export function formatDate(date: string): string {
  return format(parseISO(date), 'yyyy/MM/dd')
}

export function formatDateTime(date: string): string {
  return format(parseISO(date), 'yyyy/MM/dd HH:mm')
}

export function getStatusLabel(status: CustomerStatus): string {
  const labels: Record<CustomerStatus, string> = {
    active_developing: '開發中',
    negotiating: '洽談中',
    completed: '已成交',
    long_term: '長期合作',
    abandoned: '未成交',
    warning: '黃燈警示',
    locked: '鎖檔暫停',
    reactivating: '重新開發中',
  }
  return labels[status]
}

export function getStatusColor(status: CustomerStatus): string {
  const colors: Record<CustomerStatus, string> = {
    active_developing: 'bg-green-500 text-white',
    negotiating:       'bg-blue-500 text-white',
    completed:         'bg-amber-400 text-amber-900',
    long_term:         'bg-green-800 text-white',
    abandoned:         'bg-gray-400 text-white',
    warning:           'bg-yellow-400 text-black',
    locked:            'bg-red-500 text-white',
    reactivating:      'bg-orange-500 text-white',
  }
  return colors[status]
}

export function getStatusDotColor(status: CustomerStatus): string {
  const colors: Record<CustomerStatus, string> = {
    active_developing: 'bg-green-500',
    negotiating:       'bg-blue-500',
    completed:         'bg-amber-400',
    long_term:         'bg-green-800',
    abandoned:         'bg-gray-400',
    warning:           'bg-yellow-400',
    locked:            'bg-red-500',
    reactivating:      'bg-orange-500',
  }
  return colors[status]
}

export function getGradeColor(grade: string): string {
  const colors: Record<string, string> = {
    A: 'bg-blue-600 text-white',
    B: 'bg-blue-400 text-white',
    C: 'bg-blue-200 text-blue-800',
  }
  return colors[grade] || 'bg-gray-200'
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

// ===================================================
// 資料完整度指標
// ===================================================

export interface CompletenessItem {
  label: string
  done: boolean
  hint?: string
}

export interface CompletenessResult {
  total: number
  completed: number
  score: number // 0-100
  items: CompletenessItem[]
  isComplete: boolean
}

export function getCustomerCompleteness(params: {
  grade?: string
  companyCodeType?: string | null
  lastContactDate?: string | null
  contactsCount?: number
}): CompletenessResult {
  const items: CompletenessItem[] = [
    {
      label: '客戶等級已選填',
      done: !!params.grade,
      hint: '建檔時會要求選擇 A / B / C，此項應已自動完成',
    },
    {
      label: '已新增聯絡人',
      done: (params.contactsCount ?? 0) > 0,
      hint: '至少 1 位聯絡人才能聯繫客戶',
    },
    {
      label: '公司類型已選',
      done: !!params.companyCodeType,
      hint: '上市／上櫃／興櫃／一般公司',
    },
    {
      label: '有最後聯絡日期',
      done: !!params.lastContactDate,
      hint: '記錄開發進度',
    },
  ]
  const total = items.length
  const completed = items.filter(i => i.done).length
  return {
    total,
    completed,
    score: Math.round((completed / total) * 100),
    items,
    isComplete: completed === total,
  }
}

// ===================================================
// 字串相似度（Dice / Sørensen–Dice 係數）
// 中文字用 bigram（2 字元滑動視窗），英文轉小寫
// 回傳 0.0 ~ 1.0（1.0 = 完全相同）
// ===================================================
export function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const s1 = normalizeForCompare(a)
  const s2 = normalizeForCompare(b)
  if (s1 === s2) return 1
  if (s1.length < 2 || s2.length < 2) return 0

  const bigrams1 = getBigrams(s1)
  const bigrams2 = getBigrams(s2)
  if (bigrams1.size === 0 || bigrams2.size === 0) return 0

  let intersection = 0
  bigrams1.forEach(g => {
    if (bigrams2.has(g)) intersection++
  })
  return (2 * intersection) / (bigrams1.size + bigrams2.size)
}

function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-_·・。，,。、.·]/g, '')  // 拿掉常見分隔符
    .replace(/股份有限公司|有限公司|股份公司|公司|Co\.?,? ?Ltd\.?|Inc\.?|Corp\.?|Corporation|Limited/gi, '')
    .trim()
}

function getBigrams(s: string): Set<string> {
  const bigrams = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) {
    bigrams.add(s.substring(i, i + 2))
  }
  return bigrams
}

// ===================================================
// 警示層級（Warning Tier）
// 由建檔日 + 狀態計算而來，用於 UI 顯示顏色/標籤
// ===================================================

export function getWarningTier(createdDate: string, status: CustomerStatus): WarningTier {
  // 商業狀態的終態 / 特殊狀態：直接對應顏色
  if (status === 'completed')   return 'completed'
  if (status === 'long_term')   return 'long_term'
  if (status === 'abandoned')   return 'abandoned'
  if (status === 'negotiating') return 'negotiating'
  if (status === 'locked')      return 'locked'

  // 時間推演的層級（只對 active_developing / warning / reactivating 有意義）
  const elapsed = getElapsedDays(createdDate)
  if (elapsed >= 90) return 'locked'
  if (elapsed >= 80) return 'tier_80'
  if (elapsed >= 75) return 'tier_75'
  if (elapsed >= 60) return 'tier_60'
  if (elapsed >= 30) return 'tier_30'
  if (status === 'reactivating') return 'reactivating'
  return 'developing'
}

export function getTierLabel(tier: WarningTier): string {
  const labels: Record<WarningTier, string> = {
    developing: '開發中',
    tier_30: '關注（30 天）',
    tier_60: '注意（60 天）',
    tier_75: '黃燈警示（75 天）',
    tier_80: '緊急（80 天）',
    locked: '鎖檔暫停',
    reactivating: '重新開發中',
    negotiating: '洽談中',
    completed: '已成交',
    long_term: '長期合作',
    abandoned: '未成交',
  }
  return labels[tier]
}

// 列表上顯示用的簡短標籤
export function getTierShortLabel(tier: WarningTier): string {
  const labels: Record<WarningTier, string> = {
    developing: '開發中',
    tier_30: '關注',
    tier_60: '注意',
    tier_75: '警示',
    tier_80: '緊急',
    locked: '鎖檔',
    reactivating: '重新開發',
    negotiating: '洽談中',
    completed: '已成交',
    long_term: '長期合作',
    abandoned: '未成交',
  }
  return labels[tier]
}

// badge 顏色（背景 + 文字色）
export function getTierColor(tier: WarningTier): string {
  const colors: Record<WarningTier, string> = {
    developing:   'bg-green-500 text-white',
    tier_30:      'bg-lime-400 text-black',
    tier_60:      'bg-yellow-400 text-black',
    tier_75:      'bg-orange-500 text-white',
    tier_80:      'bg-red-500 text-white',
    locked:       'bg-red-500 text-white',
    reactivating: 'bg-orange-500 text-white',
    negotiating:  'bg-blue-500 text-white',
    completed:    'bg-amber-400 text-amber-900',
    long_term:    'bg-green-800 text-white',
    abandoned:    'bg-gray-400 text-white',
  }
  return colors[tier]
}

// 剩餘天數的文字顏色（用於 detail 頁大字顯示）
export function getTierTextColor(tier: WarningTier): string {
  const colors: Record<WarningTier, string> = {
    developing:   'text-green-600',
    tier_30:      'text-lime-600',
    tier_60:      'text-yellow-600',
    tier_75:      'text-orange-600',
    tier_80:      'text-red-600',
    locked:       'text-red-600',
    reactivating: 'text-orange-600',
    negotiating:  'text-blue-600',
    completed:    'text-amber-700',
    long_term:    'text-green-800',
    abandoned:    'text-gray-600',
  }
  return colors[tier]
}

// 剩餘天數背景色（detail 頁大字顯示的容器）
export function getTierBgColor(tier: WarningTier): string {
  const colors: Record<WarningTier, string> = {
    developing:   'bg-green-50',
    tier_30:      'bg-lime-50',
    tier_60:      'bg-yellow-50',
    tier_75:      'bg-orange-50',
    tier_80:      'bg-red-50',
    locked:       'bg-red-50',
    reactivating: 'bg-orange-50',
    negotiating:  'bg-blue-50',
    completed:    'bg-amber-50',
    long_term:    'bg-green-50',
    abandoned:    'bg-gray-50',
  }
  return colors[tier]
}
