// ===================================================
// 全站共用選項 / 對應表
// 原本產業清單、課別清單、狀態顏色 map 散落在多個檔案各自複製一份，
// 這裡集中管理，避免不同步。
// ===================================================
import type { CustomerStatus, Industry, Team } from '@/types/database'

// 產業別（下拉選單用；與 database.ts 的 Industry 型別一致）
export const INDUSTRIES: Industry[] = [
  '電子科技業',
  '機械製造業',
  '化工原物料',
  '紡織成衣業',
  '食品飲料業',
  '醫療保健業',
  '汽車零組件',
  '貿易進出口',
  '電商零售業',
  '建材五金業',
  '能源環保業',
  '其他',
]

// 課別 / 部門（篩選下拉用）
export const TEAMS: Team[] = [
  '業務部',
  '業一課',
  '業二課',
  '專案課',
  '電商課',
  '物流一部',
  '物流二部',
  '報關部',
  '管理員',
]

// 客戶狀態的中文標籤 + 圖表用 hex 色（dashboard 圓餅、活動點都用這組）
export const STATUS_META: Record<string, { label: string; color: string }> = {
  active_developing: { label: '開發中', color: '#3b82f6' },
  negotiating:       { label: '洽談中', color: '#a855f7' },
  completed:         { label: '已成交', color: '#10b981' },
  long_term:         { label: '長期合作', color: '#06b6d4' },
  abandoned:         { label: '未成交', color: '#9ca3af' },
  warning:           { label: '黃燈警示', color: '#f59e0b' },
  locked:            { label: '鎖檔暫停', color: '#ef4444' },
  reactivating:      { label: '重新開發中', color: '#8b5cf6' },
}

export function statusMeta(status: CustomerStatus | string | null | undefined) {
  return STATUS_META[status || ''] || { label: status || '未知', color: '#9ca3af' }
}
