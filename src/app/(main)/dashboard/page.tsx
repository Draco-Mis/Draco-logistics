'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Users, ClipboardList, BarChart3, ArrowRight, Bell, TrendingUp, AlertCircle, Sparkles,
  Flame, Eye, Activity, PieChart as PieIcon, UserCheck, Lightbulb, Quote, Cloud,
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { useAuth } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase-client'
import { formatDateTime } from '@/lib/utils'
import { SkeletonStat, SkeletonCard, Skeleton } from '@/components/ui/Skeleton'
import { useShortcutKey } from '@/lib/use-platform'
import { useRecentCustomers } from '@/lib/use-recent-customers'
import { useOnline } from '@/lib/presence-context'
import { getDailyTip, getDailyQuote } from '@/lib/daily-content'
import { STATUS_META } from '@/lib/constants'
import { isLeadership as checkLeadership, hasHRAccess as checkHR } from '@/lib/permissions'
import { useCountUp } from '@/lib/use-count-up'

interface Stats {
  myCustomerCount: number
  todayNotifications: number
  pendingTransfers: number
  recentSubmissionCount: number
}

interface CustomerLite {
  id: string
  company_name: string
  status: string | null
  grade: string | null
  last_contact_date: string | null
  assigned_to: string | null
  created_date: string | null
}

interface HistoryRow {
  id: string
  customer_id: string
  action_type: string
  action_by: string | null
  action_date: string
  note: string | null
  customers?: { company_name: string } | null
  action_user?: { chinese_name: string | null; name: string; role?: string } | null
}

interface FollowUpLite {
  id: string
  content: string
  due_date: string | null
  customer_id: string
  customers?: { company_name: string } | null
}

