'use client'

import { PageLoading } from '@/components/ui/PageLoading'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { Customer, User } from '@/types/database'
import { formatDate, cn } from '@/lib/utils'
import {
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter,
  startOfYear, endOfYear,
  isWithinInterval, parseISO, differenceInDays,
} from 'date-fns'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

type Range = 'week' | 'month' | 'quarter' | 'year'
const RANGE_LABELS: Record<Range, string> = {
  week: '本週', month: '本月', quarter: '本季', year: '本年',
}

const GRADE_COLORS = {
  A: '#1e3a5f',  // primary-600
  B: '#60a5fa',  // primary-400
  C: '#bfdbfe',  // primary-200
}

interface CompletedEvent {
  customer_id: string
  action_date: string
}

export default function PerformancePage() {
  const { user } = useAuth()
  const supabase = createClient()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [completedEvents, setCompletedEvents] = useState<CompletedEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<Range>('month')

  useEffect(() => {
    async function load() {
      // 分頁抓所有客戶（Supabase 單次上限 1000）
      const allCustomers: Customer[] = []
      let from = 0
      while (true) {
        // 只帶負責人需要的欄位（原本抓完整 user 物件，payload 過大）
        const { data, error } = await supabase
          .from('customers')
          .select('*, assigned_user:users!assigned_to(id, chinese_name, name, team)')
          .range(from, from + 999)
        if (error) { console.error('[performance] 查詢客戶失敗:', error.message); break }
        if (!data || data.length === 0) break
        allCustomers.push(...(data as unknown as Customer[]))
        if (data.length < 1000) break
        from += 1000
      }
      setCustomers(allCustomers)

      const { data: usersData } = await supabase
        .from('users').select('*').eq('is_active', true)
      if (usersData) setUsers(usersData)

      const { data: completed } = await supabase
        .from('customer_history')
        .select('customer_id, action_date')
        .eq('action_type', 'mark_completed')
      if (completed) setCompletedEvents(completed as CompletedEvent[])

      setLoading(false)
    }
    load()
  }, [])

  // 權限：admin/chairman 看全部；課長僅本課；副課長本課但排除課長本人
  const isSuperRole = user?.role === 'admin' || user?.role === 'chairman'
  const { scopedCustomers, scopedUsers } = useMemo(() => {
    if (isSuperRole || !user) return { scopedCustomers: customers, scopedUsers: users }
    let teamUsers = users.filter(u => u.team === user.team)
    if (user.role === 'deputy_manager') {
      teamUsers = teamUsers.filter(u => u.role !== 'manager')
    }
    const teamIds = new Set(teamUsers.map(u => u.id))
    return {
      scopedCustomers: customers.filter(c => teamIds.has(c.assigned_to)),
      scopedUsers: teamUsers,
    }
  }, [customers, users, user, isSuperRole])

  // 期間起訖
  const { periodStart, periodEnd } = useMemo(() => {
    const now = new Date()
    switch (range) {
      case 'month':   return { periodStart: startOfMonth(now),   periodEnd: endOfMonth(now) }
      case 'quarter': return { periodStart: startOfQuarter(now), periodEnd: endOfQuarter(now) }
      case 'year':    return { periodStart: startOfYear(now),    periodEnd: endOfYear(now) }
      default:        return { periodStart: startOfWeek(now, { weekStartsOn: 1 }), periodEnd: endOfWeek(now, { weekStartsOn: 1 }) }
    }
  }, [range])

  // 本期新增客戶（依 created_date）
  const periodNew = useMemo(() =>
    scopedCustomers.filter(c => {
      const d = parseISO(c.created_date)
      return isWithinInterval(d, { start: periodStart, end: periodEnd })
    })
  , [scopedCustomers, periodStart, periodEnd])

  // 本期新成交（依 mark_completed history 事件日期）
  const periodCompletedIds = useMemo(() => {
    const ids = new Set<string>()
    const scopedIds = new Set(scopedCustomers.map(c => c.id))
    for (const e of completedEvents) {
      if (!scopedIds.has(e.customer_id)) continue
      const d = parseISO(e.action_date)
      if (isWithinInterval(d, { start: periodStart, end: periodEnd })) {
        ids.add(e.customer_id)
      }
    }
    return ids
  }, [completedEvents, scopedCustomers, periodStart, periodEnd])

  // 圖 1: 各業務本期新增客戶數
  const chart1 = useMemo(() => {
    return scopedUsers.map(u => ({
      name: u.chinese_name || u.name,
      count: periodNew.filter(c => c.assigned_to === u.id).length,
    })).filter(d => d.count > 0).sort((a, b) => b.count - a.count)
  }, [scopedUsers, periodNew])

  // 圖 2: 各業務已成交數量（含 completed + long_term）
  const chart2 = useMemo(() => {
    return scopedUsers.map(u => {
      const mine = scopedCustomers.filter(c => c.assigned_to === u.id)
      const completed = mine.filter(c => c.status === 'completed').length
      const long_term = mine.filter(c => c.status === 'long_term').length
      return {
        name: u.chinese_name || u.name,
        completed,
        long_term,
        total: completed + long_term,
      }
    }).filter(d => d.total > 0).sort((a, b) => b.total - a.total)
  }, [scopedUsers, scopedCustomers])

  // 圖 3: 各業務等級分佈（所有狀態）
  const chart3 = useMemo(() => {
    return scopedUsers.map(u => {
      const mine = scopedCustomers.filter(c => c.assigned_to === u.id)
      return {
        name: u.chinese_name || u.name,
        A: mine.filter(c => c.grade === 'A').length,
        B: mine.filter(c => c.grade === 'B').length,
        C: mine.filter(c => c.grade === 'C').length,
        total: mine.length,
      }
    }).filter(d => d.total > 0).sort((a, b) => b.total - a.total)
  }, [scopedUsers, scopedCustomers])

  // 圖 4: 各業務平均開發天數（只算已成交客戶 created_date → mark_completed 的天數）
  const chart4 = useMemo(() => {
    // 建 customer_id → earliest mark_completed date
    const closureDate = new Map<string, Date>()
    for (const e of completedEvents) {
      const d = parseISO(e.action_date)
      const existing = closureDate.get(e.customer_id)
      if (!existing || d < existing) closureDate.set(e.customer_id, d)
    }

    return scopedUsers.map(u => {
      const mine = scopedCustomers.filter(c =>
        c.assigned_to === u.id &&
        (c.status === 'completed' || c.status === 'long_term')
      )
      const days: number[] = []
      for (const c of mine) {
        const closed = closureDate.get(c.id)
        if (!closed) continue
        const created = parseISO(c.created_date)
        const diff = differenceInDays(closed, created)
        if (diff >= 0) days.push(diff)
      }
      const avg = days.length > 0 ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null
      return {
        name: u.chinese_name || u.name,
        avg: avg ?? 0,
        count: days.length,
        hasData: days.length > 0,
      }
    }).filter(d => d.hasData).sort((a, b) => a.avg - b.avg)
  }, [scopedUsers, scopedCustomers, completedEvents])

  // 權限檢查
  if (user && user.role === 'sales') {
    return <div className="p-4 text-center py-12 text-gray-400">您沒有權限查看此頁面</div>
  }

  if (loading) {
    return (
      <PageLoading />
    )
  }

  // 整體摘要
  const totalNew = periodNew.length
  const totalCompleted = periodCompletedIds.size
  const totalActive = scopedCustomers.filter(c => c.status === 'active_developing' || c.status === 'reactivating' || c.status === 'negotiating').length
  const totalCompletedAll = scopedCustomers.filter(c => c.status === 'completed' || c.status === 'long_term').length

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-3">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">
          {isSuperRole ? '業務績效儀表板' : `${user?.team} 績效儀表板`}
        </h1>
        {!isSuperRole && (
          <p className="text-xs text-gray-500 mt-1">
            僅顯示 <strong>{user?.team}</strong> 成員資料
          </p>
        )}
      </div>

      {/* 時間切換 */}
      <div className="flex gap-2 mb-3 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-1">
        {(['week', 'month', 'quarter', 'year'] as Range[]).map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-sm font-medium transition shrink-0',
              range === r ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            {RANGE_LABELS[r]}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-500 mb-4">
        統計期間：{formatDate(periodStart.toISOString())} ~ {formatDate(periodEnd.toISOString())}
      </p>

      {/* 總摘要 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="card text-center">
          <p className="text-3xl font-bold text-primary-600">{totalNew}</p>
          <p className="text-sm text-gray-500">{RANGE_LABELS[range]}新建檔</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-amber-500">{totalCompleted}</p>
          <p className="text-sm text-gray-500">🏆 {RANGE_LABELS[range]}新成交</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-800">{totalCompletedAll}</p>
          <p className="text-sm text-gray-500">⭐ 累計已成交</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-blue-500">{totalActive}</p>
          <p className="text-sm text-gray-500">進行中客戶</p>
        </div>
      </div>

      {/* 圖 1: 本期新增客戶數 */}
      <ChartCard
        title="📈 各業務本期新增客戶數"
        subtitle={`${RANGE_LABELS[range]}內建檔的客戶數量`}
        empty={chart1.length === 0}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart1} margin={{ top: 10, right: 10, left: 0, bottom: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" interval={0} height={60} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => [`${v} 筆`, '新增']} />
            <Bar dataKey="count" fill="#1e3a5f" name="新增客戶" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* 圖 2: 已成交數量 */}
      <ChartCard
        title="🏆 各業務已成交客戶數"
        subtitle="含「已成交」與「長期合作」"
        empty={chart2.length === 0}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart2} margin={{ top: 10, right: 10, left: 0, bottom: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" interval={0} height={60} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v, n) => [`${v} 筆`, String(n)]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="completed" stackId="deal" fill="#fbbf24" name="🏆 已成交" />
            <Bar dataKey="long_term" stackId="deal" fill="#166534" name="⭐ 長期合作" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* 圖 3: 等級分佈 */}
      <ChartCard
        title="🎯 各業務客戶等級分佈"
        subtitle="依 A / B / C 堆疊顯示"
        empty={chart3.length === 0}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart3} margin={{ top: 10, right: 10, left: 0, bottom: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" interval={0} height={60} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v, n) => [`${v} 筆`, String(n)]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="A" stackId="grade" fill={GRADE_COLORS.A} name="A 級" />
            <Bar dataKey="B" stackId="grade" fill={GRADE_COLORS.B} name="B 級" />
            <Bar dataKey="C" stackId="grade" fill={GRADE_COLORS.C} name="C 級" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* 圖 4: 平均開發天數 */}
      <ChartCard
        title="⏱️ 各業務平均開發天數"
        subtitle="從建檔到標記「已成交」的平均天數（只列有成交記錄的業務）"
        empty={chart4.length === 0}
        emptyMessage="目前尚無業務有成交記錄，無法計算開發天數"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chart4}
            layout="vertical"
            margin={{ top: 10, right: 30, left: 20, bottom: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              formatter={(v, _n, props) => [
                `${v} 天（${props.payload.count} 筆成交）`,
                '平均',
              ]}
            />
            <Bar dataKey="avg" fill="#3b82f6" name="平均天數" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  )
}

// ===================================================
// 圖表卡片元件
// ===================================================
function ChartCard({
  title, subtitle, empty, emptyMessage, children,
}: {
  title: string
  subtitle?: string
  empty?: boolean
  emptyMessage?: string
  children: React.ReactNode
}) {
  return (
    <div className="card mb-6">
      <h2 className="font-bold text-gray-900 mb-1">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500 mb-3">{subtitle}</p>}
      {empty ? (
        <div className="h-40 flex items-center justify-center text-gray-400 text-sm">
          {emptyMessage || '此期間無資料'}
        </div>
      ) : (
        <div className="w-full" style={{ height: 300 }}>
          {children}
        </div>
      )}
    </div>
  )
}
