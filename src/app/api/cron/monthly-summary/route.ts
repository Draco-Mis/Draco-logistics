import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// 每月 1 號 00:00（UTC）執行，為每位在職人員產生站內月報通知。
// 比週報多了「本月新增」「本月成交」兩項統計。
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: users } = await supabase
    .from('users')
    .select('id, chinese_name')
    .eq('is_active', true)
  if (!users) return NextResponse.json({ error: 'no users' })

  // 所有客戶（分頁）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allCustomers: any[] = []
  let from = 0
  while (true) {
    const { data } = await supabase
      .from('customers')
      .select('id, status, created_date, assigned_to')
      .is('deleted_at', null)
      .range(from, from + 999)
    if (!data || data.length === 0) break
    allCustomers.push(...data)
    if (data.length < 1000) break
    from += 1000
  }

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

  // 本月成交（customer_history mark_completed），依 action_by 計數
  const wonByUser = new Map<string, number>()
  const { data: wonRows } = await supabase
    .from('customer_history')
    .select('action_by')
    .eq('action_type', 'mark_completed')
    .gte('action_date', monthStart)
  for (const r of (wonRows || []) as { action_by: string | null }[]) {
    if (r.action_by) wonByUser.set(r.action_by, (wonByUser.get(r.action_by) || 0) + 1)
  }

  const monthLabel = `${now.getUTCFullYear()} 年 ${now.getUTCMonth() + 1} 月`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notifications: any[] = []

  for (const u of users) {
    const mine = allCustomers.filter(c => c.assigned_to === u.id)
    if (mine.length === 0 && !wonByUser.get(u.id)) continue

    const newThisMonth = mine.filter(c => c.created_date && new Date(c.created_date).toISOString() >= monthStart).length
    const wonThisMonth = wonByUser.get(u.id) || 0
    const active = mine.filter(c => ['active_developing', 'warning', 'reactivating', 'negotiating'].includes(c.status)).length

    const lines = [`📅 上個月回顧：您目前負責 ${mine.length} 筆客戶`]
    if (newThisMonth > 0) lines.push(`本月新增 ${newThisMonth} 筆`)
    if (wonThisMonth > 0) lines.push(`🏆 本月成交 ${wonThisMonth} 筆`)
    if (active > 0) lines.push(`開發中 ${active} 筆`)

    notifications.push({
      user_id: u.id,
      title: `📅 ${monthLabel} 月報`,
      message: lines.join('、'),
      link: '/my-customers',
    })
  }

  if (notifications.length > 0) {
    await supabase.from('notifications').insert(notifications)
  }

  return NextResponse.json({ message: 'Monthly summary sent', count: notifications.length })
}
