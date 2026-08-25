import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

// 登入後呼叫，產生每日一次的歡迎通知（含客戶摘要）
export async function POST() {
  const supabase = createServerSupabaseClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return NextResponse.json({ skip: true })

  const userId = authUser.id

  // 檢查今天是否已經送過歡迎通知（避免重複）
  const today = new Date().toISOString().split('T')[0]
  const { data: existing } = await supabase
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .like('title', '👋 歡迎回來%')
    .gte('created_at', today + 'T00:00:00')
    .limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json({ skip: true, reason: 'already sent today' })
  }

  // 抓該使用者的客戶統計
  const { data: myCustomers } = await supabase
    .from('customers')
    .select('id, status, grade, company_code_type, last_contact_date, created_date')
    .eq('assigned_to', userId)

  if (!myCustomers || myCustomers.length === 0) {
    await supabase.from('notifications').insert({
      user_id: userId,
      title: '👋 歡迎回來',
      message: '目前尚無負責的客戶，開始建檔吧！',
      link: '/customers/new',
    })
    return NextResponse.json({ ok: true })
  }

  const total = myCustomers.length
  const now = new Date()

  // 即將到期（30 天內）
  const expiringSoon = myCustomers.filter(c => {
    if (['completed', 'long_term', 'abandoned', 'locked'].includes(c.status)) return false
    const elapsed = Math.floor((now.getTime() - new Date(c.created_date).getTime()) / (86400000))
    return (90 - elapsed) <= 30
  }).length

  // 資料不完整
  const incomplete = myCustomers.filter(c => {
    let score = 0
    if (c.grade === 'A' || c.grade === 'B') score++
    if (c.company_code_type) score++
    if (c.last_contact_date) score++
    // contacts 不查了（太慢），用 3 項估
    return score < 3
  }).length

  const completed = myCustomers.filter(c => c.status === 'completed' || c.status === 'long_term').length

  const parts = [`您負責 ${total} 筆客戶`]
  if (completed > 0) parts.push(`🏆 已成交 ${completed} 筆`)
  if (expiringSoon > 0) parts.push(`⚠️ ${expiringSoon} 筆即將到期（30 天內）`)
  if (incomplete > 0) parts.push(`📝 ${incomplete} 筆資料待補齊`)

  await supabase.from('notifications').insert({
    user_id: userId,
    title: '👋 歡迎回來',
    message: parts.join('、'),
    link: '/my-customers',
  })

  return NextResponse.json({ ok: true })
}
