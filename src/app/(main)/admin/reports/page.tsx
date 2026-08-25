'use client'

import { PageLoading } from '@/components/ui/PageLoading'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { Customer, User } from '@/types/database'
import { formatDate, cn } from '@/lib/utils'
import { canViewTeamReports } from '@/lib/permissions'
import {
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter,
  startOfYear, endOfYear,
  isWithinInterval, parseISO, eachDayOfInterval, format,
} from 'date-fns'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line,
} from 'recharts'

type Range = 'week' | 'month' | 'quarter' | 'year'

const RANGE_LABELS: Record<Range, string> = {
  week: '本週',
  month: '本月',
  quarter: '本季',
  year: '本年',
}

// 等級顏色（跟 getGradeColor 對齊的深淺藍）
const GRADE_COLORS = {
  A: '#1e3a5f',  // primary-600
  B: '#60a5fa',  // primary-400
  C: '#bfdbfe',  // primary-200
}

interface CompletedEvent {
  customer_id: string
  action_date: string
}

export default function ReportsPage() {
  const { user } = useAuth()
  const supabase = createClient()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [completedEvents, setCompletedEvents] = useState<CompletedEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<Range>('week')

  useEffect(() => {
    (async () => {
      // 分頁迴圈撈全部客戶（避免 1000 筆上限）
      const all: Customer[] = []
      let from = 0
      const size = 1000
      while (true) {
        // 只帶負責人需要的欄位（原本抓完整 user 物件，payload 過大）
        const { data, error } = await supabase
          .from('customers')
          .select('*, assigned_user:users!assigned_to(id, chinese_name, name, team)')
          .range(from, from + size - 1)
        if (error) { console.error('[reports] 查詢客戶失敗:', error.message); break }
        if (!data || data.length === 0) break
        all.push(...(data as unknown as Customer[]))
        if (data.length < size) break
        from += size
      }
      setCustomers(all)

      const [userRes, compRes] = await Promise.all([
        supabase.from('users').select('*').eq('is_active', true),
        supabase.from('customer_history')
          .select('customer_id, action_date')
          .eq('action_type', 'mark_completed')
          .order('action_date', { ascending: false }),
      ])
      if (userRes.data) setUsers(userRes.data)
      if (compRes.data) setCompletedEvents(compRes.data as CompletedEvent[])
      setLoading(false)
    })()
  }, [])

  // === 權限範圍：admin/chairman 看全部；課長看自己的課；副課長看自己的課但排除課長本人 ===
  const isFullScope = user?.role === 'admin' || user?.role === 'chairman'
  const { scopedCustomers, scopedUsers } = useMemo(() => {
    if (isFullScope || !user) {
      return { scopedCustomers: customers, scopedUsers: users }
    }
    // 同課成員；副課長額外排除課長（manager）本人 → 看不到課長名下的客戶
    let teamUsers = users.filter(u => u.team === user.team)
    if (user.role === 'deputy_manager') {
      teamUsers = teamUsers.filter(u => u.role !== 'manager')
    }
    const teamUserIds = new Set(teamUsers.map(u => u.id))
    const teamCustomers = customers.filter(c => teamUserIds.has(c.assigned_to))
    return { scopedCustomers: teamCustomers, scopedUsers: teamUsers }
  }, [customers, users, user, isFullScope])

  // === 依切換的時間範圍計算起訖 ===
  const { periodStart, periodEnd } = useMemo(() => {
    const now = new Date()
    switch (range) {
      case 'month':   return { periodStart: startOfMonth(now),   periodEnd: endOfMonth(now) }
      case 'quarter': return { periodStart: startOfQuarter(now), periodEnd: endOfQuarter(now) }
      case 'year':    return { periodStart: startOfYear(now),    periodEnd: endOfYear(now) }
      default:        return { periodStart: startOfWeek(now, { weekStartsOn: 1 }), periodEnd: endOfWeek(now, { weekStartsOn: 1 }) }
    }
  }, [range])

  // === 期間內新建檔的客戶 ===
  const periodNew = useMemo(() =>
    scopedCustomers.filter(c => {
      const d = parseISO(c.created_date)
      return isWithinInterval(d, { start: periodStart, end: periodEnd })
    })
  , [scopedCustomers, periodStart, periodEnd])

  const periodLocked = useMemo(() =>
    scopedCustomers.filter(c => {
      if (c.status !== 'locked' || !c.locked_at) return false
      const d = parseISO(c.locked_at)
      return isWithinInterval(d, { start: periodStart, end: periodEnd })
    })
  , [scopedCustomers, periodStart, periodEnd])

  const warningCustomers = useMemo(() => scopedCustomers.filter(c => c.status === 'warning'), [scopedCustomers])
  const activeCustomers = useMemo(() => scopedCustomers.filter(c => c.status === 'active_developing' || c.status === 'reactivating'), [scopedCustomers])

  // === 本期新增已成交（用歷史事件判斷「何時被標記為已成交」） ===
  const periodCompleted = useMemo(() => {
    const scopedIds = new Set(scopedCustomers.map(c => c.id))
    return completedEvents.filter(e => {
      if (!scopedIds.has(e.customer_id)) return false
      const d = parseISO(e.action_date)
      return isWithinInterval(d, { start: periodStart, end: periodEnd })
    })
  }, [completedEvents, scopedCustomers, periodStart, periodEnd])

  // === 各業務已成交客戶數排行（累計，不限期間） ===
  const completedRank = useMemo(() => {
    const counts = new Map<string, number>()
    scopedCustomers
      .filter(c => c.status === 'completed' || c.status === 'long_term')
      .forEach(c => counts.set(c.assigned_to, (counts.get(c.assigned_to) ?? 0) + 1))
    return scopedUsers
      .map(u => ({
        user: u,
        completed: scopedCustomers.filter(c => c.assigned_to === u.id && c.status === 'completed').length,
        long_term: scopedCustomers.filter(c => c.assigned_to === u.id && c.status === 'long_term').length,
        total: counts.get(u.id) ?? 0,
      }))
      .filter(r => r.total > 0)
      .sort((a, b) => b.total - a.total)
  }, [scopedCustomers, scopedUsers])

  // === 長條圖資料：各業務持有客戶（依等級 A/B/C 堆疊） ===
  const userChartData = useMemo(() => {
    return scopedUsers.map(u => {
      const mine = scopedCustomers.filter(c => c.assigned_to === u.id)
      return {
        name: u.chinese_name || u.name,
        A: mine.filter(c => c.grade === 'A').length,
        B: mine.filter(c => c.grade === 'B').length,
        C: mine.filter(c => c.grade === 'C').length,
        total: mine.length,
      }
    })
    .filter(d => d.total > 0)
    .sort((a, b) => b.total - a.total)
  }, [scopedCustomers, scopedUsers])

  // === 折線圖資料：本月每天新增客戶數（只在「本月」時有意義；其他範圍也一併支援） ===
  const dailyTrendData = useMemo(() => {
    // 本月展示每天；本週每天；本季改為每週一筆會更易讀但為了一致還是每天
    const days = eachDayOfInterval({ start: periodStart, end: periodEnd })
    return days.map(d => {
      const dayStr = format(d, 'yyyy-MM-dd')
      const count = scopedCustomers.filter(c => c.created_date === dayStr).length
      return {
        date: format(d, range === 'year' ? 'MM/dd' : 'MM/dd'),
        count,
      }
    })
  }, [scopedCustomers, periodStart, periodEnd, range])

  // === 各業務排行（用於表格） ===
  const userStats = useMemo(() => {
    return scopedUsers.map(u => {
      const userCustomers = scopedCustomers.filter(c => c.assigned_to === u.id)
      return {
        user: u,
        total: userCustomers.length,
        active: userCustomers.filter(c => c.status === 'active_developing' || c.status === 'reactivating').length,
        periodNew: periodNew.filter(c => c.assigned_to === u.id).length,
      }
    }).sort((a, b) => b.total - a.total)
  }, [scopedCustomers, scopedUsers, periodNew])

  if (!canViewTeamReports(user)) {
    return <div className="p-4 text-center py-12 text-gray-400">您沒有權限查看此頁面</div>
  }

  if (loading) {
    return (
      <PageLoading />
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-3">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">
          {isFullScope ? '業務報表' : `${user?.team}報表`}
        </h1>
        {!isFullScope && (
          <p className="text-xs text-gray-500 mt-1">
            以下資料僅限您所屬的 <strong>{user?.team}</strong> 成員與客戶
          </p>
        )}
      </div>

      {/* 時間範圍切換 */}
      <div className="flex gap-2 mb-3 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-1">
        {(['week', 'month', 'quarter', 'year'] as Range[]).map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-sm font-medium transition shrink-0',
              range === r
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            {RANGE_LABELS[r]}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-500 mb-4">
        統計期間：{formatDate(periodStart.toISOString())} ~ {formatDate(periodEnd.toISOString())}
      </p>

      {/* 摘要卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <div className="card text-center">
          <p className="text-3xl font-bold text-primary-600">{periodNew.length}</p>
          <p className="text-sm text-gray-500">{RANGE_LABELS[range]}新建檔</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-amber-500">{periodCompleted.length}</p>
          <p className="text-sm text-gray-500">🏆 {RANGE_LABELS[range]}新成交</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-orange-500">{warningCustomers.length}</p>
          <p className="text-sm text-gray-500">黃燈警示</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-red-500">{periodLocked.length}</p>
          <p className="text-sm text-gray-500">{RANGE_LABELS[range]}新鎖檔</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{activeCustomers.length}</p>
          <p className="text-sm text-gray-500">開發中客戶</p>
        </div>
      </div>

      {/* 長條圖：各業務持有客戶（等級 A/B/C 堆疊） */}
      <div className="card mb-6">
        <h2 className="font-bold text-gray-900 mb-1">各業務持有客戶數</h2>
        <p className="text-xs text-gray-500 mb-3">依等級 A / B / C 堆疊</p>
        <div className="w-full" style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={userChartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 50 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                angle={-45}
                textAnchor="end"
                interval={0}
                height={60}
              />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(value, name) => [`${value} 筆`, String(name)]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="A" stackId="grade" fill={GRADE_COLORS.A} name="A 級" />
              <Bar dataKey="B" stackId="grade" fill={GRADE_COLORS.B} name="B 級" />
              <Bar dataKey="C" stackId="grade" fill={GRADE_COLORS.C} name="C 級" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 折線圖：每日新增客戶趨勢 */}
      <div className="card mb-6">
        <h2 className="font-bold text-gray-900 mb-1">{RANGE_LABELS[range]}每日新增客戶趨勢</h2>
        <p className="text-xs text-gray-500 mb-3">每天建檔數量</p>
        <div className="w-full" style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={dailyTrendData}
              margin={{ top: 10, right: 10, left: 0, bottom: 30 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                interval={dailyTrendData.length > 20 ? Math.floor(dailyTrendData.length / 10) : 0}
                angle={dailyTrendData.length > 15 ? -45 : 0}
                textAnchor={dailyTrendData.length > 15 ? 'end' : 'middle'}
                height={40}
              />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(value) => [`${value} 筆`, '新增']}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#1e3a5f"
                strokeWidth={2}
                dot={{ r: 3, fill: '#1e3a5f' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 已成交排行 */}
      {completedRank.length > 0 && (
        <div className="card mb-6">
          <h2 className="font-bold text-gray-900 mb-1">🏆 各業務已成交客戶數排行</h2>
          <p className="text-xs text-gray-500 mb-3">包含「已成交」與「長期合作」</p>
          <div className="space-y-2">
            {completedRank.map((r, i) => (
              <div key={r.user.id} className="flex items-center gap-2 text-sm">
                <span className="w-6 text-gray-400 text-right">{i + 1}</span>
                <span className="flex-1 font-medium truncate">{r.user.chinese_name}（{r.user.name}）</span>
                <span className="text-xs text-gray-500 hidden sm:inline">{r.user.team}</span>
                <span className="badge bg-amber-100 text-amber-800">🏆 {r.completed}</span>
                {r.long_term > 0 && (
                  <span className="badge bg-green-100 text-green-800">⭐ {r.long_term}</span>
                )}
                <span className="font-bold text-primary-600">共 {r.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 業務排行表格 */}
      <div className="card mb-6">
        <h2 className="font-bold text-gray-900 mb-3">各業務持有客戶排行</h2>
        <div className="space-y-2">
          {userStats.map((s, i) => (
            <div key={s.user.id} className="flex items-center gap-2 text-sm">
              <span className="w-6 text-gray-400 text-right">{i + 1}</span>
              <span className="flex-1 font-medium truncate">{s.user.chinese_name}（{s.user.name}）</span>
              <span className="text-xs text-gray-500 hidden sm:inline">{s.user.team}</span>
              <span className="font-bold text-primary-600">{s.total} 筆</span>
              <span className="text-xs text-gray-400 hidden sm:inline">開發中 {s.active}</span>
              {s.periodNew > 0 && (
                <span className="badge bg-green-100 text-green-700">+{s.periodNew}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 黃燈警示客戶清單 */}
      {warningCustomers.length > 0 && (
        <div className="card">
          <h2 className="font-bold text-gray-900 mb-3">黃燈警示客戶清單（{warningCustomers.length} 筆）</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {warningCustomers.map(c => (
              <div key={c.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                <span className="font-medium truncate">{c.company_name}</span>
                <span className="text-gray-500 shrink-0 ml-2">{c.assigned_user?.chinese_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
