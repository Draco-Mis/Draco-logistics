'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import type { Customer } from '@/types/database'
import {
  getStatusLabel, getStatusColor, getGradeColor, formatDate, cn,
} from '@/lib/utils'

type SimilarPair = {
  id_a: string
  id_b: string
  name_a: string
  name_b: string
  sim: number
}

export default function DuplicatesPage() {
  const { user } = useAuth()
  const supabase = createClient()
  const confirm = useConfirm()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [similarPairs, setSimilarPairs] = useState<SimilarPair[]>([])
  const [loading, setLoading] = useState(true)
  const [threshold, setThreshold] = useState(0.6)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ deleted: number; failed: number } | null>(null)

  async function loadAll() {
    setLoading(true)
    setError('')
    // 1. 撈全部客戶（RLS 已過濾 deleted_at IS NULL）
    const all: Customer[] = []
    let from = 0
    const size = 1000
    while (true) {
      const { data } = await supabase
        .from('customers')
        .select('*, assigned_user:users!assigned_to(*)')
        .order('company_name')
        .range(from, from + size - 1)
      if (!data || data.length === 0) break
      all.push(...(data as Customer[]))
      if (data.length < size) break
      from += size
    }
    setCustomers(all)

    // 2. RPC 抓疑似重複
    const { data: pairs, error: rpcErr } = await supabase.rpc('find_similar_customers', { threshold })
    if (rpcErr) {
      setError(`相似度比對失敗：${rpcErr.message}（請先在 Supabase SQL Editor 執行 migration 012）`)
    } else {
      setSimilarPairs((pairs as SimilarPair[]) || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (user?.role === 'admin') loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, threshold])

  // 完全相同：依 lower+trim 分組，只保留 size > 1 的群
  const exactGroups = useMemo(() => {
    const map = new Map<string, Customer[]>()
    for (const c of customers) {
      const key = c.company_name.trim().toLowerCase()
      const arr = map.get(key) ?? []
      arr.push(c)
      map.set(key, arr)
    }
    return Array.from(map.values()).filter(g => g.length > 1)
  }, [customers])

  // 疑似重複：扣除已經在「完全相同」群裡的配對（避免重複呈現）
  const exactIdSet = useMemo(() => {
    const s = new Set<string>()
    exactGroups.forEach(g => g.forEach(c => s.add(c.id)))
    return s
  }, [exactGroups])

  const similarFiltered = useMemo(() => {
    return similarPairs.filter(p => !(exactIdSet.has(p.id_a) && exactIdSet.has(p.id_b)))
  }, [similarPairs, exactIdSet])

  const customerById = useMemo(() => {
    const m = new Map<string, Customer>()
    customers.forEach(c => m.set(c.id, c))
    return m
  }, [customers])

  function toggle(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleBulkDelete() {
    if (!user || selectedIds.size === 0) return
    const names = customers.filter(c => selectedIds.has(c.id)).map(c => c.company_name)
    const ok = await confirm({
      title: `軟刪除 ${selectedIds.size} 筆客戶`,
      message:
        names.slice(0, 10).map(n => `• ${n}`).join('\n') +
        (names.length > 10 ? `\n…還有 ${names.length - 10} 筆` : '') +
        `\n\n資料庫仍保留，但所有列表、報表、cron 都會跳過。`,
      danger: true,
      confirmLabel: '確認刪除',
    })
    if (!ok) return

    setDeleting(true)
    setError('')
    setResult(null)

    // 改 call RPC 繞過 RLS RETURNING 限制（migration 017）
    const { data, error: rpcErr } = await supabase.rpc('admin_soft_delete_customers', {
      p_ids: Array.from(selectedIds),
    })

    if (rpcErr) {
      setError(`批次刪除失敗：${rpcErr.message}`)
      setDeleting(false)
      return
    }

    const result = data as { success?: number; failed?: number } | null
    setResult({ deleted: result?.success ?? 0, failed: result?.failed ?? 0 })
    setSelectedIds(new Set())
    setDeleting(false)
    loadAll()
  }

  if (user?.role !== 'admin') {
    return <div className="p-4 text-center py-12 text-gray-400">您沒有權限查看此頁面</div>
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight dark:text-gray-100 mb-1">重複客戶清理</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        勾選要刪除的客戶（保留不勾選的），下方按「批次刪除」。軟刪除可保留稽核軌跡。
      </p>

      {loading && (
        <div className="p-4 flex justify-center items-center min-h-[30vh]">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}

      {error && (
        <div className="card border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800 mb-4">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {result && (
        <div className="card border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-800 mb-4">
          <p className="text-sm text-green-700 dark:text-green-300">
            ✓ 刪除完成：成功 {result.deleted} 筆
            {result.failed > 0 && <span className="text-red-600 ml-2">· 失敗 {result.failed}</span>}
          </p>
        </div>
      )}

      {!loading && (
        <>
          {/* Sticky 操作列 */}
          <div className="sticky top-0 z-10 -mx-4 px-4 py-3 mb-4 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm">
              已選取 <span className="font-bold text-red-600">{selectedIds.size}</span> 筆要刪除
              <span className="text-gray-400 ml-3">
                完全相同：{exactGroups.length} 組 · 疑似重複：{similarFiltered.length} 對
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs text-gray-500 flex items-center gap-1">
                相似度門檻
                <select
                  value={threshold}
                  onChange={(e) => setThreshold(parseFloat(e.target.value))}
                  className="input-field text-xs py-1 px-2"
                  disabled={deleting}
                >
                  <option value={0.4}>0.4（寬鬆）</option>
                  <option value={0.5}>0.5</option>
                  <option value={0.6}>0.6（預設）</option>
                  <option value={0.7}>0.7</option>
                  <option value={0.8}>0.8（嚴格）</option>
                </select>
              </label>
              <button
                onClick={() => setSelectedIds(new Set())}
                disabled={selectedIds.size === 0 || deleting}
                className="btn-secondary text-sm disabled:opacity-40"
              >清除選取</button>
              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0 || deleting}
                className="btn-danger text-sm disabled:opacity-40"
              >
                {deleting ? '刪除中…' : `🗑️ 刪除選取（${selectedIds.size}）`}
              </button>
            </div>
          </div>

          {/* Section 1：完全相同 */}
          <section className="mb-8">
            <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-2">
              完全相同 <span className="text-sm font-normal text-gray-500">（{exactGroups.length} 組）</span>
            </h2>
            {exactGroups.length === 0 ? (
              <p className="text-sm text-gray-400 italic">沒有完全相同的客戶名稱</p>
            ) : (
              <div className="space-y-3">
                {exactGroups.map((group, gi) => (
                  <DupGroup key={gi} title={`${group[0].company_name}（${group.length} 筆）`}>
                    {group.map(c => (
                      <CustomerRow
                        key={c.id}
                        c={c}
                        checked={selectedIds.has(c.id)}
                        onToggle={() => toggle(c.id)}
                      />
                    ))}
                  </DupGroup>
                ))}
              </div>
            )}
          </section>

          {/* Section 2：疑似重複 */}
          <section className="mb-8">
            <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-2">
              疑似重複 <span className="text-sm font-normal text-gray-500">（{similarFiltered.length} 對，相似度 ≥ {threshold}）</span>
            </h2>
            {similarFiltered.length === 0 ? (
              <p className="text-sm text-gray-400 italic">沒有偵測到疑似重複的客戶</p>
            ) : (
              <div className="space-y-3">
                {similarFiltered.map((pair, pi) => {
                  const a = customerById.get(pair.id_a)
                  const b = customerById.get(pair.id_b)
                  if (!a || !b) return null
                  const simPct = Math.round(pair.sim * 100)
                  return (
                    <DupGroup
                      key={pi}
                      title={`相似度 ${simPct}%`}
                      subtitle={`「${a.company_name}」 ↔ 「${b.company_name}」`}
                    >
                      <CustomerRow c={a} checked={selectedIds.has(a.id)} onToggle={() => toggle(a.id)} />
                      <CustomerRow c={b} checked={selectedIds.has(b.id)} onToggle={() => toggle(b.id)} />
                    </DupGroup>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function DupGroup({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-lg p-3 dark:border-gray-700">
      <div className="mb-2">
        <div className="font-medium text-gray-900 dark:text-gray-100">{title}</div>
        {subtitle && <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function CustomerRow({ c, checked, onToggle }: { c: Customer; checked: boolean; onToggle: () => void }) {
  const sales = c.assigned_user
  return (
    <label className={cn(
      'flex items-center gap-3 p-2 rounded border cursor-pointer transition text-sm',
      checked
        ? 'border-red-400 bg-red-50 dark:bg-red-900/10'
        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
    )}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
          {c.company_name}
        </div>
        <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 mt-0.5">
          <span>業務：{sales?.chinese_name || sales?.name || '—'}{sales?.team ? `（${sales.team}）` : ''}</span>
          <span className={getStatusColor(c.status)}>狀態：{getStatusLabel(c.status)}</span>
          <span className={getGradeColor(c.grade)}>等級：{c.grade}</span>
          <span>建檔：{formatDate(c.created_date)}</span>
          {c.last_contact_date && <span>最後接觸：{formatDate(c.last_contact_date)}</span>}
        </div>
      </div>
      <a
        href={`/customers/${c.id}`}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-xs text-primary-600 hover:underline shrink-0"
      >開新分頁 →</a>
    </label>
  )
}
