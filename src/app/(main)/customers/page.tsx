'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { Customer, User } from '@/types/database'
import { getRemainingDays, formatDate, getGradeColor, getWarningTier, getTierShortLabel, getTierColor, getCustomerCompleteness, cn } from '@/lib/utils'
import { useRealtimeStatus } from '@/lib/use-realtime'
import { RealtimeBadge } from '@/components/RealtimeBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonListItem } from '@/components/ui/Skeleton'
import { INDUSTRIES, TEAMS } from '@/lib/constants'
import { Users } from 'lucide-react'

const PAGE_SIZE = 20
const FILTERS_KEY = 'draco:customers-filters'

// 狀態篩選值 → 顯示標籤（給篩選標籤 chips 用）
const STATUS_FILTER_LABELS: Record<string, string> = {
  developing: '開發中', tier_30: '關注', tier_60: '注意', tier_75: '警示', tier_80: '緊急',
  reactivating: '重新開發中', negotiating: '洽談中', completed: '已成交',
  long_term: '長期合作', abandoned: '未成交', locked: '鎖檔暫停',
}

// 記住上次篩選：從 localStorage 讀回（僅在瀏覽器）
function loadSavedFilters(): Record<string, string | boolean> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}') } catch { return {} }
}

export default function CustomersPage() {
  const { user } = useAuth()
  const supabase = createClient()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)

  // Filters（初始值從上次記住的篩選帶回）
  const saved = loadSavedFilters()
  const [search, setSearch] = useState<string>((saved.search as string) || '')
  const [statusFilter, setStatusFilter] = useState<string>((saved.statusFilter as string) || '')
  const [gradeFilter, setGradeFilter] = useState<string>((saved.gradeFilter as string) || '')
  const [assignedFilter, setAssignedFilter] = useState<string>((saved.assignedFilter as string) || '')
  const [teamFilter, setTeamFilter] = useState<string>((saved.teamFilter as string) || '')
  const [industryFilter, setIndustryFilter] = useState<string>((saved.industryFilter as string) || '')
  const [incompleteOnly, setIncompleteOnly] = useState<boolean>(!!saved.incompleteOnly)

  // 分頁
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    fetchData()
  }, [])

  // 篩選條件變動 → 存回 localStorage（記住上次視圖）
  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify({
        search, statusFilter, gradeFilter, assignedFilter, teamFilter, industryFilter, incompleteOnly,
      }))
    } catch {/* ignore */}
  }, [search, statusFilter, gradeFilter, assignedFilter, teamFilter, industryFilter, incompleteOnly])

  function clearAllFilters() {
    setSearch(''); setStatusFilter(''); setGradeFilter(''); setAssignedFilter('')
    setTeamFilter(''); setIndustryFilter(''); setIncompleteOnly(false)
  }

  // Realtime：訂閱 customers 表變動 → 自動 refetch
  const { status: rtStatus, lastUpdated, markUpdated } = useRealtimeStatus({
    channelName: 'customers-list',
    tables: [{ table: 'customers' }],
    onChange: () => fetchData(),
  })

  // 篩選條件改變時自動跳回第 1 頁
  useEffect(() => {
    setCurrentPage(1)
  }, [search, statusFilter, gradeFilter, assignedFilter, teamFilter, industryFilter, incompleteOnly])

  // 搜尋輸入 >= 2 字才額外打 API，回傳留言文字命中的客戶 ID 集合
  const [commentMatchedIds, setCommentMatchedIds] = useState<Set<string>>(new Set())
  // 各客戶的聯絡人數（由 customers query 內嵌 count 取得，無需獨立查詢全部欄位）
  const [contactsCountMap, setContactsCountMap] = useState<Map<string, number>>(new Map())

  async function fetchData() {
    // 分頁迴圈撈全部客戶（避免 PostgREST 預設 1000 筆上限）
    const all: Customer[] = []
    let from = 0
    const size = 1000
    // 防呆：priority_flag 欄位（migration 041）若尚未建立，退回不帶 priority 的查詢，
    // 避免整個列表因缺欄位而查詢失敗、變成空白。
    const BASE_COLS = 'id, company_name, company_code, company_code_type, industry, grade, status, created_date, last_contact_date, assigned_to, assigned_user:users!assigned_to(chinese_name, name, team), customer_contacts(count)'
    let cols = `id, company_name, company_code, company_code_type, industry, grade, status, created_date, last_contact_date, assigned_to, priority_flag, priority_note, assigned_user:users!assigned_to(chinese_name, name, team), customer_contacts(count)`
    let usePriority = true
    while (true) {
      let q = supabase.from('customers').select(cols)
      if (usePriority) q = q.order('priority_flag', { ascending: false })
      const { data, error } = await q
        .order('created_date', { ascending: false })
        .range(from, from + size - 1)
      if (error) {
        if (usePriority && /priority/.test(error.message)) {
          // 041 尚未套用 → 退回基本欄位重試
          cols = BASE_COLS
          usePriority = false
          continue
        }
        console.error('[customers] 查詢失敗:', error.message)
        break
      }
      if (!data || data.length === 0) break
      all.push(...(data as unknown as Customer[]))
      if (data.length < size) break
      from += size
    }

    const { data: usersData } = await supabase.from('users').select('*').eq('is_active', true)

    setCustomers(all)
    const map = new Map<string, number>()
    for (const c of all) {
      const cnt = (c as { customer_contacts?: { count: number }[] }).customer_contacts?.[0]?.count ?? 0
      map.set(c.id, cnt)
    }
    setContactsCountMap(map)
    markUpdated()

    if (usersData) setUsers(usersData)

    setLoading(false)
  }

  // 搜尋留言：只在輸入 >= 2 字時才打 API，並 debounce 300ms 避免每打一字就查
  useEffect(() => {
    const term = search.trim()
    if (term.length < 2) {
      setCommentMatchedIds(new Set())
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('comments')
        .select('customer_id')
        .ilike('content', `%${term}%`)
      if (!cancelled && data) {
        setCommentMatchedIds(new Set((data as { customer_id: string }[]).map(d => d.customer_id)))
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const filteredCustomers = useMemo(() => {
    const searchLower = search.trim().toLowerCase()
    return customers.filter((c) => {
      // 搜尋範圍：公司名稱 + 負責業務中/英文名 + 備註內容（只有 search >= 2 字才會 API 命中）
      if (searchLower) {
        const companyMatch = c.company_name.toLowerCase().includes(searchLower)
        const assignedName = (c.assigned_user?.chinese_name || '').toLowerCase()
        const assignedEng = (c.assigned_user?.name || '').toLowerCase()
        const assignedMatch = assignedName.includes(searchLower) || assignedEng.includes(searchLower)
        const commentMatch = commentMatchedIds.has(c.id)

        if (!companyMatch && !assignedMatch && !commentMatch) return false
      }
      if (statusFilter) {
        // statusFilter 支援兩種：資料庫 status 值，或前端計算的 tier 值
        const tier = getWarningTier(c.created_date, c.status)
        if (statusFilter.startsWith('tier_') || statusFilter === 'developing') {
          if (tier !== statusFilter) return false
        } else {
          if (c.status !== statusFilter) return false
        }
      }
      if (gradeFilter && c.grade !== gradeFilter) return false
      if (assignedFilter && c.assigned_to !== assignedFilter) return false
      if (teamFilter && c.assigned_user?.team !== teamFilter) return false
      if (industryFilter && c.industry !== industryFilter) return false
      if (incompleteOnly) {
        const comp = getCustomerCompleteness({
          grade: c.grade,
          companyCodeType: c.company_code_type,
          lastContactDate: c.last_contact_date,
          contactsCount: contactsCountMap.get(c.id) ?? 0,
        })
        if (comp.isComplete) return false
      }
      return true
    })
  }, [customers, search, statusFilter, gradeFilter, assignedFilter, teamFilter, industryFilter, commentMatchedIds, incompleteOnly, contactsCountMap])

  // 分頁資料
  const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / PAGE_SIZE))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const pagedCustomers = useMemo(() => {
    const start = (safeCurrentPage - 1) * PAGE_SIZE
    return filteredCustomers.slice(start, start + PAGE_SIZE)
  }, [filteredCustomers, safeCurrentPage])

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-2">
        <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse w-1/3 mb-4" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card"><SkeletonListItem /></div>
        ))}
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">客戶列表</h1>
        <div className="flex items-center gap-3 text-sm text-gray-500 flex-wrap">
          <RealtimeBadge status={rtStatus} lastUpdated={lastUpdated} onRefresh={fetchData} />
          <span>
            共 {filteredCustomers.length} 筆
            {filteredCustomers.length > 0 && ` · 第 ${safeCurrentPage}/${totalPages} 頁`}
          </span>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="card mb-4 space-y-3">
        <div>
          <input
            type="text"
            placeholder="搜尋公司名稱、負責業務、備註內容..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field"
          />
          {search.trim() && (
            <p className="text-xs text-gray-400 mt-1">
              搜尋範圍：公司名稱、負責業務姓名、備註留言內容
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input-field text-sm"
          >
            <option value="">全部狀態</option>
            <optgroup label="開發進度">
              <option value="developing">🟢 開發中（0-29 天）</option>
              <option value="tier_30">🟢 關注（30 天+）</option>
              <option value="tier_60">🟡 注意（60 天+）</option>
              <option value="tier_75">🟠 警示（75 天+）</option>
              <option value="tier_80">🔴 緊急（80 天+）</option>
              <option value="reactivating">🟠 重新開發中</option>
            </optgroup>
            <optgroup label="成交狀態">
              <option value="negotiating">🔵 洽談中</option>
              <option value="completed">🏆 已成交</option>
              <option value="long_term">⭐ 長期合作</option>
              <option value="abandoned">⚪ 未成交</option>
            </optgroup>
            <optgroup label="系統狀態">
              <option value="locked">🔴 鎖檔暫停</option>
            </optgroup>
          </select>
          <select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            className="input-field text-sm"
          >
            <option value="">全部等級</option>
            <option value="A">A 級</option>
            <option value="B">B 級</option>
            <option value="C">C 級</option>
          </select>
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="input-field text-sm"
          >
            <option value="">全部課別</option>
            {TEAMS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            value={assignedFilter}
            onChange={(e) => setAssignedFilter(e.target.value)}
            className="input-field text-sm"
          >
            <option value="">全部業務</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.chinese_name}（{u.name}）
              </option>
            ))}
          </select>
          <select
            value={industryFilter}
            onChange={(e) => setIndustryFilter(e.target.value)}
            className="input-field text-sm"
          >
            <option value="">全部產業</option>
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none pt-1">
          <input
            type="checkbox"
            checked={incompleteOnly}
            onChange={(e) => setIncompleteOnly(e.target.checked)}
            className="w-4 h-4 text-primary-600"
          />
          <span className="text-gray-700">
            <span className="text-orange-500">⚠️</span> 只顯示資料不完整的客戶
          </span>
        </label>
      </div>

      {/* 已套用的篩選標籤 */}
      {(() => {
        const chips: { key: string; label: string; clear: () => void }[] = []
        if (search.trim()) chips.push({ key: 'search', label: `搜尋：「${search.trim()}」`, clear: () => setSearch('') })
        if (statusFilter) chips.push({ key: 'status', label: STATUS_FILTER_LABELS[statusFilter] || statusFilter, clear: () => setStatusFilter('') })
        if (gradeFilter) chips.push({ key: 'grade', label: `${gradeFilter} 級`, clear: () => setGradeFilter('') })
        if (teamFilter) chips.push({ key: 'team', label: teamFilter, clear: () => setTeamFilter('') })
        if (assignedFilter) chips.push({ key: 'assigned', label: `業務：${users.find(u => u.id === assignedFilter)?.chinese_name || '—'}`, clear: () => setAssignedFilter('') })
        if (industryFilter) chips.push({ key: 'industry', label: industryFilter, clear: () => setIndustryFilter('') })
        if (incompleteOnly) chips.push({ key: 'incomplete', label: '資料不完整', clear: () => setIncompleteOnly(false) })
        if (chips.length === 0) return null
        return (
          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            {chips.map(c => (
              <button
                key={c.key}
                onClick={c.clear}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-50 text-accent-700 text-xs font-medium hover:bg-accent-100 transition"
              >
                {c.label}
                <span className="text-accent-400">✕</span>
              </button>
            ))}
            <button onClick={clearAllFilters} className="text-xs text-gray-400 hover:text-gray-600 ml-1 underline">
              清除全部
            </button>
          </div>
        )
      })()}

      {/* Customer List */}
      <div className="space-y-2">
        {pagedCustomers.map((customer) => {
          const remaining = getRemainingDays(customer.created_date, customer.status)
          const tier = getWarningTier(customer.created_date, customer.status)
          const completeness = getCustomerCompleteness({
            grade: customer.grade,
            companyCodeType: customer.company_code_type,
            lastContactDate: customer.last_contact_date,
            contactsCount: contactsCountMap.get(customer.id) ?? 0,
          })
          return (
            <Link
              key={customer.id}
              href={`/customers/${customer.id}`}
              className={cn('card block hover:shadow-md transition', customer.priority_flag && 'ring-1 ring-amber-300 bg-amber-50/40')}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {customer.priority_flag && (
                      <span className="badge bg-amber-100 text-amber-800" title={customer.priority_note || '主管建議優先開發'}>⭐ 優先</span>
                    )}
                    <h3 className="font-semibold text-gray-900 truncate">
                      {customer.company_name}
                    </h3>
                    <span className={cn('badge', getGradeColor(customer.grade))}>
                      {customer.grade}
                    </span>
                    {customer.industry && (
                      <span className="badge bg-gray-100 text-gray-700">
                        {customer.industry}
                      </span>
                    )}
                    {!completeness.isComplete && (
                      <span
                        className="text-orange-500 text-sm shrink-0"
                        title={`資料完整度 ${completeness.score}%（${completeness.completed}/${completeness.total}）`}
                      >
                        ⚠️
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    {customer.company_code && (
                      <span>{customer.company_code_type} {customer.company_code}</span>
                    )}
                    <span>負責：{customer.assigned_user?.chinese_name || '未指派'}</span>
                    <span>建檔：{formatDate(customer.created_date)}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={cn('badge', getTierColor(tier))}>
                    {getTierShortLabel(tier)}
                  </span>
                  {customer.status !== 'locked' && (
                    <span className={cn(
                      'text-lg font-bold tabular-nums',
                      remaining <= 10 ? 'text-red-600' :
                      remaining <= 15 ? 'text-orange-600' :
                      remaining <= 30 ? 'text-yellow-600' :
                      'text-gray-700'
                    )}>
                      {remaining}<span className="text-xs font-normal text-gray-400 ml-0.5">天</span>
                    </span>
                  )}
                </div>
              </div>
            </Link>
          )
        })}

        {filteredCustomers.length === 0 && (
          customers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="還沒有任何客戶"
              description="建立第一筆客戶資料，開始追蹤開發進度。"
              actionHref="/customers/new"
              actionLabel="新增客戶"
            />
          ) : (
            <EmptyState
              icon={Users}
              title="查無符合條件的客戶"
              description="試著調整搜尋關鍵字或篩選條件。"
            />
          )
        )}
      </div>

      {/* 分頁控制 */}
      {totalPages > 1 && (
        <Pagination
          current={safeCurrentPage}
          total={totalPages}
          onChange={(p) => {
            setCurrentPage(p)
            // 換頁時回到頂部
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      )}
    </div>
  )
}

// ===================================================
// 分頁元件：最多顯示 5 個頁碼 + 上/下頁，頭尾用省略號
// ===================================================
function Pagination({
  current, total, onChange,
}: { current: number; total: number; onChange: (p: number) => void }) {
  // 計算要顯示哪些頁碼
  const pages: (number | '...')[] = []
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    pages.push(1)
    if (current > 3) pages.push('...')
    const start = Math.max(2, current - 1)
    const end = Math.min(total - 1, current + 1)
    for (let i = start; i <= end; i++) pages.push(i)
    if (current < total - 2) pages.push('...')
    pages.push(total)
  }

  return (
    <div className="flex items-center justify-center gap-1 mt-6 flex-wrap">
      <button
        onClick={() => onChange(current - 1)}
        disabled={current === 1}
        className="px-3 py-1.5 rounded-lg text-sm bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        ← 上一頁
      </button>
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`dots-${i}`} className="px-2 text-gray-400">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={cn(
              'min-w-[36px] px-2 py-1.5 rounded-lg text-sm transition',
              p === current
                ? 'bg-primary-600 text-white font-semibold'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            )}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onChange(current + 1)}
        disabled={current === total}
        className="px-3 py-1.5 rounded-lg text-sm bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        下一頁 →
      </button>
    </div>
  )
}
