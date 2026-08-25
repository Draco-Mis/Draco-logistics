'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import { useRouter } from 'next/navigation'
import { LogIn } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  // 邀請信 / 密碼重設流程：手動解析 URL hash 的 access_token
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    if (!hash || hash.length < 2) return

    const params = new URLSearchParams(hash.substring(1))

    const errorCode = params.get('error_code')
    const errorDesc = params.get('error_description')
    if (errorCode) {
      let msg = errorDesc?.replace(/\+/g, ' ') || '連結無效'
      if (errorCode === 'otp_expired') msg = '邀請連結已過期或被新連結取代，請聯絡管理員重新發送'
      setError(msg)
      window.history.replaceState(null, '', window.location.pathname)
      return
    }

    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    const type = params.get('type')

    if (!accessToken || !refreshToken) return

    supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    }).then(({ error }) => {
      if (error) {
        setError('連結已失效或無效，請聯絡管理員重發')
        return
      }
      window.history.replaceState(null, '', window.location.pathname)

      if (type === 'recovery' || type === 'invite') {
        router.push('/set-password')
      } else {
        router.push('/dashboard')
      }
    })
  }, [router, supabase])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError('帳號或密碼錯誤，請重新輸入')
      setLoading(false)
      return
    }

    fetch('/api/notifications/welcome', { method: 'POST' }).catch(() => {})

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-4">
      {/* 漸層 + 光暈背景，Apple 式深色登入頁 */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(54,163,255,0.15),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(96,165,250,0.1),transparent_50%)]" />

      <div className="relative w-full max-w-sm animate-scale-in">
        <div className="text-center mb-8">
          {/* logo 圓形徽章 */}
          <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-700 items-center justify-center text-white font-bold text-xl mb-4 shadow-glass ring-1 ring-white/20">
            D
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-1">Draco LOP</h1>
          <p className="text-primary-300 text-xs tracking-wide">Logistic Operation Platform</p>
          <p className="text-primary-400/70 text-xs mt-1">登泰國際物流股份有限公司</p>
        </div>

        <form
          onSubmit={handleLogin}
          className="backdrop-blur-2xl bg-white/95 rounded-3xl shadow-2xl p-7 space-y-5 ring-1 ring-white/10"
        >
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 tracking-tight">
              電子郵件
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none transition-all duration-200 ease-apple text-gray-900 bg-gray-50/50"
              placeholder="name@dracolog.com"
              required
              autoComplete="email"
            />
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <label className="block text-sm font-semibold text-gray-700 tracking-tight">
                密碼
              </label>
              <Link
                href="/forgot-password"
                className="text-xs text-accent-600 hover:text-accent-700 font-medium transition-colors duration-200"
              >
                忘記密碼？
              </Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none transition-all duration-200 ease-apple text-gray-900 bg-gray-50/50"
              placeholder="請輸入密碼"
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-red-700 text-sm text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-primary-700 to-primary-600 hover:from-primary-800 hover:to-primary-700 text-white font-semibold rounded-xl transition-all duration-200 ease-apple disabled:opacity-50 active:scale-[0.98] shadow-md hover:shadow-lg flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                登入中…
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                登入
              </>
            )}
          </button>
        </form>

        <p className="text-center text-primary-400/60 text-[11px] mt-6 tracking-tight">
          © 2026 登泰國際物流股份有限公司 Draco International Logistics
        </p>
      </div>
    </div>
  )
}
