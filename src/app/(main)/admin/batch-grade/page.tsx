'use client'

import { PageLoading } from '@/components/ui/PageLoading'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { Customer, User, CustomerStatus } from '@/types/database'
import {
  getWarningTier, getTierShortLabel, getTierColor, getGradeColor, getStatusLabel,
  formatDate, cn,
} from '@/lib/utils'
import { TEAMS } from '@/lib/constants'

const PAGE_SIZE = 50

// 批次可套用的狀態（僅開放手動狀態，鎖檔/警示等系統狀態不列入）
const BULK_STATUSES: { value: CustomerStatus; label: string }[] = [
  { value: 'active_developing', label: '開發中' },
  { value: 'negotiating', label: '洽談中' },
  { value: 'completed', label: '已成交' },
  { value: 'long_term', label: '長期合作' },
  { value: 'abandoned', label: '未成交' },
]

type PendingAction =
  | { kind: 'grade'; value: 'A' | 'B' | 'C' }
  | { kind: 'assign'; value: string; label: string }
  | { kind: 'status'; value: CustomerStatus; label: string }

export default function BatchGradePage() {
  const { user } = useAuth()
  const supabase = createClient()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)

  // 篩選
  const [search, setSearch] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [assignedFilter, setAssignedFilter] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')

  // 選取狀態
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)

  // 批次操作
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    async function load() {
      // 分頁抓全部客戶（Supabase 單次上限 1000）
      const all: Customer[] = []
      let from = 0
      const size = 1000
      while (true) {
        const { data, error } = await supabase
          .from('customers')
          .select('*, assigned_user:users!assigned_to(id, chinese_name, name, team)')
          .order('company_name')
          .range(from, from + size - 1)
        if (error) { console.error('[batch-grade] 查詢客戶失敗:', error.message); break }
        if (!data || data.length === 0) break
        all.push(...(data as unknown as Customer[]))
        if (data.length < size) break
        from += size
      }
      setCustomers(all)

      const { data: usersData } = await supabase
        .from('users')
        .select('*')
        .eq('is_active', true)
        .order('name')
      if (usersData) setUsers(usersData)
      setLoading(false)
    }
    load()
  }, [])

  // 範圍限制：admin/chairman 全部；manager 只看自己的課
  const isSuperRole = user?.role === 'admin' || user?.role === 'chairman'
  const scopedCustomers = useMemo(() => {
    if (isSuperRole || !user) return customers
    // manager
    return customers.filter(c => c.assigned_user?.team === user.team)
  }, [customers, user, isSuperRole])

  const scopedUsers = useMemo(() => {
    if (isSuperRole || !user) return users
    return users.filter(u => u.team === user.team)
  }, [users, user, isSuperRole])

  // 應用篩選
  const filtered = useMemo(() => {
    return scopedCustomers.filter(c => {
      if (search && !c.company_name.toLowerCase().includes(search.toLowerCase())) return false
      if (teamFilter && c.assigned_user?.team !== teamFilter) return false
      if (assignedFilter && c.assigned_to !== assignedFilter) return false
      if (gradeFilter && c.grade !== gradeFilter) return false
      return true
    })
  }, [scopedCustomers, search, teamFilter, assignedFilter, gradeFilter])

  // 篩選條件變動時：回到第 1 頁 + 清空選取
  useEffect(() => {
    setCurrentPage(1)
    setSelectedIds(new Set())
  }, [search, teamFilter, assignedFilter, gradeFilter])

  // 分頁
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const pagedCustomers = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, safePage])

  // 選取操作
  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAllOnPage() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      const allSelected = pagedCustomers.every(c => next.has(c.id))
      if (allSelected) {
        pagedCustomers.forEach(c => next.delete(c.id))
      } else {
        pagedCustomers.forEach(c => next.add(c.id))
      }
      return next
    })
  }

  function selectAllFiltered() {
    setSelectedIds(new Set(filtered.map(c => c.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  // 執行批次更新（等級 / 負責人 / 狀態）
  async function confirmBatchUpdate() {
    if (!pendingAction) return
    setSaving(true)
    setError('')
    setSuccess('')

    const ids = Array.from(selectedIds)
    const patch: Record<string, unknown> =
      pendingAction.kind === 'grade' ? { grade: pendingAction.value } :
      pendingAction.kind === 'assign' ? { assigned_to: pendingAction.value } :
      { status: pendingAction.value }

    const { error: updErr } = await supabase
      .from('customers')
      .update(patch)
      .in('id', ids)

    if (updErr) {
      setError('批次更新失敗：' + updErr.message)
      setSaving(false)
      return
    }

    const what =
      pendingAction.kind === 'grade' ? `等級改為 ${pendingAction.value} 級` :
      pendingAction.kind === 'assign' ? `負責業務改為 ${pendingAction.label}` :
      `狀態改為「${pendingAction.label}」`
    setSuccess(`✅ 成功將 ${ids.length} 筆客戶${what}`)
    setSaving(false)
    setPendingAction(null)
    setSelectedIds(new Set())

    // 重新撈資料反映變更
    const { data } = await supabase
      .from('customers')
      .select('*, assigned_user:users!assigned_to(id, chinese_name, name, team)')
      .order('company_name')
      .limit(2000)
    if (data) setCustomers(data as unknown as Customer[])

    setTimeout(() => setSuccess(''), 4000)
  }

  // 權限檢查
  if (user && user.role !== 'admin' && user.role !== 'chairman' && user.role !== 'director' && user.role !== 'manager') {
    return <div className="p-4 text-center py-12 text-gray-400">您沒有權限使用此頁面</div>
  }

  if (loading) {
    return (
      <PageLoading />
    )
  }

  const allOnPageSelected = pagedCustomers.length > 0 && pagedCustomers.every(c => selectedIds.has(c.id))

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto pb-24">
      <div className="mb-3">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">批次調整客戶</h1>
        {!isSuperRole && (
          <p className="text-xs text-gray-500 mt-1">
            以下只顯示您所屬的 <strong>{user?.team}</strong> 的客戶
          </p>
        )}
      </div>

      {/* 篩選 */}
      <div className="card mb-4 space-y-3">
        <input
          type="text"
          placeholder="搜尋公司名稱..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field"
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {isSuperRole && (
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="input-field text-sm"
            >
              <option value="">全部課別</option>
              {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <select
            value={assignedFilter}
            onChange={(e) => setAssignedFilter(e.target.value)}
            className="input-field text-sm"
          >
            <option value="">全部業務</option>
            {scopedUsers.map(u => (
              <option key={u.id} value={u.id}>
                {u.chinese_name}（{u.name}）
              </option>
            ))}
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
        </div>
      </div>

      {/* 統計 + 全選控制 */}
      <div className="card mb-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-gray-700">
          符合條件 <strong>{filtered.length}</strong> 筆 ·
          已選 <strong className="text-primary-600">{selectedIds.size}</strong> 筆 ·
          第 {safePage} / {totalPages} 頁
        </span>
        <div className="flex gap-2 ml-auto">
          {filtered.length > pagedCustomers.length && (
            <button
              onClick={selectAllFiltered}
              className="text-xs text-primary-600 hover:text-primary-700"
            >
              選取全部符合條件（{filtered.length} 筆）
            </button>
          )}
          {selectedIds.size > 0 && (
            <button
              onClick={clearSelection}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              清除選取
            </button>
          )}
        </div>
      </div>

      {/* 成功提示 */}
      {success && (
        <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
          {success}
        </div>
      )}

      {/* 客戶列表 */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200">
            <tr className="text-left text-gray-600">
              <th className="p-2 w-10">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleAllOnPage}
                  className="w-4 h-4"
                  title="選取/取消本頁全部"
                />
              </th>
              <th className="p-2">公司名稱</th>
              <th className="p-2 hidden md:table-cell">負責業務</th>
              <th className="p-2 hidden sm:table-cell">狀態</th>
              <th className="p-2 w-20 text-center">目前等級</th>
              <th className="p-2 hidden md:table-cell">建檔日</th>
            </tr>
          </thead>
          <tbody>
            {pagedCustomers.map(c => {
              const tier = getWarningTier(c.created_date, c.status)
              const isSelected = selectedIds.has(c.id)
              return (
                <tr
                  key={c.id}
                  onClick={() => toggleOne(c.id)}
                  className={cn(
                    'border-b last:border-0 cursor-pointer transition',
                    isSelected ? 'bg-primary-50' : 'hover:bg-gray-50'
                  )}
                >
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4"
                    />
                  </td>
                  <td className="p-2 font-medium text-gray-900 truncate max-w-[180px]">
                    {c.company_name}
                  </td>
                  <td className="p-2 text-gray-600 hidden md:table-cell">
                    {c.assigned_user?.chinese_name} · {c.assigned_user?.team}
                  </td>
                  <td className="p-2 hidden sm:table-cell">
                    <span className={cn('badge', getTierColor(tier))}>
                      {getTierShortLabel(tier)}
                    </span>
                  </td>
                  <td className="p-2 text-center">
                    <span className={cn('badge', getGradeColor(c.grade))}>{c.grade}</span>
                  </td>
                  <td className="p-2 text-gray-500 text-xs hidden md:table-cell">
                    {formatDate(c.created_date)}
                  </td>
                </tr>
              )
            })}
            {pagedCustomers.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-400">
                  查無符合條件的客戶
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分頁 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="px-3 py-1.5 rounded-lg text-sm bg-white border border-gray-200 disabled:opacity-40"
          >
            ← 上一頁
          </button>
          <span className="text-sm text-gray-600">{safePage} / {totalPages}</span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="px-3 py-1.5 rounded-lg text-sm bg-white border border-gray-200 disabled:opacity-40"
          >
            下一頁 →
          </button>
        </div>
      )}

      {/* 底部固定操作列：等級 / 負責人 / 狀態 */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-16 md:bottom-0 left-0 right-0 md:left-64 bg-white border-t border-gray-200 shadow-lg p-3 z-40">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-sm font-medium text-gray-700 shrink-0">
              已選 <strong className="text-primary-600">{selectedIds.size}</strong> 筆 →
            </span>
            {/* 等級 */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">等級</span>
              {(['A', 'B', 'C'] as const).map(g => (
                <button
                  key={g}
                  onClick={() => setPendingAction({ kind: 'grade', value: g })}
                  className={cn(
                    'px-3 py-1.5 rounded-lg font-bold text-sm transition',
                    g === 'A' && 'bg-blue-600 hover:bg-blue-700 text-white',
                    g === 'B' && 'bg-blue-400 hover:bg-blue-500 text-white',
                    g === 'C' && 'bg-blue-200 hover:bg-blue-300 text-blue-800',
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
            {/* 負責人 */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">負責人</span>
              <select
                value=""
                onChange={(e) => {
                  const u = scopedUsers.find(x => x.id === e.target.value)
                  if (u) setPendingAction({ kind: 'assign', value: u.id, label: `${u.chinese_name}（${u.name}）` })
                }}
                className="input-field text-sm py-1.5 max-w-[160px]"
              >
                <option value="">改指派給…</option>
                {scopedUsers.map(u => <option key={u.id} value={u.id}>{u.chinese_name}</option>)}
              </select>
            </div>
            {/* 狀態 */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">狀態</span>
              <select
                value=""
                onChange={(e) => {
                  const s = BULK_STATUSES.find(x => x.value === e.target.value)
                  if (s) setPendingAction({ kind: 'status', value: s.value, label: s.label })
                }}
                className="input-field text-sm py-1.5 max-w-[140px]"
              >
                <option value="">改狀態為…</option>
                {BULK_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <button
              onClick={clearSelection}
              className="text-sm text-gray-500 hover:text-gray-700 ml-auto shrink-0"
            >
              取消選取
            </button>
          </div>
        </div>
      )}

      {/* 確認對話框 */}
      {pendingAction && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => !saving && setPendingAction(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 mb-2">確認批次調整</h3>
            <p className="text-sm text-gray-600 mb-4">
              將已選取的 <strong>{selectedIds.size}</strong> 筆客戶
              {pendingAction.kind === 'grade' && <>等級改為 <strong className="text-primary-600">{pendingAction.value}</strong> 級？</>}
              {pendingAction.kind === 'assign' && <>負責業務改為 <strong className="text-primary-600">{pendingAction.label}</strong>？</>}
              {pendingAction.kind === 'status' && <>狀態改為 <strong className="text-primary-600">「{pendingAction.label}」</strong>？</>}
            </p>
            {pendingAction.kind === 'assign' && (
              <p className="text-xs text-gray-400 mb-3">註：只變更負責人，不會重設 90 天倒數。</p>
            )}
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={confirmBatchUpdate}
                disabled={saving}
                className="btn-primary flex-1 text-sm"
              >
                {saving ? '處理中...' : '確認套用'}
              </button>
              <button
                onClick={() => setPendingAction(null)}
                disabled={saving}
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
