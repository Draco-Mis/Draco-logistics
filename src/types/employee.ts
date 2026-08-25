// 員工名冊（登泰組織內部成員，未必都是 LOP 登入帳號）
// 9 個分類由 HR 可在 /admin/employees 自行調整每人歸屬
export type EmployeeCategory =
  | 'chairman'              // 董事長
  | 'department_head'       // 部級主管
  | 'section_head'          // 課級主管
  | 'deputy_section_head'   // 副課長
  | 'supervisor'            // 主任
  | 'project_lead'          // 專案課級
  | 'operations'            // OP
  | 'sales'                 // 業務
  | 'staff'                 // 一般職員

export interface Employee {
  id?: string              // DB 來的 row 才有
  name: string
  english: string
  title: string
  unit: string             // 所屬單位 / 部門（自由文字，可空字串）
  category: EmployeeCategory
  sort_order?: number
  resigned_at?: string | null  // null / undefined = 在職；有值 = 離職日期（已歸檔）
}

export interface EmployeeCategoryMeta {
  label: string
  order: number
  description?: string
}

export interface EmployeeRosterJson {
  version: string
  updated_at: string
  categories: Record<EmployeeCategory, EmployeeCategoryMeta>
  employees: Employee[]
}
