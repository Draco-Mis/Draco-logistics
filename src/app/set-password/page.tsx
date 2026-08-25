'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

export default function SetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-primary-900">
        <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <SetPasswordInner />
    </Suspense>
  )
}

function SetPasswordInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // 模式：
  //   'force'    = 首次登入強制改密碼（?force=1；正常 session）
  //   'recovery' = 透過邀請信 / 密碼重設信連進來（URL 含 hash token）
  const [mode, setMode] = useState<'force' | 'recovery' | null>(null)
  const [checking, setChecking] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [userEmail, setUserEmail] = useState('')

  useEffect(() => {
    const isForceMode = searchParams.get('force') === '1'
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    const hasRecoveryHash = hash.includes('access_token') || hash.includes('type=recovery')

    // 判斷模式
    if (isForceMode) setMode('force')
    else if (hasRecoveryHash) setMode('recovery')
    else setMode('force') // 預設當 force 處理（避免未知情境）

    let resolved = false
    function resolve(session: { user?: { email?: string | null } } | null) {
      if (resolved) return
      resolved = true
      if (session?.user) {
        setAuthorized(true)
        setUserEmail(session.user.email || '')
      }
      setChecking(false)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) resolve(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session?.user) resolve(session)
      }
    })

    const timeout = setTimeout(() => resolve(null), 2000)
    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('密碼至少需 8 個字元')
      return
    }
    if (password !== confirm) {
      setError('兩次輸入的密碼不一致')
      return
    }
    if (password === 'Draco2026') {
      setError('不能使用系統預設密碼，請設一個新的')
      return
    }

    setSaving(true)
    const { error: updErr } = await supabase.auth.updateUser({ password })
    if (updErr) {
      setError('設定失敗：' + updErr.message)
      setSaving(false)
      return
    }

    // 呼叫 RPC 把 password_changed 標記為 true
    const { error: rpcErr } = await supabase.rpc('mark_password_changed')
    if (rpcErr) {
      console.warn('mark_password_changed RPC 失敗：', rpcErr)
      // 非致命錯誤，繼續流程
    }

    if (mode === 'recovery') {
      // 邀請信流程：session 是 recovery token，改完登出並回登入
      await supabase.auth.signOut()
      alert('✅ 密碼設定成功！請用新密碼登入。')
      router.push('/login')
    } else {
      // 首次登入強制改：已經是正常 session，直接進系統
      alert('✅ 密碼修改完成！')
      router.push('/customers')
      router.refresh()
    }
  }

  if (checking || mode === null) {
    return (
      <div className="min-h-screen relative overflow-hidden flex items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800" />
        <div className="relative w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  if (!authorized) {
    return (
      <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-4">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(54,163,255,0.15),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(96,165,250,0.1),transparent_50%)]" />
        <div className="relative w-full max-w-sm animate-scale-in">
          <div className="backdrop-blur-2xl bg-white/95 rounded-3xl shadow-2xl p-7 text-center ring-1 ring-white/10">
            <h1 className="text-xl font-bold text-gray-900 mb-2 tracking-tight">連結已失效</h1>
            <p className="text-sm text-gray-600 mb-5 leading-relaxed">
              此邀請連結已過期或無效，請聯絡管理員重新發送邀請信。
            </p>
            <button
              onClick={() => router.push('/login')}
              className="w-full py-3 bg-gradient-to-r from-primary-700 to-primary-600 hover:from-primary-800 hover:to-primary-700 text-white font-semibold rounded-xl transition-all duration-200 ease-apple active:scale-[0.98] shadow-md"
            >
              回登入頁
            </button>
          </div>
        </div>
      </div>
    )
  }

  const isForce = mode === 'force'

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(54,163,255,0.15),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(96,165,250,0.1),transparent_50%)]" />

      <div className="relative w-full max-w-sm animate-scale-in">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight mb-1">
            {isForce ? '請先修改密碼' : '設定您的密碼'}
          </h1>
          <p className="text-primary-300/80 text-xs">登泰人才適性評估平台 · Draco LOP</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="backdrop-blur-2xl bg-white/95 rounded-3xl shadow-2xl p-7 space-y-5 ring-1 ring-white/10"
        >
          {isForce && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 leading-relaxed">
              ⚠️ 這是您第一次登入，為了帳號安全，請設定屬於您自己的密碼。改完後才能使用系統。
            </div>
          )}

          <div className="px-1">
            <p className="text-xs text-gray-500 mb-1 tracking-tight">電子郵件</p>
            <p className="text-sm font-semibold text-gray-900">{userEmail}</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 tracking-tight">
              新密碼
              <span className="text-xs text-gray-400 font-normal ml-2">（至少 8 字元，不能是 Draco2026）</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none transition-all duration-200 ease-apple text-gray-900 bg-gray-50/50"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 tracking-tight">
              再次輸入密碼
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none transition-all duration-200 ease-apple text-gray-900 bg-gray-50/50"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-red-700 text-sm text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 bg-gradient-to-r from-primary-700 to-primary-600 hover:from-primary-800 hover:to-primary-700 text-white font-semibold rounded-xl transition-all duration-200 ease-apple disabled:opacity-50 active:scale-[0.98] shadow-md hover:shadow-lg"
          >
            {saving ? '設定中…' : isForce ? '確認修改並進入系統' : '設定密碼'}
          </button>
        </form>
      </div>
    </div>
  )
}
