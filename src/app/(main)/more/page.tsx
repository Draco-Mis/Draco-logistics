'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeftRight, ShieldCheck, BarChart3, Target, Upload, Download,
  Tag, Sparkles, UserMinus, ClipboardList, Contact, ChevronRight, LogOut,
  KeyRound, Send, User, type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase-client'
import { getRoleLabel } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { isAdmin as checkAdmin, isChairman as checkChairman, isDirectorOrManager as checkDirMgr, hasHRAccess, canViewEmployees, canViewTeamReports } from '@/lib/permissions'
import { APP_VERSION } from '@/lib/changelog'

export default function MorePage() {
  const { user } = useAuth()
  const supabase = createClient()
  const toast = useToast()
  // admin/chairman/manager 都能看到管理功能區塊
  const isAdmin = checkAdmin(user)
  const isChairman = checkChairman(user)
  const isDirectorOrManager = checkDirMgr(user)
  // 「管理功能」區塊顯隱由 adminLinks 是否有任何可見項決定（往下計算後再 derive）

  // 修改密碼狀態
  const [showPwdForm, setShowPwdForm] = useState(false)
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdError, setPwdError] = useState('')
  const [pwdSaving, setPwdSaving] = useState(false)

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwdError('')

    if (newPwd.length < 8) {
      setPwdError('密碼至少需 8 個字元')
      return
    }
    if (newPwd !== confirmPwd) {
      setPwdError('兩次輸入的密碼不一致')
      return
    }

    if (newPwd === 'Draco2026') {
      setPwdError('不能使用系統預設密碼，請設一個新的')
      return
    }

    setPwdSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPwd })

    if (error) {
      setPwdSaving(false)
      setPwdError('修改失敗：' + error.message)
      return
    }

    // 標記為已改過密碼
    await supabase.rpc('mark_password_changed')

    setPwdSaving(false)
    setNewPwd('')
    setConfirmPwd('')
    setShowPwdForm(false)
    toast.success('密碼修改成功')
  }

  // 每個連結標註哪些角色可見
  const adminLinks: { href: string; label: string; icon: LucideIcon; show: boolean }[] = [
    { href: '/transfers', label: '審核中心', icon: ArrowLeftRight,
      show: isAdmin || isChairman || isDirectorOrManager },
    { href: '/admin/users', label: '使用者管理', icon: ShieldCheck,
      show: isAdmin || isChairman },
    { href: '/admin/reports', label: '每週報表', icon: BarChart3,
      show: canViewTeamReports(user) },
    { href: '/admin/performance', label: '業務績效', icon: Target,
      show: canViewTeamReports(user) },
    { href: '/admin/import', label: 'CSV 匯入', icon: Upload,
      show: isAdmin },
    { href: '/admin/export', label: '匯出資料', icon: Download,
      show: isAdmin },
    { href: '/admin/batch-grade', label: '批次調整', icon: Tag,
      show: isAdmin || isChairman || isDirectorOrManager },
    { href: '/admin/duplicates', label: '重複客戶清理', icon: Sparkles,
      show: isAdmin },
    { href: '/admin/departed', label: '離職員工', icon: UserMinus,
      show: isAdmin || isChairman || isDirectorOrManager },
    { href: '/admin/assessments', label: '人才適性評估', icon: ClipboardList,
      show: hasHRAccess(user) },
    { href: '/admin/employees', label: '員工名冊', icon: Contact,
      show: canViewEmployees(user) },
  ]

  const hasManagement = adminLinks.some(item => item.show)

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">更多</h1>

      {/* 使用者資訊 */}
      <div className="card">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-accent-500 to-accent-700 text-white flex items-center justify-center text-xl font-bold ring-2 ring-accent-100 shadow-sm">
            {user?.chinese_name?.[0] || user?.name?.[0] || '?'}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 tracking-tight">{user?.chinese_name}（{user?.name}）</p>
            <p className="text-xs text-gray-500 truncate">
              {user?.email}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {getRoleLabel(user?.role)} · {user?.team}
            </p>
          </div>
        </div>
      </div>

      {/* 我的客戶快速入口（底部導覽沒有此項，補在這裡） */}
      <Link
        href="/my-customers"
        className="card card-hover group flex items-center gap-3"
      >
        <div className="w-10 h-10 rounded-xl bg-accent-50 flex items-center justify-center text-accent-600">
          <User className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-gray-900 tracking-tight">我的客戶</h2>
          <p className="text-xs text-gray-500">查看名下客戶與警示狀態</p>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
      </Link>

      {/* 修改密碼 */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-600">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 tracking-tight">帳號安全</h2>
              <p className="text-xs text-gray-500">修改登入密碼</p>
            </div>
          </div>
          {!showPwdForm && (
            <button onClick={() => setShowPwdForm(true)} className="btn-primary text-sm">
              修改密碼
            </button>
          )}
        </div>

        {showPwdForm && (
          <form onSubmit={handleChangePassword} className="mt-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                新密碼（至少 8 字元）
              </label>
              <input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                className="input-field"
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                再次輸入新密碼
              </label>
              <input
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                className="input-field"
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>
            {pwdError && <p className="text-red-500 text-sm">{pwdError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={pwdSaving} className="btn-primary text-sm flex-1">
                {pwdSaving ? '儲存中...' : '確認修改'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPwdForm(false)
                  setNewPwd('')
                  setConfirmPwd('')
                  setPwdError('')
                }}
                className="btn-secondary text-sm"
              >
                取消
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Telegram 綁定 */}
      <TelegramBindCard />

      {/* 管理功能 */}
      {hasManagement && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-3 tracking-tight">管理功能</h2>
          <div className="grid grid-cols-1 gap-0.5">
            {adminLinks
              .filter(l => l.show)
              .map(l => {
                const Icon = l.icon
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="group flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 transition-all duration-200 ease-apple"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gray-100 group-hover:bg-accent-50 flex items-center justify-center text-gray-600 group-hover:text-accent-600 transition-colors duration-200">
                      <Icon className="w-4.5 h-4.5" strokeWidth={2} />
                    </div>
                    <span className="font-medium text-gray-800 text-sm flex-1">{l.label}</span>
                    <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
                  </Link>
                )
              })}
          </div>
        </div>
      )}

      {/* 測試 Email（只有 admin/chairman 看得到）*/}
      {(isAdmin || isChairman) && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-2">Email 測試</h2>
          <p className="text-xs text-gray-500 mb-3">寄測試信到您的信箱 {user?.email}</p>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const r = await fetch('/api/admin/test-email?type=warning')
                const json = await r.json()
                if (json.ok) toast.success(`黃燈測試信已寄出至 ${json.sent_to}`)
                else toast.error(`寄送失敗：${json.error || '未知錯誤'}${json.skipped ? '（RESEND_API_KEY 尚未設定）' : ''}`)
              }}
              className="btn-secondary text-sm flex-1"
            >
              寄 75 天黃燈樣本
            </button>
            <button
              onClick={async () => {
                const r = await fetch('/api/admin/test-email?type=locked')
                const json = await r.json()
                if (json.ok) toast.success(`鎖檔測試信已寄出至 ${json.sent_to}`)
                else toast.error(`寄送失敗：${json.error || '未知錯誤'}${json.skipped ? '（RESEND_API_KEY 尚未設定）' : ''}`)
              }}
              className="btn-secondary text-sm flex-1"
            >
              寄 90 天鎖檔樣本
            </button>
          </div>
        </div>
      )}

      {/* 登出 */}
      <div className="card">
        <a
          href="/api/auth/signout"
          className="flex items-center justify-center gap-2 w-full py-2 text-red-500 hover:text-red-600 font-medium transition-colors duration-200"
        >
          <LogOut className="w-4 h-4" />
          登出
        </a>
      </div>

      {/* 版本資訊（點擊看更新內容） */}
      <button
        onClick={() => window.dispatchEvent(new Event('open-whatsnew'))}
        className="block mx-auto text-center text-xs text-gray-400 hover:text-gray-600 transition-colors py-4"
      >
        登泰國際物流營運管理平台 · Draco LOP · v{APP_VERSION}
      </button>
    </div>
  )
}

