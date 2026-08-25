import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// 每週一 08:00 執行，為每位在職人員產生站內週報通知
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
    .select('id, chinese_name, role, team')
    .eq('is_active', true)

  if (!users) return NextResponse.json({ error: 'no users' })

  // 抓所有客戶（分頁）
  const allCustomers: any[] = []
  let from = 0
  while (true) {
    const { data } = await supabase
      .from('customers')
      .select('id, status, grade, created_date, assigned_to')
      .is('deleted_at', null)
      .range(from, from + 999)
    if (!data || data.length === 0) break
    allCustomers.push(...data)
    if (data.length < 1000) break
    from += 1000
  }

  const now = new Date()
  const notifications: any[] = []

  for (const u of users) {
    const mine = allCustomers.filter(c => c.assigned_to === u.id)
    if (mine.length === 0) continue

    const active = mine.filter(c => ['active_developing', 'warning', 'reactivating', 'negotiating'].includes(c.status)).length
    const completed = mine.filter(c => c.status === 'completed' || c.status === 'long_term').length
    const locked = mine.filter(c => c.status === 'locked').length

    // 即將到期（15 天內）
    const urgent = mine.filter(c => {
      if (['completed', 'long_term', 'abandoned', 'locked'].includes(c.status)) return false
      const elapsed = Math.floor((now.getTime() - new Date(c.created_date).getTime()) / 86400000)
      return (90 - elapsed) <= 15
    }).length

    const lines = [`📊 本週摘要：您負責 ${mine.length} 筆客戶`]
    if (active > 0) lines.push(`開發中 ${active} 筆`)
    if (completed > 0) lines.push(`🏆 已成交 ${completed} 筆`)
    if (locked > 0) lines.push(`🔒 鎖檔 ${locked} 筆`)
    if (urgent > 0) lines.push(`🔴 ${urgent} 筆即將到期（15 天內）`)

    notifications.push({
      user_id: u.id,
      title: '📊 每週摘要',
      message: lines.join('、'),
      link: '/my-customers',
    })
  }

  if (notifications.length > 0) {
    await supabase.from('notifications').insert(notifications)
  }

  return NextResponse.json({
    message: 'Weekly summary sent',
    count: notifications.length,
  })
}
