export type UserRole = 'admin' | 'chairman' | 'director' | 'manager' | 'deputy_manager' | 'sales' | 'finance' | 'hr'
export type Team = '業務部' | '業一課' | '業二課' | '專案課' | '電商課' | '物流一部' | '物流二部' | '報關部' | '財管部' | '管理員'
export type CustomerStatus =
  | 'active_developing'  // 開發中
  | 'negotiating'        // 洽談中
  | 'completed'          // 已成交
  | 'long_term'          // 長期合作
  | 'abandoned'          // 未成交 / 放棄
  | 'warning'            // 黃燈警示
  | 'locked'             // 鎖檔暫停
  | 'reactivating'       // 重新開發中
export type CustomerGrade = 'A' | 'B' | 'C'
export type CompanyCodeType = '上市' | '上櫃' | '興櫃' | '一般公司'
export type Industry =
  | '電子科技業'
  | '機械製造業'
  | '化工原物料'
  | '紡織成衣業'
  | '食品飲料業'
  | '醫療保健業'
  | '汽車零組件'
  | '貿易進出口'
  | '電商零售業'
  | '建材五金業'
  | '能源環保業'
  | '其他'
export type HistoryActionType =
  | 'created'
  | 'notify_30'
  | 'notify_60'
  | 'warning'          // 75 天警示
  | 'notify_80'
  | 'locked'
  | 'transfer_requested'
  | 'transfer_approved'
  | 'reactivated'
  | 'mark_negotiating' // 標記為洽談中
  | 'mark_completed'   // 標記為已成交
  | 'mark_long_term'   // 標記為長期合作
  | 'mark_abandoned'   // 標記為未成交
  | 'mark_developing'  // 改回開發中
  | 'deleted'          // 軟刪除（admin 操作）

// UI 顯示用的警示層級（由天數計算而來，不存資料庫）
export type WarningTier =
  | 'developing'   // 0-29
  | 'tier_30'      // 30-59
  | 'tier_60'      // 60-74
  | 'tier_75'      // 75-79（黃燈警示）
  | 'tier_80'      // 80-89
  | 'locked'       // 鎖檔
  | 'reactivating' // 重新開發
  | 'negotiating'  // 洽談中
  | 'completed'    // 已成交
  | 'long_term'    // 長期合作
  | 'abandoned'    // 未成交
export type TransferStatus = 'pending' | 'approved' | 'rejected'

export interface User {
  id: string
  email: string
  name: string
  chinese_name: string
  role: UserRole
  team: Team
  is_active: boolean
  telegram_id: string | null
  password_changed: boolean
  created_at: string
  deactivated_at: string | null
}

export interface Customer {
  id: string
  company_name: string
  company_code: string | null
  company_code_type: CompanyCodeType | null
  industry: Industry | null
  assigned_to: string
  created_date: string
  last_contact_date: string | null
  status: CustomerStatus
  grade: CustomerGrade
  created_by: string
  locked_at: string | null
  locked_reason: string | null
  deleted_at: string | null
  // 主管推薦優先開發
  priority_flag?: boolean
  priority_note?: string | null
  priority_by?: string | null
  priority_at?: string | null
  // Joined fields
  assigned_user?: User
  created_by_user?: User
}

export interface CustomerHistory {
  id: string
  customer_id: string
  action_type: HistoryActionType
  action_by: string
  action_date: string
  from_user: string | null
  to_user: string | null
  note: string | null
  // Joined
  action_by_user?: User
  from_user_data?: User
  to_user_data?: User
}

export interface Comment {
  id: string
  customer_id: string
  user_id: string
  content: string
  created_at: string
  // Joined
  user?: User
}

export interface CustomerContact {
  id: string
  customer_id: string
  name: string
  title: string | null
  phone: string | null
  email: string | null
  created_at: string
  created_by: string | null
}

export interface TransferRequest {
  id: string
  customer_id: string
  requested_by: string
  requested_at: string
  status: TransferStatus
  reviewed_by: string | null
  reviewed_at: string | null
  note: string | null
  // Joined
  customer?: Customer
  requested_by_user?: User
  reviewed_by_user?: User
}