// ===================================================
// Telegram 綁定卡片
// ===================================================
function TelegramBindCard() {
  const { user } = useAuth()
  const supabase = createClient()
  const [telegramId, setTelegramId] = useState(user?.telegram_id || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setTelegramId(user?.telegram_id || '')
  }, [user])

  async function handleSave() {
    if (!user) return
    setSaving(true)
    const val = telegramId.trim() || null
    await supabase.from('users').update({ telegram_id: val }).eq('id', user.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-600">
            <Send className="w-5 h-5" />
          </div>
          <h2 className="font-semibold text-gray-900 tracking-tight">Telegram 通知</h2>
        </div>
        {saved && <span className="text-xs text-emerald-600 font-medium">✓ 已儲存</span>}
      </div>
      <p className="text-xs text-gray-500 mb-3 mt-2 leading-relaxed">
        綁定後系統會把重要通知（黃燈、鎖檔、留言等）推到你的 Telegram。
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={telegramId}
          onChange={(e) => setTelegramId(e.target.value)}
          className="input-field text-sm flex-1"
          placeholder="你的 Telegram Chat ID"
        />
        <button onClick={handleSave} disabled={saving} className="btn-primary text-sm shrink-0">
          {saving ? '儲存中' : '儲存'}
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        取得 Chat ID：在 Telegram 搜尋 @userinfobot 並傳送任意訊息即可取得。
      </p>
    </div>
  )
}
