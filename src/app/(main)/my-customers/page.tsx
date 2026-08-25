'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { Customer } from '@/types/database'
import { getRemainingDays, formatDate, getGradeColor, getWarningTier, getTierShortLabel, getTierColor, getCustomerCompleteness, cn } from '@/lib/utils'
import { useRealtimeStatus } from '@/lib/use-realtime'
import { RealtimeBadge } from '@/components/RealtimeBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonListItem } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { Users } from 'lucide-react'

export default function MyCustomersPage() {
  const { user } = useAuth()
  const supabase = createClient()
  const toast = useToast()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [contactsCountMap, setContactsCountMap] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'developing' | 'warn' | 'completed' | 'locked'>('all')

  // Realtime：訂閱 customers 變動（先宣告，下面 fetchMine 才能引用 markUpdated）
  const { status: rtStatus, lastUpdated, markUpdated } = useRealtimeStatus({
    channelName: 'my-customers-list',
    tables: [{ table: 'customers' }],
    onChange: () => { void fetchMine() },
    enabled: !!user,
  })

  const fetchMine = useCallback(async () => {
    if (!user) return
    // 防呆：priority_flag（migration 041）若尚未建立，退回不帶 priority 的查詢
    const BASE: string = 'id, company_name, grade, status, created_date, last_contact_date, company_code_type, assigned_to, customer_contacts(count)'
    const WITH_PRIORITY: string = 'id, company_name, grade, status, created_date, last_contact_date, company_code_type, assigned_to, priority_flag, priority_note, customer_contacts(count)'
    const runQuery = (withPriority: boolean) => {
      let q = supabase.from('customers')
        .select(withPriority ? WITH_PRIORITY : BASE)
        .eq('assigned_to', user.id)
      if (withPriority) q = q.order('priority_flag', { ascending: false })
      return q.order('status', { ascending: true }).order('created_date', { ascending: false })
    }
    let res = await runQuery(true)
    if (res.error && /priority/.test(res.error.message)) res = await runQuery(false)
    const data = res.data
    if (data) {
      const rows = data as unknown as Customer[]
      setCustomers(rows)
      const map = new Map<string, number>()
      for (const c of rows) {
        const cnt = (c as { customer_contacts?: { count: number }[] }).customer_contacts?.[0]?.count ?? 0
        map.set(c.id, cnt)
      }
      setContactsCountMap(map)
    }
    setLoading(false)
    markUpdated()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, markUpdated])

  useEffect(() => { fetchMine() }, [fetchMine])

  // 清單快速動作：一鍵把最後互動日設為今天（含復原）
  async function logContact(e: React.MouseEvent, c: Customer) {
    e.preventDefault(); e.stopPropagation()
    const prev = c.last_contact_date
    const today = new Date().toISOString().split('T')[0]
    const { error } = await supabase.from('customers').update({ last_contact_date: today }).eq('id', c.id)
    if (error) { toast.error('更新失敗：' + error.message); return }
    toast.success(`已記錄「${c.company_name}」今日聯絡`, {
      actionLabel: '復原',
      onAction: async () => { await supabase.from('customers').update({ last_contact_date: prev }).eq('id', c.id); fetchMine() },
    })
    fetchMine()
  }

  // 點上方統計卡片時，依該卡片條件過濾下方清單
  // 注意：useMemo 必須在任何 early return 之前呼叫（React Rules of Hooks）
  const filteredCustomers = useMemo(() => {
    if (filter === 'all') return customers
    return customers.filter(c => {
      const tier = getWarningTier(c.created_date, c.status)
      switch (filter) {
        case 'developing': return tier === 'developing' || tier === 'reactivating'
        case 'warn': return tier === 'tier_30' || tier === 'tier_60' || tier === 'tier_75' || tier === 'tier_80'
        case 'completed': return tier === 'completed' || tier === 'long_term'
        case 'locked': return tier === 'locked'
        default: return true
      }
    })
  }, [customers, filter])

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-2">
        <div className="h-8 w-40 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse mb-4" />
        <div className="grid grid-cols-5 gap-2 mb-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card"><SkeletonListItem /></div>
        ))}
      </div>
    )
  }

  // 用 warning tier 而非 status 做統計，能反映 30/60/80 天的狀況
  const tiersCount = customers.reduce((acc, c) => {
    const tier = getWarningTier(c.created_date, c.status)
    acc[tier] = (acc[tier] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const stats = {
    total: customers.length,
    developing: (tiersCount.developing || 0) + (tiersCount.reactivating || 0),
    warn: (tiersCount.tier_30 || 0) + (tiersCount.tier_60 || 0) + (tiersCount.tier_75 || 0) + (tiersCount.tier_80 || 0),
    completed: (tiersCount.completed || 0) + (tiersCount.long_term || 0),
    locked: tiersCount.locked || 0,
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">我的客戶</h1>
        <RealtimeBadge status={rtStatus} lastUpdated={lastUpdated} onRefresh={fetchMine} />
      </div>

      {/* Stats — 點擊篩選下方列表 */}
      <div className="grid grid-cols-5 gap-2 mb-4">
        <StatCard label="全部" value={stats.total} valueClass="text-gray-900" active={filter === 'all'} onClick={() => setFilter('all')} />
        <StatCard label="開發中" value={stats.developing} valueClass="text-green-600" active={filter === 'developing'} onClick={() => setFilter('developing')} />
        <StatCard label="警示中" value={stats.warn} valueClass="text-orange-500" active={filter === 'warn'} onClick={() => setFilter('warn')} />
        <StatCard label="🏆 已成交" value={stats.completed} valueClass="text-amber-500" active={filter === 'completed'} onClick={() => setFilter('completed')} />
        <StatCard label="鎖檔" value={stats.locked} valueClass="text-red-500" active={filter === 'locked'} onClick={() => setFilter('locked')} />
      </div>

      {/* Customer List */}
      {filter !== 'all' && (
        <p className="text-xs text-gray-500 mb-2">
          顯示「{filter === 'developing' ? '開發中' : filter === 'warn' ? '警示中' : filter === 'completed' ? '已成交' : '鎖檔'}」共 {filteredCustomers.length} 筆
          <button onClick={() => setFilter('all')} className="ml-2 text-primary-600 hover:underline">清除篩選</button>
        </p>
      )}
      {filteredCustomers.length === 0 && (
        customers.length === 0 ? (
          <EmptyState
            icon={Users}
            title="你名下還沒有客戶"
            description="新增客戶或向主管申請認領，就會出現在這裡。"
            actionHref="/customers/new"
            actionLabel="新增客戶"
          />
        ) : (
          <EmptyState icon={Users} title="此分類沒有客戶" description="切換上方分類或清除篩選。" />
        )
      )}
      <div className="space-y-2">
        {filteredCustomers.map((customer) => {
          const remaining = getRemainingDays(customer.created_date, customer.status)
          const tier = getWarningTier(customer.created_date, customer.status)
          const completeness = getCustomerCompleteness({
            grade: customer.grade,
            companyCodeType: customer.company_code_type,
            lastContactDate: customer.last_contact_date,
            contactsCount: contactsCountMap.get(customer.id) ?? 0,
          })
          return (
            <Link key={customer.id} href={`/customers/${customer.id}`} className={cn('card block hover:shadow-md transition', customer.priority_flag && 'ring-1 ring-amber-300 bg-amber-50/40')}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {customer.priority_flag && <span className="badge bg-amber-100 text-amber-800">⭐ 主管建議優先</span>}
                    <h3 className="font-semibold text-gray-900 truncate">{customer.company_name}</h3>
                    <span className={cn('badge', getGradeColor(customer.grade))}>{customer.grade}</span>
                    {!completeness.isComplete && (
                      <span
                        className="text-orange-500 text-sm shrink-0"
                        title={`資料完整度 ${completeness.score}%（${completeness.completed}/${completeness.total}）`}
                      >
                        ⚠️
                      </span>
                    )}
                  </div>
                  {customer.priority_flag && customer.priority_note && (
                    <p className="text-xs text-amber-700 mt-0.5">💡 {customer.priority_note}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-0.5">
                    建檔：{formatDate(customer.created_date)}
                    <span className="mx-1.5 text-gray-300">·</span>
                    最後聯絡：{customer.last_contact_date ? formatDate(customer.last_contact_date) : '未記錄'}
                  </p>
                  {customer.status !== 'locked' && (
                    <button
                      onClick={(e) => logContact(e, customer)}
                      className="mt-1 text-xs text-accent-600 hover:text-accent-700 font-medium inline-flex items-center gap-1 rounded-lg px-2 py-0.5 hover:bg-accent-50 transition"
                      title="把最後互動日期設為今天"
                    >
                      🕐 今日聯絡
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {customer.status !== 'locked' && (
                    <span className={cn(
                      'text-lg font-bold tabular-nums',
                      remaining <= 10 ? 'text-red-600' :
                      remaining <= 15 ? 'text-orange-600' :
                      remaining <= 30 ? 'text-yellow-600' :
                      'text-gray-700'
                    )}>
                      {remaining}<span className="text-xs font-normal text-gray-400">天</span>
                    </span>
                  )}
                  <span className={cn('badge', getTierColor(tier))}>
                    {getTierShortLabel(tier)}
                  </span>
                </div>
              </div>
            </Link>
          )
        })}
        {customers.length === 0 && (
          <p className="text-center py-12 text-gray-400">您目前沒有負責的客戶</p>
        )}
      </div>
    </div>
  )
}

function StatCard({
  label, value, valueClass, active, onClick,
}: {
  label: string
  value: number
  valueClass: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'card text-center transition w-full block',
        active ? 'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'hover:shadow-md',
      )}
    >
      <span className={cn('block text-xl md:text-2xl font-bold', valueClass)}>{value}</span>
      <span className="block text-xs text-gray-500">{label}</span>
    </button>
  )
}
