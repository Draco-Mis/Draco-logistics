'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Users, UserPlus, Bell, MoreHorizontal, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNotifications } from '@/lib/notifications-context'

const navItems: { href: string; label: string; icon: LucideIcon; badge?: boolean }[] = [
  { href: '/dashboard', label: '首頁', icon: Home },
  { href: '/customers', label: '客戶', icon: Users },
  { href: '/customers/new', label: '新增', icon: UserPlus },
  { href: '/notifications', label: '通知', icon: Bell, badge: true },
  { href: '/more', label: '更多', icon: MoreHorizontal },
]

export default function BottomNav() {
  const pathname = usePathname()
  const { unreadCount } = useNotifications()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden safe-area-bottom glass-bar border-t border-gray-200/50">
      <div className="flex items-center justify-around h-16">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href
            || (item.href !== '/' && pathname.startsWith(item.href))
          const showBadge = item.badge && unreadCount > 0
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center w-full h-full text-[11px] transition-colors duration-200 ease-apple',
                isActive
                  ? 'text-accent-600'
                  : 'text-gray-400 hover:text-gray-600',
              )}
            >
              <span className="relative">
                <Icon className={cn('w-5 h-5 transition-transform duration-200', isActive && 'scale-110')} strokeWidth={2.2} />
                {showBadge && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none ring-2 ring-white dark:ring-primary-900">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </span>
              <span className="mt-1 font-medium tracking-tight">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
