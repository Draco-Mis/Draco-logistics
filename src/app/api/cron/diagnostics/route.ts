import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// 每日 04:00（台灣時間）自動執行系統診斷與修復
// Vercel Cron: UTC 20:00 = 台灣 04:00
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const report: Record<string, unknown> = {}
  const fixes: string[] = []
  const warnings: string[] = []

  // ===================================================
  // 1. 資料表基本健康檢查
  // ===================================================
  const tables = ['customers', 'users', 'customer_history', 'comments', 'notifications', 'transfer_requests', 'customer_contacts']
  const counts: Record<string, number> = {}
  for (const table of tables) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true })
    if (error) {
      warnings.push(`❌ 資料表 ${table} 查詢失敗：${error.message}`)
    } else {
      counts[table] = count ?? 0
    }
  }
  report['table_counts'] = counts

  // ===================================================
  // 2. 孤兒資料修復：customers 的 assigned_to 指向不存在的 user
  // ===================================================
  // 撈所有 user ids，在 JS 比對找孤兒客戶
  const { data: allUserIds } = await supabase.from('users').select('id')
  if (allUserIds) {
    const userIdSet = new Set(allUserIds.map((u: { id: string }) => u.id))
    const orphans: string[] = []
    let from = 0
    while (true) {
      const { data: batch } = await supabase
        .from('customers')
        .select('id, company_name, assigned_to')
        .is('deleted_at', null)
        .range(from, from + 999)
      if (!batch || batch.length === 0) break
      for (const c of batch) {
        if (!userIdSet.has(c.assigned_to)) orphans.push(c.company_name)
      }
      if (batch.length < 1000) break
      from += 1000
    }
    report['orphan_customers'] = orphans.length
    if (orphans.length > 0) {
      warnings.push(`⚠️ 有 ${orphans.length} 筆客戶的負責業務不存在：${orphans.slice(0, 5).join('、')}`)
    }
  }

  // ===================================================
  // 3. 狀態一致性：locked 但沒有 locked_at / locked_reason
  // ===================================================
  const { data: badLocked } = await supabase
    .from('customers')
    .select('id')
    .eq('status', 'locked')
    .is('locked_at', null)
    .is('deleted_at', null)

  if (badLocked && badLocked.length > 0) {
    const now = new Date().toISOString()
    await supabase
      .from('customers')
      .update({ locked_at: now, locked_reason: '系統診斷自動補正' })
      .eq('status', 'locked')
      .is('locked_at', null)
      .is('deleted_at', null)
    fixes.push(`🔧 修正 ${badLocked.length} 筆 locked 客戶缺少 locked_at`)
  }

  // ===================================================
  // 4. 狀態一致性：非 locked 但有殘留的 locked_at
  // ===================================================
  const { data: staleLockedAt } = await supabase
    .from('customers')
    .select('id')
    .neq('status', 'locked')
    .not('locked_at', 'is', null)
    .is('deleted_at', null)

  if (staleLockedAt && staleLockedAt.length > 0) {
    await supabase
      .from('customers')
      .update({ locked_at: null, locked_reason: null })
      .neq('status', 'locked')
      .not('locked_at', 'is', null)
      .is('deleted_at', null)
    fixes.push(`🔧 清除 ${staleLockedAt.length} 筆非鎖檔客戶殘留的 locked_at`)
  }

  // ===================================================
  // 5. Auth 與 users 表一致性：users 有紀錄但 Auth 沒有
  // ===================================================
  const { data: authListResp } = await supabase.auth.admin.listUsers({ perPage: 500 })
  if (authListResp) {
    const authIds = new Set(authListResp.users.map(u => u.id))
    const { data: dbUsers } = await supabase.from('users').select('id, email').eq('is_active', true)
    if (dbUsers) {
      const noAuth = dbUsers.filter(u => !authIds.has(u.id))
      report['users_without_auth'] = noAuth.length
      if (noAuth.length > 0) {
        warnings.push(`⚠️ ${noAuth.length} 位在職使用者沒有 Auth 帳號：${noAuth.map(u => u.email).join('、')}`)
      }
    }
  }

  // ===================================================
  // 6. password_changed 一致性：確保所有在職 user 有此欄位值
  // ===================================================
  const { data: nullPwdChanged } = await supabase
    .from('users')
    .select('id, email')
    .eq('is_active', true)
    .is('password_changed', null)

  if (nullPwdChanged && nullPwdChanged.length > 0) {
    await supabase
      .from('users')
      .update({ password_changed: true })
      .eq('is_active', true)
      .is('password_changed', null)
    fixes.push(`🔧 補正 ${nullPwdChanged.length} 位使用者缺少 password_changed 值`)
  }

  // ===================================================
  // 7. 過期通知清理：超過 90 天的已讀通知自動刪除
  // ===================================================
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
  const { data: oldNotifications } = await supabase
    .from('notifications')
    .select('id')
    .eq('is_read', true)
    .lt('created_at', ninetyDaysAgo.toISOString())

  if (oldNotifications && oldNotifications.length > 0) {
    await supabase
      .from('notifications')
      .delete()
      .eq('is_read', true)
      .lt('created_at', ninetyDaysAgo.toISOString())
    fixes.push(`🧹 清理 ${oldNotifications.length} 筆超過 90 天的已讀通知`)
  }

  // ===================================================
  // 8. 客戶狀態 vs 天數一致性：
  //    status=active_developing 但已超過 75 天 → 可能 cron 漏跑
  // ===================================================
  const day75Ago = new Date()
  day75Ago.setDate(day75Ago.getDate() - 75)
  const { data: shouldBeWarning } = await supabase
    .from('customers')
    .select('id')
    .eq('status', 'active_developing')
    .lt('created_date', day75Ago.toISOString().split('T')[0])
    .is('deleted_at', null)

  if (shouldBeWarning && shouldBeWarning.length > 0) {
    await supabase
      .from('customers')
      .update({ status: 'warning' })
      .eq('status', 'active_developing')
      .lt('created_date', day75Ago.toISOString().split('T')[0])
      .is('deleted_at', null)
    fixes.push(`🔧 修正 ${shouldBeWarning.length} 筆超過 75 天仍為 active_developing → 改為 warning`)
  }

  const day90Ago = new Date()
  day90Ago.setDate(day90Ago.getDate() - 90)
  const { data: shouldBeLocked } = await supabase
    .from('customers')
    .select('id')
    .in('status', ['active_developing', 'warning', 'reactivating'])
    .lt('created_date', day90Ago.toISOString().split('T')[0])
    .is('deleted_at', null)

  if (shouldBeLocked && shouldBeLocked.length > 0) {
    const now = new Date().toISOString()
    await supabase
      .from('customers')
      .update({ status: 'locked', locked_at: now, locked_reason: '系統診斷自動鎖檔（逾 90 天）' })
      .in('status', ['active_developing', 'warning', 'reactivating'])
      .lt('created_date', day90Ago.toISOString().split('T')[0])
      .is('deleted_at', null)
    fixes.push(`🔧 修正 ${shouldBeLocked.length} 筆超過 90 天未鎖檔 → 自動鎖檔`)
  }

  // ===================================================
  // 9. 產生診斷報告通知給所有 admin
  // ===================================================
  const healthScore = warnings.length === 0 && fixes.length === 0 ? '🟢 正常' :
    warnings.length > 0 ? '🟡 有警告' : '🔧 已自動修復'

  const summaryLines = [
    `系統狀態：${healthScore}`,
    `資料表：${Object.entries(counts).map(([k, v]) => `${k}(${v})`).join(' ')}`,
  ]
  if (fixes.length > 0) summaryLines.push(`自動修復：${fixes.length} 項`)
  if (warnings.length > 0) summaryLines.push(`需注意：${warnings.length} 項`)

  const fullMessage = [
    ...summaryLines,
    ...(fixes.length > 0 ? ['', '🔧 自動修復：', ...fixes] : []),
    ...(warnings.length > 0 ? ['', '⚠️ 需注意：', ...warnings] : []),
  ].join('\n')

  // 只通知 admin
  const { data: admins } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .eq('is_active', true)

  if (admins && admins.length > 0) {
    await supabase.from('notifications').insert(
      admins.map(a => ({
        user_id: a.id,
        title: `🩺 每日系統診斷 — ${healthScore}`,
        message: fullMessage.slice(0, 500),
        link: null,
      }))
    )
  }

  report['fixes'] = fixes
  report['warnings'] = warnings
  report['health'] = healthScore
  report['timestamp'] = new Date().toISOString()

  return NextResponse.json(report)
}
