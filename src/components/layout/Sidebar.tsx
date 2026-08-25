'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Users, UserPlus, User, Bell, Settings, ArrowLeftRight, ShieldCheck,
  BarChart3, Target, Upload, Download, Tag, Sparkles, UserMinus, ClipboardList,
  Contact, Sun, Moon, LogOut, ChevronDown, Home, type LucideIcon,
} from 'lucide-react'
import { useShortcutKey } from '@/lib/use-platform'
import { useAuth } from '@/lib/auth-context'
import { useTheme } from '@/lib/theme-context'
import { useNotifications } from '@/lib/notifications-context'
import { useOnline } from '@/lib/presence-context'
import { cn } from '@/lib/utils'
import { isAdmin as checkAdmin, isChairman as checkChairman, isDirectorOrManager as checkDirMgr, hasHRAccess, canViewEmployees, canViewTeamReports } from '@/lib/permissions'
import { APP_VERSION } from '@/lib/changelog'

const mainNav: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/dashboard', label: '首頁', icon: Home },
  { href: '/customers', label: '客戶列表', icon: Users },
  { href: '/customers/new', label: '新增客戶', icon: UserPlus },
  { href: '/my-customers', label: '我的客戶', icon: User },
  { href: '/notifications', label: '通知中心', icon: Bell },
  { href: '/more', label: '帳號設定', icon: Settings },
]

// 特殊職稱對應表：部分使用者在側邊欄顯示自訂職稱
const CUSTOM_TITLES: Record<string, string> = {
  'hans@dracolog.com': '管理員 業務部部長',
  'apple@dracolog.com': '副總 管理員',
}

function getDisplayTitle(email?: string, role?: string, team?: string): string {
  if (email && CUSTOM_TITLES[email]) return CUSTOM_TITLES[email]
  const roleLabels: Record<string, string> = {
    admin: '管理員', chairman: '董事長', director: '部長', manager: '課長',
    deputy_manager: '副課長', finance: '財務', hr: '人資', sales: '業務',
  }
  const roleLabel = role && roleLabels[role] ? roleLabels[role] : ''
  return [roleLabel, team].filter(Boolean).join(' · ')
}

