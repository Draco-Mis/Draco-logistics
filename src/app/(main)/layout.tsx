'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { AuthProvider, useAuth } from '@/lib/auth-context'
import Sidebar from '@/components/layout/Sidebar'
import BottomNav from '@/components/layout/BottomNav'
import TopBar from '@/components/layout/TopBar'
import ImpersonationBanner from '@/components/layout/ImpersonationBanner'
import { CommandPalette } from '@/components/CommandPalette'
import { WhatsNew } from '@/components/WhatsNew'
import { RouteProgress } from '@/components/RouteProgress'
import { InstallPrompt } from '@/components/InstallPrompt'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'
import { NotificationsProvider } from '@/lib/notifications-context'
import { OnlineProvider } from '@/lib/presence-context'

function MainContent({ children }: { children: React.ReactNode }) {
  // 注意：force-password 檢查要看「實際登入者」(realUser)，不能看偽裝後的 user，
  // 否則偽裝一個沒改密碼的新使用者就會自動被踢到 /set-password。
  const { loading, session, realUser } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  // 未登入：導回登入頁（涵蓋登出、session 過期、直接造訪受保護頁）
  useEffect(() => {
    if (!loading && !session) {
      router.replace('/login')
    }
  }, [loading, session, router])

  // 首次登入強制改密碼：以實際登入者為準
  useEffect(() => {
    if (!loading && realUser && realUser.password_changed === false) {
      router.replace('/set-password?force=1')
    }
  }, [loading, realUser, router])

  if (loading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-gray-500 text-sm">載入中...</p>
        </div>
      </div>
    )
  }

  // 尚未改密碼：顯示轉址提示，不渲染實際頁面內容
  if (realUser && realUser.password_changed === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary-900">
        <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <NotificationsProvider>
      <OnlineProvider>
      <ToastProvider>
        <ConfirmProvider>
          <div className="min-h-screen bg-gray-50 dark:bg-gray-950 dark:text-gray-100 transition-colors">
            <RouteProgress />
            <ImpersonationBanner />
            <Sidebar />
            <TopBar />
            {/* key=pathname：每次換頁重新掛載 → 觸發淡入動畫，讓頁面切換有過場 */}
            <main key={pathname} className="md:ml-64 pb-20 md:pb-0 animate-fade-in">
              {children}
            </main>
            <BottomNav />
            <CommandPalette />
            <WhatsNew />
            <InstallPrompt />
          </div>
        </ConfirmProvider>
      </ToastProvider>
      </OnlineProvider>
    </NotificationsProvider>
  )
}

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthProvider>
      <MainContent>{children}</MainContent>
    </AuthProvider>
  )
}
