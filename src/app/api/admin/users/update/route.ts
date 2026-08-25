import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'

// 修改使用者的角色 / 課別 / 中英文名 / 在職狀態
// Body: { id, role?, team?, name?, chinese_name?, is_active? }
export async function PATCH(request: Request) {
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
  type Patch = {
    id: string
    role?: 'admin' | 'chairman' | 'director' | 'manager' | 'deputy_manager' | 'sales' | 'finance' | 'hr'
    team?: '業務部' | '業一課' | '業二課' | '專案課' | '電商課' | '物流一部' | '物流二部' | '報關部' | '財管部' | '管理員'
    name?: string
    chinese_name?: string
    is_active?: boolean
  }
  let body: Patch
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }

  const { id, role, team, name, chinese_name, is_active } = body
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  // 3. 驗證可選欄位
  if (role !== undefined && !['admin', 'chairman', 'director', 'manager', 'deputy_manager', 'sales', 'finance', 'hr'].includes(role)) {
    return NextResponse.json({ error: '角色無效' }, { status: 400 })
  }
  if (team !== undefined && !['業務部', '業一課', '業二課', '專案課', '電商課', '物流一部', '物流二部', '報關部', '財管部', '管理員'].includes(team)) {
    return NextResponse.json({ error: '課別無效' }, { status: 400 })
  }

  // 4. 防自刪權保護（針對呼叫者自己）
  if (id === authUser.id) {
    // admin 不能修改自己的角色（其他人的角色可以改）
    if (role !== undefined && role !== callerProfile.role) {
      return NextResponse.json(
        { error: '您不能修改自己的角色，請請其他管理員代為操作' },
        { status: 400 }
      )
    }
    // admin 不能把自己設為離職
    if (is_active === false) {
      return NextResponse.json(
        { error: '您不能把自己設為離職狀態' },
        { status: 400 }
      )
    }
  }

  // 5. 保留至少一位 admin：阻止「將最後一位在職 admin 降級或停用」
  const willDemote = role !== undefined && role !== 'admin'
  const willDeactivate = is_active === false
  if (willDemote || willDeactivate) {
    // 先看目標是不是目前在職的 admin
    const adminSvc = createServiceRoleClient()
    const { data: target } = await adminSvc
      .from('users')
      .select('role, is_active')
      .eq('id', id)
      .single()
    if (target?.role === 'admin' && target.is_active) {
      // 統計目前在職的 admin 數
      const { count, error: countErr } = await adminSvc
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('is_active', true)
      if (countErr) {
        return NextResponse.json(
          { error: '檢查管理員人數失敗：' + countErr.message },
          { status: 500 }
        )
      }
      if ((count ?? 0) <= 1) {
        const reason = willDeactivate ? '停用' : '降級'
        return NextResponse.json(
          { error: `系統必須保留至少一位管理員，無法${reason}最後一位管理員` },
          { status: 400 }
        )
      }
    }
  }

  // 7. 組 updates（只更新有傳進來的欄位）
  const updates: Record<string, unknown> = {}
  if (role !== undefined) updates.role = role
  if (team !== undefined) updates.team = team
  if (name !== undefined) updates.name = name.trim()
  if (chinese_name !== undefined) updates.chinese_name = chinese_name.trim()
  if (is_active !== undefined) {
    updates.is_active = is_active
    // 同步 deactivated_at：停用時記錄時間、啟用時清空
    updates.deactivated_at = is_active === false ? new Date().toISOString() : null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '沒有要更新的欄位' }, { status: 400 })
  }

  // 8. 寫入
  const admin = createServiceRoleClient()
  const { error: updErr } = await admin
    .from('users')
    .update(updates)
    .eq('id', id)

  if (updErr) {
    return NextResponse.json({ error: '更新失敗：' + updErr.message }, { status: 500 })
  }

  // 9. is_active 變動時同步 Supabase Auth 的 ban 狀態：
  //    停用 → ban_duration='876000h'（~100 年）：使現存所有 session / refresh token 立即作廢，且禁止再次登入
  //    啟用 → ban_duration='none'：解除 ban
  if (is_active === false || is_active === true) {
    const banDuration = is_active === false ? '876000h' : 'none'
    const { error: authErr } = await admin.auth.admin.updateUserById(id, {
      ban_duration: banDuration,
    })
    if (authErr) {
      // 不影響使用者狀態更新的主要結果，但回傳警告供前端參考
      return NextResponse.json({
        success: true,
        warning: `users.is_active 已更新，但 Auth ban 同步失敗：${authErr.message}（離職人員的 session 將在下次導航/token 過期時失效）`,
      })
    }
  }

  return NextResponse.json({ success: true })
}