export default function Sidebar() {
  const pathname = usePathname()
  const { user } = useAuth()
  const isAdmin = checkAdmin(user)
  const isChairman = checkChairman(user)
  const isDirectorOrManager = checkDirMgr(user)
  const { dark, toggle: toggleTheme } = useTheme()
  const shortcutKey = useShortcutKey()
  const { unreadCount } = useNotifications()
  const { count: onlineCount, users: onlineUsers } = useOnline()

  // 更新公告「已看過」狀態：未看過時版本徽章顯示 NEW 小紅點
  const [whatsNewSeen, setWhatsNewSeen] = useState(true)
  useEffect(() => {
    const check = () => {
      try { setWhatsNewSeen(localStorage.getItem('draco:whatsnew-seen') === APP_VERSION) }
      catch { setWhatsNewSeen(true) }
    }
    check()
    window.addEventListener('whatsnew-seen', check)
    return () => window.removeEventListener('whatsnew-seen', check)
  }, [])

  type Item = { href: string; label: string; icon: LucideIcon; show: boolean }
  type Group = { key: string; label: string; items: Item[] }

  const adminGroups: Group[] = [
    {
      key: 'customer',
      label: '客戶資料管理',
      items: [
        { href: '/admin/import', label: '客戶匯入', icon: Upload, show: isAdmin },
        { href: '/admin/export', label: '匯出資料', icon: Download, show: isAdmin },
        { href: '/admin/batch-grade', label: '批次調整', icon: Tag,
          show: isAdmin || isChairman || isDirectorOrManager },
        { href: '/admin/duplicates', label: '重複客戶清理', icon: Sparkles, show: isAdmin },
      ],
    },
    {
      key: 'reports',
      label: '報表分析',
      items: [
        { href: '/admin/reports', label: '每週報表', icon: BarChart3,
          show: canViewTeamReports(user) },
        { href: '/admin/performance', label: '業務績效', icon: Target,
          show: canViewTeamReports(user) },
      ],
    },
    {
      key: 'talent',
      label: '人才管理',
      items: [
        { href: '/admin/assessments', label: '人才適性評估', icon: ClipboardList,
          show: hasHRAccess(user) },
        { href: '/admin/employees', label: '員工名冊', icon: Contact,
          show: canViewEmployees(user) },
        { href: '/admin/departed', label: '離職員工', icon: UserMinus,
          show: isAdmin || isChairman || isDirectorOrManager },
      ],
    },
    {
      key: 'system',
      label: '系統與權限',
      items: [
        { href: '/admin/users', label: '使用者管理', icon: ShieldCheck,
          show: isAdmin || isChairman },
        { href: '/transfers', label: '審核中心', icon: ArrowLeftRight,
          show: isAdmin || isChairman || isDirectorOrManager },
      ],
    },
  ]

  const visibleGroups = adminGroups
    .map(g => ({ ...g, items: g.items.filter(i => i.show) }))
    .filter(g => g.items.length > 0)

  const hasManagement = visibleGroups.length > 0

  // 群組摺疊狀態（saved in localStorage）。預設：含當前路徑的群組展開、其餘摺疊
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem('sidebar-group-collapsed')
      if (saved) {
        setCollapsed(JSON.parse(saved))
        return
      }
    } catch {/* ignore */}
    // 沒有保存過 → 預設值：當前路徑所在群組展開、其餘摺疊
    const init: Record<string, boolean> = {}
    for (const g of adminGroups) {
      const hasActive = g.items.some(i => pathname.startsWith(i.href))
      init[g.key] = !hasActive  // true = 摺疊
    }
    setCollapsed(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleGroup(key: string) {
    setCollapsed(prev => {
      const next = { ...prev, [key]: !prev[key] }
      try { localStorage.setItem('sidebar-group-collapsed', JSON.stringify(next)) } catch {/* ignore */}
      return next
    })
  }

  return (
    <aside className="hidden md:flex md:flex-col w-64 glass-dark text-white min-h-screen fixed left-0 top-0 shadow-glass">
      <div className="p-6 border-b border-white/5">
        <h1 className="text-xl font-bold tracking-tight">Draco LOP</h1>
        <p className="text-primary-300/80 text-xs mt-1 tracking-tight">登泰國際物流股份有限公司</p>
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-primary-300/60">
          <span>快速搜尋</span>
          <kbd className="bg-white/10 text-white px-1.5 py-0.5 rounded font-mono text-[10px]">{shortcutKey}</kbd>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {mainNav.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href
            || (item.href !== '/' && pathname.startsWith(item.href) && item.href !== '/customers/new')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ease-apple',
                isActive
                  ? 'bg-white/10 text-white shadow-inset-soft'
                  : 'text-primary-200/80 hover:bg-white/5 hover:text-white',
              )}
            >
              <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
              <span className="font-medium">{item.label}</span>
              {item.href === '/notifications' && unreadCount > 0 && (
                <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
          )
        })}

        {hasManagement && (
          <>
            <div className="pt-5 pb-2">
              <p className="text-[11px] text-primary-400/60 uppercase tracking-widest px-3 font-semibold">
                Management
              </p>
            </div>
            {visibleGroups.map(group => {
              const isCollapsed = !!collapsed[group.key]
              const groupHasActive = group.items.some(i => pathname.startsWith(i.href))
              return (
                <div key={group.key} className="mb-0.5">
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-all duration-200',
                      groupHasActive
                        ? 'text-white/90'
                        : 'text-primary-300/70 hover:text-white/90',
                    )}
                  >
                    <span className="font-semibold tracking-wide">{group.label}</span>
                    <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', isCollapsed ? '-rotate-90' : 'rotate-0')} />
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-0.5 mt-0.5">
                      {group.items.map(item => {
                        const Icon = item.icon
                        const isActive = pathname.startsWith(item.href)
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                              'group flex items-center gap-3 pl-5 pr-3 py-2 rounded-xl text-sm transition-all duration-200 ease-apple',
                              isActive
                                ? 'bg-white/10 text-white shadow-inset-soft'
                                : 'text-primary-200/80 hover:bg-white/5 hover:text-white',
                            )}
                          >
                            <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
                            <span className="font-medium">{item.label}</span>
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </nav>

      <div className="p-4 border-t border-white/5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center text-sm font-semibold ring-1 ring-white/10">
            {user?.name?.[0] || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{user?.chinese_name || user?.name}</p>
            <p className="text-[11px] text-primary-300/70 truncate">
              {getDisplayTitle(user?.email, user?.role, user?.team)}
              {onlineCount > 0 && (
                <span
                  className="ml-1.5 inline-flex items-center gap-1 text-emerald-400"
                  title={`線上：${onlineUsers.map(u => u.name).filter(Boolean).join('、')}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  線上 {onlineCount}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between px-1 py-1">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-1.5 text-xs text-primary-300/80 hover:text-white transition-colors duration-200"
            title={dark ? '切換為日間模式' : '切換為夜間模式'}
          >
            {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            {dark ? '日間' : '夜間'}
          </button>
          <a
            href="/api/auth/signout"
            className="flex items-center gap-1.5 text-xs text-primary-300/80 hover:text-white transition-colors duration-200"
          >
            <LogOut className="w-3.5 h-3.5" />
            登出
          </a>
        </div>
        {/* 「✨ 更新內容」入口：有未看過的更新時醒目，看過後收斂低調 */}
        <button
          onClick={() => window.dispatchEvent(new Event('open-whatsnew'))}
          title="查看更新內容"
          className={cn(
            'mt-2 w-full flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] transition-all duration-200',
            whatsNewSeen
              ? 'text-primary-300/60 hover:text-white hover:bg-white/5'
              : 'bg-accent-500/15 text-accent-200 ring-1 ring-accent-400/30 hover:bg-accent-500/25 font-medium',
          )}
        >
          <Sparkles className={cn('w-3.5 h-3.5', !whatsNewSeen && 'text-accent-300')} />
          {whatsNewSeen ? (
            <span>更新內容 · v{APP_VERSION}</span>
          ) : (
            <>
              <span>有新功能可看</span>
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
