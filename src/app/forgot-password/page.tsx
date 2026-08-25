'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import { Mail, ArrowLeft, Send } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    setSubmitting(true)

    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${window.location.origin}/login`,
    })

    if (resetErr) {
      console.warn('resetPasswordForEmail error:', resetErr)
    }
    setSentTo(trimmed)
    setSubmitting(false)
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(54,163,255,0.15),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(96,165,250,0.1),transparent_50%)]" />

      <div className="relative w-full max-w-sm animate-scale-in">
        <div className="text-center mb-8">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-700 items-center justify-center text-white mb-4 shadow-glass ring-1 ring-white/20">
            <Mail className="w-6 h-6" strokeWidth={2.2} />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-1">忘記密碼</h1>
          <p className="text-primary-300/80 text-xs">登泰人才適性評估平台</p>
        </div>

        {!sentTo ? (
          <form
            onSubmit={handleSubmit}
            className="backdrop-blur-2xl bg-white/95 rounded-3xl shadow-2xl p-7 space-y-5 ring-1 ring-white/10"
          >
            <p className="text-sm text-gray-600 leading-relaxed">
              請輸入您註冊時的電子郵件，系統會寄出密碼重設信件到您的信箱。
            </p>

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
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-gradient-to-r from-primary-700 to-primary-600 hover:from-primary-800 hover:to-primary-700 text-white font-semibold rounded-xl transition-all duration-200 ease-apple disabled:opacity-50 active:scale-[0.98] shadow-md hover:shadow-lg flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  寄送中…
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  寄出重設信
                </>
              )}
            </button>

            <Link
              href="/login"
              className="flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200 pt-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              返回登入
            </Link>
          </form>
        ) : (
          <div className="backdrop-blur-2xl bg-white/95 rounded-3xl shadow-2xl p-7 space-y-5 text-center ring-1 ring-white/10">
            <div className="inline-flex w-16 h-16 rounded-full bg-gradient-to-br from-green-400 to-green-600 items-center justify-center text-white shadow-lg ring-1 ring-white/30 animate-scale-in">
              <Mail className="w-7 h-7" strokeWidth={2.2} />
            </div>
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">重設信已寄出</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              已寄出密碼重設信件至：
              <br />
              <span className="font-semibold text-gray-900">{sentTo}</span>
            </p>
            <div className="bg-accent-50 border border-accent-100 rounded-2xl p-4 text-xs text-accent-900 text-left leading-relaxed">
              <p className="font-bold mb-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-600" />
                接下來：
              </p>
              <ol className="space-y-1.5 pl-3 list-decimal">
                <li>到您的信箱收信（含垃圾信件匣）</li>
                <li>點信件中的「重設密碼」連結</li>
                <li>輸入新密碼即可完成</li>
              </ol>
            </div>
            <p className="text-xs text-gray-500">
              連結有效期通常為 1 小時，若無收到信件請稍候再試或聯絡管理員。
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <Link
                href="/login"
                className="w-full py-3 bg-gradient-to-r from-primary-700 to-primary-600 hover:from-primary-800 hover:to-primary-700 text-white font-semibold rounded-xl transition-all duration-200 ease-apple active:scale-[0.98] shadow-md hover:shadow-lg text-center"
              >
                返回登入
              </Link>
              <button
                onClick={() => { setSentTo(null); setEmail('') }}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200"
              >
                換一個 email 重新寄送
              </button>
            </div>
          </div>
        )}

        <p className="text-center text-primary-400/60 text-[11px] mt-6 tracking-tight">
          © 2026 登泰國際物流股份有限公司
        </p>
      </div>
    </div>
  )
}
