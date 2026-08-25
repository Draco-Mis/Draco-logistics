'use client'

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { createClient } from '@/lib/supabase-client'
import { User } from '@/types/database'
import type { Session } from '@supabase/supabase-js'

interface AuthContextType {
  session: Session | null
  // user：「有效」使用者——偽裝中時 = 被偽裝者，否則 = 實際登入者
  // 全 app 的權限檢查、選單顯示都應該用 user，這樣偽裝時自動套用對方視角
  user: User | null
  // realUser：永遠是實際登入者，banner / audit 才需要用
  realUser: User | null
  // viewingAs：被偽裝者；null 表示沒在偽裝
  viewingAs: User | null
  loading: boolean
  signOut: () => Promise<void>
  // 偽裝控制（僅 realUser.role === 'admin' 可呼叫；context 不做檢查，由 UI 守住）
  startImpersonation: (target: User) => void
  stopImpersonation: () => void
}

const LOGIN_TIME_KEY = 'draco_login_at'
const VIEW_AS_KEY = 'draco_view_as_user_id'
const SESSION_MAX_MS = 24 * 60 * 60 * 1000 // 24 小時

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  realUser: null,
  viewingAs: null,
  loading: true,
  signOut: async () => {},
  startImpersonation: () => {},
  stopImpersonation: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [realUser, setRealUser] = useState<User | null>(null)
  const [viewingAs, setViewingAs] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        try { localStorage.setItem(LOGIN_TIME_KEY, String(Date.now())) } catch {}
      }
      if (event === 'SIGNED_OUT') {
        try { localStorage.removeItem(LOGIN_TIME_KEY) } catch {}
        // 登出時清掉偽裝狀態，避免下一個登入者帶到
        try { sessionStorage.removeItem(VIEW_AS_KEY) } catch {}
        setViewingAs(null)
        clearExpiryTimer()
      }
      handleSession(session)
    })

    return () => {
      subscription.unsubscribe()
      clearExpiryTimer()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function clearExpiryTimer() {
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current)
      expiryTimerRef.current = null
    }
  }

  function handleSession(s: Session | null) {
    setSession(s)
    if (!s) {
      setRealUser(null)
      setViewingAs(null)
      setLoading(false)
      clearExpiryTimer()
      return
    }

    let loginAt = 0
    try { loginAt = Number(localStorage.getItem(LOGIN_TIME_KEY)) || 0 } catch {}
    if (!loginAt) {
      loginAt = Date.now()
      try { localStorage.setItem(LOGIN_TIME_KEY, String(loginAt)) } catch {}
    }
    const remaining = SESSION_MAX_MS - (Date.now() - loginAt)
    if (remaining <= 0) {
      signOut()
      return
    }
    clearExpiryTimer()
    expiryTimerRef.current = setTimeout(() => { signOut() }, remaining)

    fetchUser(s.user.id)
  }

  async function fetchUser(authId: string) {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', authId)
      .single()

    if (data && data.is_active === false) {
      setRealUser(null)
      setViewingAs(null)
      setLoading(false)
      signOut()
      return
    }

    setRealUser(data)
    setLoading(false)

    // 嘗試還原偽裝狀態（重新整理時）
    // 只有實際登入者是 admin 才能繼續偽裝；別人登入會被清掉
    let viewAsId: string | null = null
    try { viewAsId = sessionStorage.getItem(VIEW_AS_KEY) } catch {}
    if (viewAsId && data?.role === 'admin' && viewAsId !== data.id) {
      const { data: target } = await supabase
        .from('users')
        .select('*')
        .eq('id', viewAsId)
        .single()
      if (target) setViewingAs(target)
      else { try { sessionStorage.removeItem(VIEW_AS_KEY) } catch {} }
    } else if (viewAsId && data?.role !== 'admin') {
      try { sessionStorage.removeItem(VIEW_AS_KEY) } catch {}
      setViewingAs(null)
    }
  }

  function startImpersonation(target: User) {
    if (!realUser || realUser.role !== 'admin') return
    if (target.id === realUser.id) return // 偽裝自己沒意義
    try { sessionStorage.setItem(VIEW_AS_KEY, target.id) } catch {}
    setViewingAs(target)
  }

  function stopImpersonation() {
    try { sessionStorage.removeItem(VIEW_AS_KEY) } catch {}
    setViewingAs(null)
  }

  async function signOut() {
    try { localStorage.removeItem(LOGIN_TIME_KEY) } catch {}
    try { sessionStorage.removeItem(VIEW_AS_KEY) } catch {}
    clearExpiryTimer()
    if (typeof window !== 'undefined') {
      window.location.href = '/api/auth/signout'
    }
  }

  // 對外暴露的 user 是「有效」使用者：偽裝中 = 被偽裝者，否則 = 實際登入者
  const effectiveUser = viewingAs ?? realUser

  return (
    <AuthContext.Provider
      value={{
        session,
        user: effectiveUser,
        realUser,
        viewingAs,
        loading,
        signOut,
        startImpersonation,
        stopImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
