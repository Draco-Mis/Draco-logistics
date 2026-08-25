'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'

interface NotificationsContextValue {
  unreadCount: number
  refresh: () => void
}

const NotificationsContext = createContext<NotificationsContextValue>({
  unreadCount: 0,
  refresh: () => {},
})

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [unreadCount, setUnreadCount] = useState(0)

  const refresh = useCallback(async () => {
    if (!user) {
      setUnreadCount(0)
      return
    }
    const supabase = createClient()
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false)
    setUnreadCount(count || 0)
  }, [user])

  useEffect(() => {
    if (!user) {
      setUnreadCount(0)
      return
    }
    refresh()

    // 即時訂閱：自己的通知有任何 insert/update/delete 就重新計數
    const supabase = createClient()
    const channel = supabase
      .channel('notifications-badge')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => refresh(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, refresh])

  return (
    <NotificationsContext.Provider value={{ unreadCount, refresh }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export const useNotifications = () => useContext(NotificationsContext)
