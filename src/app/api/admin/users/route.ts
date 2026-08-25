import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'
import { randomBytes } from 'crypto'

type Role = 'admin' | 'chairman' | 'director' | 'manager' | 'deputy_manager' | 'sales' | 'finance' | 'hr'
type Team = '業務部' | '業一課' | '業二課' | '專案課' | '電商課' | '物流一部' | '物流二部' | '報關部' | '財管部' | '管理員'

const TEMP_PASSWORD = 'Draco2026'

interface CreateUserBody {
  email: string
  name: string
  chinese_name: string
  role: Role
  team: Team
}

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
    return NextResponse.json({ error: '權限不足（需要 admin 或 chairman 角色）' }, { status: 403 })
  }

  // 2. 解析 + 驗證 body
  let body: CreateUserBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }

  const { email, name, chinese_name, role, team } = body
  if (!email || !name || !chinese_name || !role || !team) {
    return NextResponse.json({ error: '欄位不完整' }, { status: 400 })
  }
  if (!['admin', 'chairman', 'director', 'manager', 'deputy_manager', 'sales', 'finance', 'hr'].includes(role)) {
    return NextResponse.json({ error: '角色無效' }, { status: 400 })
  }
  if (!['業務部', '業一課', '業二課', '專案課', '電商課', '物流一部', '物流二部', '報關部', '財管部', '管理員'].includes(team)) {
    return NextResponse.json({ error: '課別無效' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Email 格式錯誤' }, { status: 400 })
  }

  // 3. 檢查 users 表是否已有相同 email
  const admin = createServiceRoleClient()
  const { data: existing } = await admin
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: '此 email 已存在於使用者列表' }, { status: 409 })
  }

  // 4. 建立 Auth 帳號，直接設定臨時密碼 Draco2026（不寄邀請信）
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: TEMP_PASSWORD,
    email_confirm: true, // 直接標記為已驗證
    user_metadata: { chinese_name, name },
  })
  if (createErr || !created?.user) {
    return NextResponse.json(
      { error: '建立帳號失敗：' + (createErr?.message || '未知錯誤') },
      { status: 500 }
    )
  }

  // 5. 寫入 public.users，id 對齊 auth.users.id
  //    password_changed = false → 首次登入時強制改密碼
  const { error: insertErr } = await admin.from('users').insert({
    id: created.user.id,
    email,
    name,
    chinese_name,
    role,
    team,
    is_active: true,
    password_changed: false,
  })

  if (insertErr) {
    // rollback: 刪除剛建的 Auth user 以免孤兒
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json(
      { error: '寫入使用者資料失敗：' + insertErr.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    user: { id: created.user.id, email, chinese_name },
    message: `帳號已建立，臨時密碼為 ${TEMP_PASSWORD}`,
    tempPassword: TEMP_PASSWORD,
  })
}
