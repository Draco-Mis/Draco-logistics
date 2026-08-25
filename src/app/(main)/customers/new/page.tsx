'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { User, CompanyCodeType, CustomerGrade, Industry } from '@/types/database'
import { cn, stringSimilarity } from '@/lib/utils'
import { useStockLookup, StockMatch } from '@/lib/use-stock-lookup'
import { INDUSTRIES } from '@/lib/constants'

// 從 DB 抓客戶的必要欄位做相似度比對
interface ExistingCustomer {
  id: string
  company_name: string
  assigned_user: { chinese_name: string; name: string } | null
}

// 相似度門檻
const WARN_THRESHOLD = 0.3  // 30% 以上顯示在相似清單
const FORCE_CONFIRM_THRESHOLD = 0.8  // 80% 以上強制確認

export default function NewCustomerPage() {
  const { user } = useAuth()
  const router = useRouter()
  const supabase = createClient()

  const [companyName, setCompanyName] = useState('')
  const [companyCodeType, setCompanyCodeType] = useState<CompanyCodeType | ''>('')
  const [companyCode, setCompanyCode] = useState('')
  const [codeAutoFilled, setCodeAutoFilled] = useState(false)
  const [industry, setIndustry] = useState<Industry | ''>('')

  // 自動從 TWSE/TPEx 查詢上市櫃代號
  const { matches: stockMatches } = useStockLookup(companyName)
  const [grade, setGrade] = useState<CustomerGrade | ''>('')
  const [assignedTo, setAssignedTo] = useState('')
  const [users, setUsers] = useState<User[]>([])
  const [allCustomers, setAllCustomers] = useState<ExistingCustomer[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // 強制確認對話框狀態
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [differentCompanyChecked, setDifferentCompanyChecked] = useState(false)

  useEffect(() => {
    // 一次抓所有使用者
    supabase.from('users').select('*').eq('is_active', true).order('name').then(({ data }) => {
      if (data) setUsers(data)
      if (user) setAssignedTo(user.id)
    })

    // 一次抓全部客戶名稱（分頁以避免 1000 筆上限）
    ;(async () => {
      const all: ExistingCustomer[] = []
      let from = 0
      while (true) {
        const { data } = await supabase
          .from('customers')
          .select('id, company_name, assigned_user:users!assigned_to(chinese_name, name)')
          .range(from, from + 999)
        if (!data || data.length === 0) break
        all.push(...(data as unknown as ExistingCustomer[]))
        if (data.length < 1000) break
        from += 1000
      }
      setAllCustomers(all)
    })()
  }, [user])

  // 即時計算相似客戶（前端純 JS，毫秒級）
  const similarMatches = useMemo(() => {
    const q = companyName.trim()
    if (q.length < 2 || allCustomers.length === 0) return []
    return allCustomers
      .map(c => ({ ...c, similarity: stringSimilarity(q, c.company_name) }))
      .filter(c => c.similarity >= WARN_THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 8)
  }, [companyName, allCustomers])

  const highestSimilarity = similarMatches[0]?.similarity ?? 0
  const needsForceConfirm = highestSimilarity >= FORCE_CONFIRM_THRESHOLD

  async function actuallyCreate() {
    setSubmitting(true)

    const { data: customer, error: insertError } = await supabase
      .from('customers')
      .insert({
        company_name: companyName.trim(),
        company_code_type: companyCodeType || null,
        company_code: companyCode || null,
        industry: industry || null,
        grade,
        assigned_to: assignedTo || user?.id,
        created_by: user?.id,
      })
      .select()
      .single()

    if (insertError) {
      setError('建檔失敗：' + insertError.message)
      setSubmitting(false)
      return
    }

    // 歷史軌跡
    await supabase.from('customer_history').insert({
      customer_id: customer.id,
      action_type: 'created',
      action_by: user?.id,
      note: needsForceConfirm
        ? `建立客戶：${companyName}（業務已確認與相似客戶為不同公司）`
        : `建立客戶：${companyName}`,
    })

    router.push(`/customers/${customer.id}`)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!grade) {
      setError('請選擇客戶等級')
      return
    }
    setError('')

    // 若相似度 >= 80% 強制跳出確認框
    if (needsForceConfirm) {
      setDifferentCompanyChecked(false)
      setShowConfirmDialog(true)
      return
    }

    await actuallyCreate()
  }

  async function handleConfirmAndCreate() {
    if (!differentCompanyChecked) return
    setShowConfirmDialog(false)
    await actuallyCreate()
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight mb-6">新增客戶</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Company Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            公司名稱 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="input-field"
            placeholder="請輸入公司名稱"
            required
          />

          {/* 相似公司警示 */}
          {similarMatches.length > 0 && (
            <div className={cn(
              'mt-2 p-3 rounded-lg border',
              needsForceConfirm
                ? 'bg-red-50 border-red-300'
                : 'bg-yellow-50 border-yellow-200'
            )}>
              <p className={cn(
                'text-sm font-medium mb-2',
                needsForceConfirm ? 'text-red-800' : 'text-yellow-800'
              )}>
                {needsForceConfirm
                  ? `🚨 發現高度相似的客戶（最高 ${Math.round(highestSimilarity * 100)}%），請確認是否為同一家公司`
                  : '⚠️ 發現相似公司名稱：'}
              </p>
              <div className="space-y-1">
                {similarMatches.map((s) => (
                  <div key={s.id} className="flex items-start justify-between gap-2 text-sm">
                    <Link
                      href={`/customers/${s.id}`}
                      target="_blank"
                      className={cn(
                        'flex-1',
                        needsForceConfirm ? 'text-red-700 hover:underline' : 'text-yellow-700'
                      )}
                    >
                      「<strong>{s.company_name}</strong>」
                      — {s.assigned_user?.chinese_name || '未指派'}
                    </Link>
                    <span className={cn(
                      'badge shrink-0 tabular-nums',
                      s.similarity >= FORCE_CONFIRM_THRESHOLD
                        ? 'bg-red-600 text-white'
                        : s.similarity >= 0.5
                          ? 'bg-yellow-500 text-white'
                          : 'bg-yellow-200 text-yellow-800'
                    )}>
                      {Math.round(s.similarity * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Company Code */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">公司類型</label>
            <select
              value={companyCodeType}
              onChange={(e) => { setCompanyCodeType(e.target.value as CompanyCodeType); setCodeAutoFilled(false) }}
              className="input-field"
            >
              <option value="">請選擇</option>
              <option value="上市">上市</option>
              <option value="上櫃">上櫃</option>
              <option value="興櫃">興櫃</option>
              <option value="一般公司">一般公司</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">公司代號</label>
            <input
              type="text"
              value={companyCode}
              onChange={(e) => { setCompanyCode(e.target.value); setCodeAutoFilled(false) }}
              className="input-field"
              placeholder="例如：1802"
            />
          </div>
        </div>
        {/* 自動帶入上市櫃代號 */}
        {stockMatches.length > 0 && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs font-medium text-blue-800 mb-2">
              🔍 偵測到上市櫃公司，點擊自動帶入代號：
            </p>
            <div className="flex flex-wrap gap-2">
              {stockMatches.map(m => (
                <button
                  key={m.code}
                  type="button"
                  onClick={() => {
                    setCompanyCodeType(m.type as CompanyCodeType)
                    setCompanyCode(m.code)
                    setCodeAutoFilled(true)
                  }}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-sm border transition',
                    codeAutoFilled && companyCode === m.code
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-100'
                  )}
                >
                  <span className="font-semibold">{m.code}</span>
                  <span className="text-xs ml-1 opacity-80">
                    {m.shortName || m.name}（{m.type}）
                  </span>
                </button>
              ))}
            </div>
            {codeAutoFilled && (
              <p className="text-xs text-blue-600 mt-1.5">
                ✅ 已自動帶入 {companyCodeType} {companyCode}
              </p>
            )}
          </div>
        )}

        {/* Industry */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">產業類別</label>
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value as Industry | '')}
            className="input-field"
          >
            <option value="">請選擇</option>
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </select>
        </div>

        {/* Grade */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            客戶等級 <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-3">
            {(['A', 'B', 'C'] as CustomerGrade[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGrade(g)}
                className={cn(
                  'flex-1 py-3 rounded-lg font-bold text-lg border-2 transition',
                  grade === g
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                )}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="mt-2 space-y-0.5 text-xs text-gray-500 leading-relaxed">
            <p><span className="font-semibold text-gray-600">A 級：</span>預估月均利潤 10 萬以上</p>
            <p><span className="font-semibold text-gray-600">B 級：</span>預估月均利潤 3 萬 ～ 10 萬</p>
            <p><span className="font-semibold text-gray-600">C 級：</span>預估月均利潤 3 萬以下或尚未出貨</p>
          </div>
        </div>

        {/* Assigned To */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">負責業務</label>
          <select
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            className="input-field"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.chinese_name}（{u.name}）- {u.team}
              </option>
            ))}
          </select>
        </div>

        {/* Read-only info */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">建檔人</label>
            <input type="text" value={user?.chinese_name || ''} className="input-field bg-gray-50" readOnly />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">建檔日期</label>
            <input type="text" value={new Date().toLocaleDateString('zh-TW')} className="input-field bg-gray-50" readOnly />
          </div>
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button type="submit" disabled={submitting} className="btn-primary w-full py-3">
          {submitting ? '建檔中...' : '確認建檔'}
        </button>
      </form>

      {/* 強制確認對話框（相似度 ≥ 80% 時彈出） */}
      {showConfirmDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => !submitting && setShowConfirmDialog(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">🚨</span>
              <h3 className="text-lg font-bold text-gray-900">高度相似客戶警告</h3>
            </div>

            <p className="text-sm text-gray-700 mb-3">
              您即將建立的客戶「<strong>{companyName}</strong>」
              與以下既有客戶相似度達 <strong className="text-red-600">{Math.round(highestSimilarity * 100)}%</strong>：
            </p>

            <div className="bg-red-50 rounded-lg p-3 mb-4 space-y-1 max-h-40 overflow-y-auto">
              {similarMatches
                .filter(s => s.similarity >= FORCE_CONFIRM_THRESHOLD)
                .map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-red-800">
                      「{s.company_name}」— {s.assigned_user?.chinese_name || '未指派'}
                    </span>
                    <span className="badge bg-red-600 text-white shrink-0">
                      {Math.round(s.similarity * 100)}%
                    </span>
                  </div>
                ))}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              <p className="text-xs text-amber-800 leading-relaxed">
                <strong>⚠️ 請仔細確認：</strong>重複建檔會造成資料混亂、影響客戶歸屬。
                若這是同一家公司，請直接在上方清單點擊查看既有客戶；
                若確實是不同公司（例如同名不同登記、子公司等），請勾選下方確認並填寫公司代號以利區分。
              </p>
            </div>

            <label className="flex items-start gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={differentCompanyChecked}
                onChange={(e) => setDifferentCompanyChecked(e.target.checked)}
                className="w-4 h-4 mt-0.5 text-primary-600"
              />
              <span className="text-sm text-gray-800">
                我已仔細確認，這與上述既有客戶<strong>不是同一家公司</strong>，我要繼續建檔。
              </span>
            </label>

            <div className="flex gap-2">
              <button
                onClick={handleConfirmAndCreate}
                disabled={!differentCompanyChecked || submitting}
                className="btn-primary flex-1 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? '建檔中...' : '確認是不同公司，繼續建檔'}
              </button>
              <button
                onClick={() => setShowConfirmDialog(false)}
                disabled={submitting}
                className="btn-secondary text-sm"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
