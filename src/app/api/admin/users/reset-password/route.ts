import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'

const TEMP_PASSWORD = 'Draco2026'

// 把指定使用者的密碼重設為 Draco2026，並標記 password_changed=false
export async function POST(request: Request) {
  // 1. 驗證呼叫者是 admin / chairman
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

  // 3. 不能重設自己
  if (userId === authUser.id) {
    return NextResponse.json({ error: '不能重設自己的密碼' }, { status: 400 })
  }

  const admin = createServiceRoleClient()

  // 4. 確認目標使用者存在
  const { data: targetUser, error: findErr } = await admin
    .from('users')
    .select('id, email, chinese_name, is_active')
    .eq('id', userId)
    .single()
  if (findErr || !targetUser) {
    return NextResponse.json({ error: '找不到使用者' }, { status: 404 })
  }

  // 5. 重設 Auth 密碼
  const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
    password: TEMP_PASSWORD,
  })
  if (authErr) {
    return NextResponse.json(
      { error: '重設密碼失敗：' + authErr.message },
      { status: 500 }
    )
  }

  // 6. 標記 password_changed = false（強制首次改密碼）
  await admin
    .from('users')
    .update({ password_changed: false })
    .eq('id', userId)

  return NextResponse.json({
    success: true,
    message: `${targetUser.chinese_name} 的密碼已重設為 ${TEMP_PASSWORD}`,
  })
}