interface PendingHire {
  id: string
  respondent_name: string
  english_name: string | null
  department: string
  hired_at: string
  event_id: string
  event_name: string
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '剛剛'
  if (min < 60) return `${min} 分鐘前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小時前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return formatDateTime(iso).slice(0, 10)
}

function daysSince(date: string | null): number {
  if (!date) return 999
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
}

export default function DashboardPage() {
  const { user } = useAuth()
  const supabase = createClient()
  const [stats, setStats] = useState<Stats | null>(null)
  const [myCustomers, setMyCustomers] = useState<CustomerLite[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [pendingHires, setPendingHires] = useState<PendingHire[]>([])
  const [followUps, setFollowUps] = useState<FollowUpLite[]>([])
  const [weather, setWeather] = useState<{ tempC: number; emoji: string; desc: string; humidity: number; city: string } | null>(null)
  const [weatherError, setWeatherError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const shortcutKey = useShortcutKey()
  const recentViewed = useRecentCustomers(5)
  const { count: onlineCount, users: onlineUsers } = useOnline()

  const isLeadership = checkLeadership(user)
  const hasHRAccess = checkHR(user)

  const dailyTip = getDailyTip()
  const dailyQuote = getDailyQuote()

  useEffect(() => {
    if (!user) return
    let cancel = false

    ;(async () => {
      setLoading(true)
      try {
        // 我名下所有客戶（用於：統計、健康警示、熱門、圓餅）
        const { data: customers } = await supabase
          .from('customers')
          .select('id, company_name, status, grade, last_contact_date, assigned_to, created_date')
          .eq('assigned_to', user.id)

        // 今日未讀通知
        const { count: notifCount } = await supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('is_read', false)
          .gte('created_at', new Date(Date.now() - 86400000).toISOString())

        // 待審核事項：轉移申請 + 刪除申請（修正：原本查了不存在的 transfers 表）
        let pendingTransfers = 0
        if (isLeadership) {
          const [tRes, dRes] = await Promise.all([
            supabase.from('transfer_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
            supabase.from('customer_deletion_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          ])
          pendingTransfers = (tRes.count || 0) + (dRes.count || 0)
        }

        // 本週完成測驗
        let recentSubmissions = 0
        if (hasHRAccess) {
          const { count } = await supabase
            .from('assessment_submissions')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'completed')
            .gte('completed_at', new Date(Date.now() - 7 * 86400000).toISOString())
          recentSubmissions = count || 0
        }

        // 客戶歷史（主管看全部、業務看自己）
        // 多撈一些，之後要過濾掉「不對外顯示」的動態（見下方 HIDDEN_ACTORS）
        let histQuery = supabase
          .from('customer_history')
          .select(`
            id, customer_id, action_type, action_by, action_date, note,
            customers!customer_id(company_name),
            action_user:users!action_by(chinese_name, name, role)
          `)
          .order('action_date', { ascending: false })
          .limit(isLeadership ? 40 : 10)
        if (!isLeadership) histQuery = histQuery.eq('action_by', user.id)
        const { data: histData } = await histQuery

        // 首頁動態牆過濾：非 admin 檢視者，看不到「管理員」與「許宏誌」的動態
        // （admin 仍看得到全部；本人一律看得到自己的動態）
        const isAdminViewer = user.role === 'admin'
        const HIDDEN_ACTOR_NAMES = ['許宏誌']
        const filteredHist = (histData || []).filter((h: unknown) => {
          const row = h as HistoryRow
          if (isAdminViewer || row.action_by === user.id) return true
          const au = row.action_user
          const hidden = au?.role === 'admin' || (au?.chinese_name != null && HIDDEN_ACTOR_NAMES.includes(au.chinese_name))
          return !hidden
        }).slice(0, 10)

        // 待面試錄取
        let pendingHiresList: PendingHire[] = []
        if (hasHRAccess) {
          const { data: hires } = await supabase
            .from('assessment_submissions')
            .select(`
              id, respondent_name, english_name, department, hired_at, event_id,
              assessment_events!event_id(name, kind)
            `)
            .not('hired_at', 'is', null)
            .is('hired_employee_id', null)
            .order('hired_at', { ascending: false })
            .limit(10)
          // Supabase 把 join 後的 single/multi 關聯回傳為陣列；用寬鬆型別安全處理
          type HireRow = {
            id: string; respondent_name: string; english_name: string | null; department: string;
            hired_at: string; event_id: string;
            assessment_events: { name: string; kind: string } | { name: string; kind: string }[] | null
          }
          const getEvent = (e: HireRow['assessment_events']) =>
            Array.isArray(e) ? (e[0] || null) : e
          pendingHiresList = ((hires || []) as unknown as HireRow[])
            .filter(h => getEvent(h.assessment_events)?.kind === 'interview')
            .map(h => ({
              id: h.id,
              respondent_name: h.respondent_name,
              english_name: h.english_name,
              department: h.department,
              hired_at: h.hired_at,
              event_id: h.event_id,
              event_name: getEvent(h.assessment_events)?.name || '',
            }))
        }

        // 我的跟進待辦（未完成，依到期日）
        const { data: fuData } = await supabase
          .from('customer_follow_ups')
          .select('id, content, due_date, customer_id, customers!customer_id(company_name)')
          .eq('created_by', user.id)
          .eq('is_done', false)
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(8)

        if (cancel) return
        setMyCustomers((customers || []) as CustomerLite[])
        setHistory(filteredHist as unknown as HistoryRow[])
        setPendingHires(pendingHiresList)
        setFollowUps((fuData || []) as unknown as FollowUpLite[])
        setStats({
          myCustomerCount: customers?.length || 0,
          todayNotifications: notifCount || 0,
          pendingTransfers,
          recentSubmissionCount: recentSubmissions,
        })
      } finally {
        if (!cancel) setLoading(false)
      }
    })()

    // 天氣（不阻塞 loading）
    ;(async () => {
      try {
        const res = await fetch('/api/dashboard/weather')
        const data = await res.json().catch(() => ({ ok: false, error: 'parse error' }))
        if (cancel) return
        if (data.ok) setWeather(data)
        else setWeatherError(data.error || '無法載入')
      } catch (e) {
        if (!cancel) setWeatherError(e instanceof Error ? e.message : '網路錯誤')
      }
    })()

    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 6) return '晚安'
    if (h < 12) return '早安'
    if (h < 18) return '午安'
    return '晚安'
  })()

  // 計算健康警示
  const healthAlerts = (() => {
    const alerts: Array<{ customer: CustomerLite; score: number; reason: string; level: 'red' | 'orange' | 'yellow' }> = []
    for (const c of myCustomers) {
      let score = 0
      let reason = ''
      let level: 'red' | 'orange' | 'yellow' = 'yellow'
      if (c.status === 'warning') {
        score = 100; reason = '已標記黃燈警示'; level = 'red'
      } else if (c.status === 'negotiating') {
        const d = daysSince(c.last_contact_date)
        if (d > 14) { score = 80 + Math.min(d, 60); reason = `洽談中 ${d} 天未接觸`; level = 'orange' }
      } else if (c.status === 'active_developing') {
        const d = daysSince(c.last_contact_date)
        if (d > 30) { score = 50 + Math.min(d - 30, 30); reason = `開發中 ${d} 天未接觸`; level = 'yellow' }
      } else if (c.status === 'locked') {
        score = 70; reason = '鎖檔暫停中需確認'; level = 'orange'
      }
      if (score > 0) alerts.push({ customer: c, score, reason, level })
    }
    return alerts.sort((a, b) => b.score - a.score).slice(0, 5)
  })()

  // 本週新增的客戶數（給統計卡趨勢）
  const newThisWeek = myCustomers.filter(c =>
    c.created_date && (Date.now() - new Date(c.created_date).getTime()) < 7 * 86400000
  ).length

  const hotCustomers = myCustomers
    .filter(c => c.status === 'negotiating')
    .sort((a, b) => daysSince(a.last_contact_date) - daysSince(b.last_contact_date))
    .slice(0, 6)

  const statusDist = (() => {
    const map: Record<string, number> = {}
    for (const c of myCustomers) {
      const k = c.status || 'unknown'
      map[k] = (map[k] || 0) + 1
    }
    return Object.entries(map)
      .map(([k, count]) => ({ key: k, name: STATUS_META[k]?.label || k, count, color: STATUS_META[k]?.color || '#9ca3af' }))
      .sort((a, b) => b.count - a.count)
  })()

  // 轉換漏斗：開發中 → 洽談中 → 已成交（依目前狀態快照）
  const funnel = (() => {
    const inState = (arr: string[]) => myCustomers.filter(c => arr.includes(c.status || '')).length
    const developing = inState(['active_developing', 'reactivating', 'warning'])
    const negotiating = inState(['negotiating'])
    const won = inState(['completed', 'long_term'])
    const base = developing + negotiating + won
    const stages = [
      { key: 'developing', label: '開發中', count: developing, color: '#3b82f6' },
      { key: 'negotiating', label: '洽談中', count: negotiating, color: '#a855f7' },
      { key: 'won', label: '已成交', count: won, color: '#10b981' },
    ]
    const max = Math.max(1, ...stages.map(s => s.count))
    const winRate = base > 0 ? Math.round((won / base) * 100) : 0
    return { stages, max, winRate, base }
  })()

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-3">
      {/* 問候語 */}
      <div className="mb-3 animate-fade-in-up">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">
          {greeting}，{user?.chinese_name || user?.name?.split('@')[0]}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          {onlineCount > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              目前線上 {onlineCount} 人
            </span>
          )}
          <span className="ml-2 text-gray-400">· 按 <kbd className="bg-gray-100 px-1 rounded text-xs">{shortcutKey}</kbd> 快速搜尋</span>
        </p>
      </div>

      {/* 統計卡 */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonStat key={i} />)}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard href="/my-customers" icon={Users} label="我的客戶" value={stats.myCustomerCount} color="accent" delay={0} trend={newThisWeek > 0 ? `本週 +${newThisWeek}` : undefined} />
          <StatCard href="/notifications" icon={Bell} label="今日新通知" value={stats.todayNotifications} color={stats.todayNotifications > 0 ? 'amber' : 'gray'} delay={60} />
          {isLeadership && (
            <StatCard href="/transfers" icon={AlertCircle} label="待審核事項" value={stats.pendingTransfers} color={stats.pendingTransfers > 0 ? 'rose' : 'gray'} delay={120} />
          )}
          {hasHRAccess && (
            <StatCard href="/admin/assessments" icon={ClipboardList} label="本週完成測驗" value={stats.recentSubmissionCount} color="fuchsia" delay={180} />
          )}
        </div>
      ) : null}

      {/* 目前線上 */}
      {onlineCount > 0 && (
        <div className="card">
          <h3 className="font-bold text-gray-900 mb-2 text-sm flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> 目前線上
            <span className="ml-1 text-xs text-gray-400">（{onlineCount} 人）</span>
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {onlineUsers.map(u => (
              <span key={u.user_id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {u.name || '（未命名）'}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* A. 客戶健康警示 + B. 熱門客戶 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {loading ? <SkeletonCard rows={5} /> : (
          <div className="card">
            <h3 className="font-bold text-gray-900 mb-1 text-sm flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-orange-500" /> 客戶健康警示
              {healthAlerts.length > 0 && <span className="ml-1 text-xs text-gray-400">({healthAlerts.length})</span>}
            </h3>
            <p className="text-xs text-gray-500 mb-2">最需要主動聯繫的 5 筆</p>
            {healthAlerts.length === 0 ? (
              <p className="text-xs text-emerald-600 py-3">✓ 你的客戶都在掌握中，沒有警示</p>
            ) : (
              <div className="space-y-1">
                {healthAlerts.map(a => (
                  <Link
                    key={a.customer.id}
                    href={`/customers/${a.customer.id}`}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 transition"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      a.level === 'red' ? 'bg-red-500' : a.level === 'orange' ? 'bg-orange-500' : 'bg-yellow-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{a.customer.company_name}</div>
                      <div className="text-[11px] text-gray-500">{a.reason}</div>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {loading ? <SkeletonCard rows={5} /> : (
          <div className="card">
            <h3 className="font-bold text-gray-900 mb-1 text-sm flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-rose-500" /> 熱門客戶（洽談中）
              {hotCustomers.length > 0 && <span className="ml-1 text-xs text-gray-400">({hotCustomers.length})</span>}
            </h3>
            <p className="text-xs text-gray-500 mb-2">這週優先收的單</p>
            {hotCustomers.length === 0 ? (
              <p className="text-xs text-gray-400 py-3">目前沒有「洽談中」的客戶</p>
            ) : (
              <div className="space-y-1">
                {hotCustomers.map(c => (
                  <Link
                    key={c.id}
                    href={`/customers/${c.id}`}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-rose-50/40 transition"
                  >
                    <Flame className="w-3 h-3 text-rose-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{c.company_name}</div>
                      <div className="text-[11px] text-gray-500">
                        {c.grade && <span className="mr-2">{c.grade} 級</span>}
                        {c.last_contact_date ? `上次接觸 ${daysSince(c.last_contact_date)} 天前` : '未紀錄接觸'}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* B2. 轉換漏斗 */}
      {!loading && funnel.base > 0 && (
        <div className="card">
          <h3 className="font-bold text-gray-900 mb-1 text-sm flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-emerald-500" /> 我的轉換漏斗
            <span className="ml-auto text-xs font-normal text-gray-400">成交率 <span className="font-bold text-emerald-600">{funnel.winRate}%</span></span>
          </h3>
          <p className="text-xs text-gray-500 mb-3">目前開發中 → 洽談 → 成交的分布</p>
          <div className="space-y-2">
            {funnel.stages.map(s => (
              <div key={s.key} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 w-14 shrink-0">{s.label}</span>
                <div className="flex-1 h-6 rounded-lg bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-lg flex items-center justify-end px-2 transition-all duration-500"
                    style={{ width: `${Math.max(8, (s.count / funnel.max) * 100)}%`, background: s.color }}
                  >
                    <span className="text-[11px] font-bold text-white tabular-nums">{s.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* B3. 待跟進 */}
      {!loading && followUps.length > 0 && (
        <div className="card">
          <h3 className="font-bold text-gray-900 mb-1 text-sm flex items-center gap-1.5">
            🎯 待跟進
            <span className="ml-1 text-xs text-gray-400">（{followUps.length}）</span>
          </h3>
          <p className="text-xs text-gray-500 mb-2">你設定的下一步，逾期會標紅</p>
          <div className="space-y-1">
            {followUps.map(f => {
              const overdue = f.due_date && f.due_date < new Date().toISOString().slice(0, 10)
              return (
                <Link key={f.id} href={`/customers/${f.customer_id}`} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 transition">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${overdue ? 'bg-red-500' : 'bg-accent-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-800 truncate">{f.content}</div>
                    <div className="text-[11px] text-gray-500">
                      {f.customers?.company_name || '客戶'}
                      {f.due_date && <span className={overdue ? 'text-red-500 font-medium' : ''}> · 📅 {f.due_date.slice(5)}{overdue && ' 逾期'}</span>}
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* C. 最近查看的客戶 */}
      {recentViewed.length > 0 && (
        <div className="card">
          <h3 className="font-bold text-gray-900 mb-2 text-sm flex items-center gap-1.5">
            <Eye className="w-4 h-4 text-accent-500" /> 最近查看的客戶
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {recentViewed.map(r => (
              <Link
                key={r.id}
                href={`/customers/${r.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-50 hover:bg-accent-50 text-xs text-gray-700 hover:text-accent-700 transition"
              >
                <span className="font-medium">{r.name}</span>
                <span className="text-[10px] text-gray-400">{relativeTime(r.viewed_at)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* D. 最近活動 feed */}
      {loading ? <SkeletonCard rows={5} /> : (
        <div className="card">
          <h3 className="font-bold text-gray-900 mb-1 text-sm flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-blue-500" /> 最近活動
            <span className="ml-1 text-xs text-gray-400">{isLeadership ? '（團隊全部）' : '（你的紀錄）'}</span>
          </h3>
          {history.length === 0 ? (
            <p className="text-xs text-gray-400 py-3">尚無活動紀錄</p>
          ) : (
            <div className="space-y-1">
              {history.map(h => {
                const meta = actionMeta(h.action_type)
                const who = h.action_user?.chinese_name || h.action_user?.name?.split('@')[0] || '系統'
                return (
                  <Link
                    key={h.id}
                    href={h.customer_id ? `/customers/${h.customer_id}` : '#'}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 transition"
                  >
                    <span className="text-base shrink-0">{meta.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-800 truncate">
                        <span className="font-semibold">{who}</span>
                        <span className="text-gray-500">{meta.verb}</span>
                        <span className="font-medium">「{h.customers?.company_name || '客戶'}」</span>
                        {h.note && <span className="text-gray-500"> · {h.note.slice(0, 30)}</span>}
                      </div>
                    </div>
                    <span className="text-[11px] text-gray-400 shrink-0">{relativeTime(h.action_date)}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* E. 客戶分布圓餅圖 + F. 待面試錄取 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {loading ? <SkeletonCard rows={6} /> : (
          <div className="card">
            <h3 className="font-bold text-gray-900 mb-2 text-sm flex items-center gap-1.5">
              <PieIcon className="w-4 h-4 text-purple-500" /> 我的客戶狀態分布
            </h3>
            {statusDist.length === 0 ? (
              <p className="text-xs text-gray-400 py-8 text-center">尚無客戶</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 items-center">
                <div className="w-full h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusDist} dataKey="count" nameKey="name" outerRadius={70} innerRadius={36} paddingAngle={2}>
                        {statusDist.map((s, i) => <Cell key={i} fill={s.color} />)}
                      </Pie>
                      <Tooltip formatter={(v: unknown) => [`${v} 筆`, '客戶數']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-xs space-y-1">
                  {statusDist.map(s => (
                    <div key={s.key} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                      <span className="flex-1 text-gray-700">{s.name}</span>
                      <span className="font-bold text-gray-900 tabular-nums">{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {hasHRAccess && (
          loading ? <SkeletonCard rows={4} /> : (
            <div className="card">
              <h3 className="font-bold text-gray-900 mb-1 text-sm flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-emerald-500" /> 待面試錄取歸檔
                {pendingHires.length > 0 && <span className="ml-1 text-xs text-gray-400">({pendingHires.length})</span>}
              </h3>
              <p className="text-xs text-gray-500 mb-2">已標記錄取但尚未加入員工名冊</p>
              {pendingHires.length === 0 ? (
                <p className="text-xs text-gray-400 py-3">目前沒有待歸檔的錄取候選人</p>
              ) : (
                <div className="space-y-1">
                  {pendingHires.slice(0, 5).map(h => (
                    <Link
                      key={h.id}
                      href={`/admin/assessments/${h.event_id}`}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-emerald-50/50 transition"
                    >
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {h.respondent_name}
                          {h.english_name && <span className="text-xs text-gray-500 ml-1.5">({h.english_name})</span>}
                        </div>
                        <div className="text-[11px] text-gray-500">{h.department} · {relativeTime(h.hired_at)}</div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </div>

      {/* G. 每日小提示 + H. 今日金句 + I. 天氣 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card bg-gradient-to-br from-accent-50 to-white border border-accent-100">
          <h4 className="text-xs font-bold text-accent-900 mb-1 flex items-center gap-1.5">
            <Lightbulb className="w-3.5 h-3.5" /> 今日小提示
          </h4>
          <p className="text-sm text-gray-700 leading-relaxed">{dailyTip}</p>
        </div>

        <div className="card bg-gradient-to-br from-fuchsia-50 to-white border border-fuchsia-100">
          <h4 className="text-xs font-bold text-fuchsia-900 mb-1 flex items-center gap-1.5">
            <Quote className="w-3.5 h-3.5" /> 今日金句
          </h4>
          <p className="text-sm text-gray-700 leading-relaxed italic">「{dailyQuote}」</p>
        </div>

        <div className="card bg-gradient-to-br from-sky-50 to-white border border-sky-100">
          <h4 className="text-xs font-bold text-sky-900 mb-1 flex items-center gap-1.5">
            <Cloud className="w-3.5 h-3.5" /> 高雄天氣
          </h4>
          {weather ? (
            <div className="flex items-center gap-3">
              <span className="text-3xl">{weather.emoji}</span>
              <div>
                <div className="text-2xl font-bold text-gray-900 tabular-nums">{weather.tempC}°C</div>
                <div className="text-xs text-gray-500">{weather.desc} · 濕度 {weather.humidity}%</div>
              </div>
            </div>
          ) : weatherError ? (
            <p className="text-xs text-gray-400">天氣暫時無法載入（{weatherError}）</p>
          ) : (
            <Skeleton className="h-12 w-full" />
          )}
        </div>
      </div>
    </div>
  )
}

// ===== 子元件 =====

interface StatCardProps {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  color: 'accent' | 'amber' | 'rose' | 'fuchsia' | 'gray'
  delay?: number
  trend?: string
}

function StatCard({ href, icon: Icon, label, value, color, delay = 0, trend }: StatCardProps) {
  const animatedValue = useCountUp(value)
  const colorMap: Record<StatCardProps['color'], string> = {
    accent: 'text-accent-700 bg-accent-50',
    amber: 'text-amber-700 bg-amber-50',
    rose: 'text-rose-700 bg-rose-50',
    fuchsia: 'text-fuchsia-700 bg-fuchsia-50',
    gray: 'text-gray-600 bg-gray-50',
  }
  return (
    <Link href={href} className="card card-hover block animate-fade-in-up" style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}>
      <div className="flex items-start justify-between">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${colorMap[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <ArrowRight className="w-3.5 h-3.5 text-gray-300" />
      </div>
      <div className="mt-3">
        <div className="text-2xl font-bold text-gray-900 tabular-nums tracking-tight">{animatedValue}</div>
        <div className="text-xs text-gray-500 mt-0.5">{label}</div>
        {trend && (
          <div className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-600">
            <TrendingUp className="w-3 h-3" /> {trend}
          </div>
        )}
      </div>
    </Link>
  )
}

// 把 customer_history.action_type 對應成 emoji + 動詞
function actionMeta(action: string): { emoji: string; verb: string } {
  const map: Record<string, { emoji: string; verb: string }> = {
    created: { emoji: '✨', verb: ' 新增了 ' },
    warning: { emoji: '⚠️', verb: ' 將 客戶 標記為黃燈：' },
    locked: { emoji: '🔒', verb: ' 鎖檔了 ' },
    transfer_requested: { emoji: '↔️', verb: ' 申請轉移 ' },
    transfer_approved: { emoji: '✅', verb: ' 核准轉移 ' },
    reactivated: { emoji: '🔄', verb: ' 重新啟動 ' },
    mark_completed: { emoji: '🎉', verb: ' 將 客戶 標為已成交：' },
    mark_long_term: { emoji: '🤝', verb: ' 將 客戶 標為長期合作：' },
    mark_abandoned: { emoji: '🚫', verb: ' 將 客戶 標為未成交：' },
    mark_negotiating: { emoji: '💬', verb: ' 將 客戶 標為洽談中：' },
    deleted: { emoji: '🗑️', verb: ' 刪除了 ' },
    comment: { emoji: '💬', verb: ' 在 客戶 留言 ' },
    note_added: { emoji: '📝', verb: ' 為 ' },
  }
  return map[action] || { emoji: '📌', verb: ` 做了 ${action} 動作 ` }
}
