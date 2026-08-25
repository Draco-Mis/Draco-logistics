'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'

interface OnlineUser {
  user_id: string
  name: string
}

interface OnlineContextValue {
  count: number
  users: OnlineUser[]
}

const OnlineContext = createContext<OnlineContextValue>({ count: 0, users: [] })

// 以 Supabase Realtime Presence 追蹤目前線上（登入中）的使用者。
// 用 user id 當 presence key → 同一人開多個分頁也只算 1 位。
export function OnlineProvider({ children }: { children: ReactNode }) {
  const { user, realUser } = useAuth()
  // 以實際登入者為準（偽裝檢視時仍算本人）
  const me = realUser || user
  const [users, setUsers] = useState<OnlineUser[]>([])

  useEffect(() => {
    if (!me) { setUsers([]); return }
    const supabase = createClient()
    const channel = supabase.channel('online-users', {
      config: { presence: { key: me.id } },
    })

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState() as Record<string, Array<{ name?: string }>>
      const list: OnlineUser[] = Object.entries(state).map(([key, metas]) => ({
        user_id: key,
        name: metas?.[0]?.name || '',
      }))
      setUsers(list)
    })

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ user_id: me.id, name: me.chinese_name || me.name })
      }
    })

    return () => { supabase.removeChannel(channel) }
  }, [me])

  return (
    <OnlineContext.Provider value={{ count: users.length, users }}>
      {children}
    </OnlineContext.Provider>
  )
}

export const useOnline = () => useContext(OnlineContext)
