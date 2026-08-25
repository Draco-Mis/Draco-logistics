import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { sendEmail, emailTemplateWarning75, emailTemplateLocked90 } from '@/lib/email'

// 讓 admin 在介面上測試 email 是否能寄得出去
// GET  /api/admin/test-email?type=warning   寄 75 天黃燈樣本
// GET  /api/admin/test-email?type=locked    寄 90 天鎖檔樣本
export async function GET(request: Request) {
  const supabase = createServerSupabaseClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return NextResponse.json({ error: '未登入' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, email, chinese_name').eq('id', authUser.id).single()
  if (profile?.role !== 'admin' && profile?.role !== 'chairman') {
    return NextResponse.json({ error: '權限不足' }, { status: 403 })
  }
  if (!profile.email) return NextResponse.json({ error: '您的帳號沒有 email' }, { status: 400 })

  const url = new URL(request.url)
  const type = url.searchParams.get('type') || 'warning'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin

  const tpl = type === 'locked'
    ? emailTemplateLocked90({
        recipientName: profile.chinese_name,
        salesName: '測試業務',
        companyName: '測試公司（範例）',
        customerId: 'test-id',
        appUrl,
      })
    : emailTemplateWarning75({
        salesName: profile.chinese_name,
        companyName: '測試公司（範例）',
        customerId: 'test-id',
        appUrl,
      })

  const r = await sendEmail({ to: profile.email, subject: `[測試] ${tpl.subject}`, html: tpl.html })
  return NextResponse.json({ sent_to: profile.email, ...r })
}
