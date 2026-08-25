// ===================================================
// 集中式權限判斷
// 全站原本在 Sidebar / More / CommandPalette / dashboard / 各 admin 頁
// 各自 inline 判斷角色，這裡統一收斂，改一處到處生效。
// ===================================================
import type { User } from '@/types/database'

type MaybeUser = Pick<User, 'role' | 'team'> | null | undefined

export function isAdmin(user: MaybeUser): boolean {
  return user?.role === 'admin'
}

export function isChairman(user: MaybeUser): boolean {
  return user?.role === 'chairman'
}

// 部長 / 課長
export function isDirectorOrManager(user: MaybeUser): boolean {
  return user?.role === 'director' || user?.role === 'manager'
}

// 副課長
export function isDeputyManager(user: MaybeUser): boolean {
  return user?.role === 'deputy_manager'
}

// 可檢視團隊報表 / 績效（課長以上 + 副課長）
// 副課長的範圍另在頁面內排除「課長本人的客戶」
export function canViewTeamReports(user: MaybeUser): boolean {
  return isLeadership(user) || isDeputyManager(user)
}

// 具主管視角（可看團隊資料、審核轉移）
export function isLeadership(user: MaybeUser): boolean {
  return isAdmin(user) || isChairman(user) || isDirectorOrManager(user)
}

// 人資 / 人才評估權限
export function hasHRAccess(user: MaybeUser): boolean {
  return (
    isAdmin(user) ||
    user?.role === 'director' ||
    user?.role === 'hr' ||
    user?.team === '財管部'
  )
}

// 員工名冊瀏覽（比 hasHRAccess 多開放董事長）
export function canViewEmployees(user: MaybeUser): boolean {
  return hasHRAccess(user) || user?.role === 'chairman'
}

// 使用者管理
export function canManageUsers(user: MaybeUser): boolean {
  return isAdmin(user) || isChairman(user)
}

// 轉移／認領審核
export function canApproveTransfers(user: MaybeUser): boolean {
  return isLeadership(user)
}

// 只有 admin 能做的資料維運（匯入 / 匯出 / 重複清理）
export function isDataAdmin(user: MaybeUser): boolean {
  return isAdmin(user)
}

// 一次取得常用旗標，讓呼叫端可以解構使用
export function getPermissions(user: MaybeUser) {
  return {
    isAdmin: isAdmin(user),
    isChairman: isChairman(user),
    isDirectorOrManager: isDirectorOrManager(user),
    isDeputyManager: isDeputyManager(user),
    isLeadership: isLeadership(user),
    hasHRAccess: hasHRAccess(user),
    canViewEmployees: canViewEmployees(user),
    canManageUsers: canManageUsers(user),
    canApproveTransfers: canApproveTransfers(user),
    canViewTeamReports: canViewTeamReports(user),
    isDataAdmin: isDataAdmin(user),
  }
}
