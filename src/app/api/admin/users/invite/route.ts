import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'
import { randomBytes } from 'crypto'

// 寄送密碼設定邀請信給「已經在 users 表但還沒建 Auth 帳號」的使用者
// Body: { userId: string }
export async function POST(request: Request) {
  // 1. 驗證呼叫者是 admin
  const supabase = createServerSupabaseClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) {
    return NextResponse.json({ error: '未登入' }, { status: 401 })
  }

  const { data: callerProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', authUser.id)
    .single()
  if (callerProfile?.role !== 'admin' && callerProfile?.role !== 'chairman') {
    return NextResponse.json({ error: '權限不足' }, { status: 403 })
  }

  // 2. 解析 body
  let userId: string
  try {
    const body = await request.json()
    userId = body.userId
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  if (!userId) {
    return NextResponse.json({ error: '缺少 userId' }, { status: 400 })
  }

  const admin = createServiceRoleClient()

  // 3. 找到 users 表裡的這個人
  const { data: targetUser, error: findErr } = await admin
    .from('users')
    .select('id, email, name, chinese_name, role, team, is_active')
    .eq('id', userId)
    .single()
  if (findErr || !targetUser) {
    return NextResponse.json({ error: '找不到使用者' }, { status: 404 })
  }
  if (!targetUser.is_active) {
    return NextResponse.json({ error: '此使用者已離職' }, { status: 400 })
  }

  // 4. 檢查 Auth 裡是否已經有此 email（避免重複建立）
  const { data: authList } = await admin.auth.admin.listUsers()
  const existingAuth = authList?.users.find((u: { email?: string }) => u.email === targetUser.email)

  const origin = new URL(request.url).origin

  if (!existingAuth) {
    // 5a. 建立 Auth 帳號，id 對齊 users.id，用隨機臨時密碼（使用者不會用到，會透過重設流程改）
    const tempPassword = randomBytes(24).toString('base64url')
    const { error: createErr } = await admin.auth.admin.createUser({
      id: targetUser.id,
      email: targetUser.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        chinese_name: targetUser.chinese_name,
        name: targetUser.name,
      },
    })
    if (createErr) {
      return NextResponse.json(
        { error: '建立 Auth 失敗：' + createErr.message },
        { status: 500 }
      )
    }
  }

  // 5b. 寄送密碼重設信（這封信使用者點擊後可設定新密碼）
  const { error: resetErr } = await admin.auth.resetPasswordForEmail(targetUser.email, {
    redirectTo: `${origin}/set-password`,
  })
  if (resetErr) {
    return NextResponse.json(
      { error: '邀請信寄送失敗：' + resetErr.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    message: `邀請信已寄至 ${targetUser.email}`,
    authCreated: !existingAuth,
  })
}
