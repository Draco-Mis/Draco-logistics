'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Sun, Moon, LogOut, Bell, ChevronLeft } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useTheme } from '@/lib/theme-context'
import { useNotifications } from '@/lib/notifications-context'
import { useOnline } from '@/lib/presence-context'

// 深層頁面（非底部導覽的 5 個頂層頁）顯示返回鍵 + 頁面標題
const TITLE_MAP: { prefix: string; title: string }[] = [
  { prefix: '/my-customers', title: '我的客戶' },
  { prefix: '/transfers', title: '審核中心' },
  { prefix: '/customers/new', title: '新增客戶' },
  { prefix: '/customers/', title: '客戶詳情' },
  { prefix: '/admin/users', title: '使用者管理' },
  { prefix: '/admin/employees', title: '員工名冊' },
  { prefix: '/admin/departed', title: '離職員工' },
  { prefix: '/admin/assessments', title: '人才適性評估' },
  { prefix: '/admin/batch-grade', title: '批次調整' },
  { prefix: '/admin/import', title: '客戶匯入' },
  { prefix: '/admin/export', title: '匯出資料' },
  { prefix: '/admin/duplicates', title: '重複客戶清理' },
  { prefix: '/admin/reports', title: '每週報表' },
  { prefix: '/admin/performance', title: '業務績效' },
  { prefix: '/admin', title: '管理' },
]

const TOP_LEVEL = ['/dashboard', '/customers', '/customers/new', '/notifications', '/more']

export default function TopBar() {
  const { user } = useAuth()
  const { dark, toggle } = useTheme()
  const { unreadCount } = useNotifications()
  const { count: onlineCount, users: onlineUsers } = useOnline()
  const router = useRouter()
  const pathname = usePathname()

  // /customers/new 屬底部導覽項，不算深層；其餘 /customers/xxx 才顯示返回
  const isTopLevel = TOP_LEVEL.includes(pathname)
  const matched = !isTopLevel ? TITLE_MAP.find(t => pathname.startsWith(t.prefix)) : undefined
  const showBack = !!matched

  return (
    <header className="sticky top-0 z-40 glass-bar px-4 py-3 flex items-center justify-between md:hidden">
      <div className="flex items-center gap-2 min-w-0">
        {showBack && (
          <button
            onClick={() => router.back()}
            className="p-1.5 -ml-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors duration-200 shrink-0"
            aria-label="返回"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        <h1 className="text-base font-bold tracking-tight text-gray-900 truncate">
          {matched ? matched.title : 'Draco LOP'}
        </h1>
      </div>
      <div className="flex items-center gap-1.5">
        {onlineCount > 0 && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium mr-0.5"
            title={`線上：${onlineUsers.map(u => u.name).filter(Boolean).join('、')}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {onlineCount}
          </span>
        )}
        <Link
          href="/notifications"
          className="relative p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors duration-200"
          aria-label="通知"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none ring-2 ring-white dark:ring-primary-900">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
        <button
          onClick={toggle}
          className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors duration-200"
          title={dark ? '日間模式' : '夜間模式'}
          aria-label={dark ? '切換為日間模式' : '切換為夜間模式'}
        >
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        <a
          href="/api/auth/signout"
          className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors duration-200"
          title="登出"
          aria-label="登出"
        >
          <LogOut className="w-4 h-4" />
        </a>
      </div>
    </header>
  )
}
