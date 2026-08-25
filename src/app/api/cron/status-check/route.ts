import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail, emailTemplateWarning75, emailTemplateLocked90 } from '@/lib/email'
import { sendTelegramToUsers } from '@/lib/telegram'

// 每日排程：檢查所有客戶並根據建檔天數發送對應層級的警示通知
// 層級：
//   30 天：notify_30（通知業務）
//   60 天：notify_60（通知業務 + 課長）
//   75 天：warning（通知業務 + 課長，status → warning）
//   80 天：notify_80（通知業務 + 課長 + Hans）
//   90 天：locked（通知全部，status → locked）
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const today = new Date()
  const results = {
    notify_30: 0, notify_60: 0, warning: 0, notify_80: 0, locked: 0,
    emails_sent: 0, emails_failed: 0,
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://draco-crm.vercel.app'

  // 撈出仍需要追蹤天數的客戶：
  // active_developing / warning / reactivating / negotiating 都要
  // completed / long_term / abandoned / locked 不管（不受 90 天限制）
  const { data: customers } = await supabase
    .from('customers')
    .select('id, company_name, created_date, status, assigned_to, assigned_user:users!assigned_to(id, chinese_name, team, email)')
    .in('status', ['active_developing', 'warning', 'reactivating', 'negotiating'])
    .is('deleted_at', null)

  if (!customers) {
    return NextResponse.json({ message: 'No active customers', results })
  }

  // 撈一次 admin 和各課 manager，避免每筆客戶都查一次
  const { data: allUsers } = await supabase
    .from('users')
    .select('id, role, team, email, chinese_name')
    .eq('is_active', true)
  const admins = allUsers?.filter(u => u.role === 'admin').map(u => u.id) || []
  const adminEmails = allUsers?.filter(u => u.role === 'admin' && u.email).map(u => u.email) || []
  const managersByTeam: Record<string, string[]> = {}
  const managerEmailsByTeam: Record<string, string[]> = {}
  allUsers?.filter(u => u.role === 'manager' || u.role === 'director').forEach(u => {
    if (!managersByTeam[u.team]) managersByTeam[u.team] = []
    managersByTeam[u.team].push(u.id)
    if (u.email) {
      if (!managerEmailsByTeam[u.team]) managerEmailsByTeam[u.team] = []
      managerEmailsByTeam[u.team].push(u.email)
    }
  })

  for (const customer of customers) {
    const elapsed = Math.floor(
      (today.getTime() - new Date(customer.created_date).getTime()) / (1000 * 60 * 60 * 24)
    )
    if (elapsed < 30) continue

    const team = (customer as { assigned_user?: { team?: string } }).assigned_user?.team || ''
    const salesId = customer.assigned_to
    const managerIds = managersByTeam[team] || []

    // 抓這位客戶「本輪倒數開始後」已發過哪些警示事件，避免重複通知
    // 以 created_date 為錨點：客戶被重新指派 → created_date 重設 → 舊紀錄自動失效，新一輪會重新發
    const { data: pastHistory } = await supabase
      .from('customer_history')
      .select('action_type')
      .eq('customer_id', customer.id)
      .in('action_type', ['notify_30', 'notify_60', 'warning', 'notify_80', 'locked'])
      .gte('action_date', `${customer.created_date}T00:00:00Z`)
    const fired = new Set((pastHistory || []).map(h => h.action_type))

    // ===== 90 天：鎖檔 =====
    if (elapsed >= 90 && !fired.has('locked')) {
      await supabase
        .from('customers')
        .update({
          status: 'locked',
          locked_at: today.toISOString(),
          locked_reason: '系統自動鎖檔（超過90天）',
        })
        .eq('id', customer.id)

      await supabase.from('customer_history').insert({
        customer_id: customer.id,
        action_type: 'locked',
        action_by: salesId,
        note: '系統自動鎖檔（超過90天）',
      })

      const recipients = new Set<string>([salesId, ...admins, ...managerIds])
      await notifyAll(supabase, Array.from(recipients), {
        title: '客戶鎖檔通知',
        message: `「${customer.company_name}」已超過 90 天，系統自動鎖檔`,
        link: `/customers/${customer.id}`,
      })

      // 📧 Email 通知：業務 + 課長 + Hans（admin）
      const salesEmail = (customer as { assigned_user?: { email?: string } }).assigned_user?.email
      const salesName = (customer as { assigned_user?: { chinese_name?: string } }).assigned_user?.chinese_name || '業務'
      const lockedEmails: string[] = []
      if (salesEmail) lockedEmails.push(salesEmail)
      lockedEmails.push(...(managerEmailsByTeam[team] || []))
      lockedEmails.push(...adminEmails)
      const uniqueLockedEmails = Array.from(new Set(lockedEmails))
      if (uniqueLockedEmails.length > 0) {
        const tpl = emailTemplateLocked90({
          recipientName: '您',
          salesName,
          companyName: customer.company_name,
          customerId: customer.id,
          appUrl,
        })
        const r = await sendEmail({
          to: uniqueLockedEmails,
          subject: tpl.subject,
          html: tpl.html,
        })
        if (r.ok) results.emails_sent++
        else if (!r.skipped) results.emails_failed++
      }

      // Telegram 推播
      await sendTelegramToUsers(supabase,
        Array.from(new Set([salesId, ...admins, ...managerIds])),
        `🔴 客戶鎖檔通知\n「${customer.company_name}」已超過 90 天，系統自動鎖檔`
      )

      results.locked++
      continue
    }

    // ===== 80 天：緊急警告（業務 + 課長 + Hans） =====
    if (elapsed >= 80 && elapsed < 90 && !fired.has('notify_80')) {
      await supabase.from('customer_history').insert({
        customer_id: customer.id,
        action_type: 'notify_80',
        action_by: salesId,
        note: '系統自動通知：進入第 80 天緊急警告',
      })

      const recipients = new Set<string>([salesId, ...admins, ...managerIds])
      await notifyAll(supabase, Array.from(recipients), {
        title: '🔴 緊急警告（第 80 天）',
        message: `「${customer.company_name}」剩 10 天就鎖檔，請立即處理`,
        link: `/customers/${customer.id}`,
      })
      results.notify_80++
    }

    // ===== 75 天：黃燈警示（業務 + 課長） =====
    // 狀態改為 warning，但若是 negotiating 則保留不覆蓋
    if (elapsed >= 75 && elapsed < 90 && !fired.has('warning')) {
      if (customer.status === 'active_developing' || customer.status === 'reactivating') {
        await supabase
          .from('customers')
          .update({ status: 'warning' })
          .eq('id', customer.id)
      }

      await supabase.from('customer_history').insert({
        customer_id: customer.id,
        action_type: 'warning',
        action_by: salesId,
        note: '系統自動標記黃燈警示（第 75 天）',
      })

      const recipients = new Set<string>([salesId, ...managerIds])
      await notifyAll(supabase, Array.from(recipients), {
        title: '🟠 黃燈警示（第 75 天）',
        message: `「${customer.company_name}」已進入第 75 天，請加速開發`,
        link: `/customers/${customer.id}`,
      })

      // 📧 Email 通知：只寄給負責業務
      const salesEmail = (customer as { assigned_user?: { email?: string } }).assigned_user?.email
      const salesName = (customer as { assigned_user?: { chinese_name?: string } }).assigned_user?.chinese_name || '您'
      if (salesEmail) {
        const tpl = emailTemplateWarning75({
          salesName,
          companyName: customer.company_name,
          customerId: customer.id,
          appUrl,
        })
        const r = await sendEmail({
          to: salesEmail,
          subject: tpl.subject,
          html: tpl.html,
        })
        if (r.ok) results.emails_sent++
        else if (!r.skipped) results.emails_failed++
      }

      // Telegram 推播
      await sendTelegramToUsers(supabase, [salesId],
        `🟠 黃燈警示（第 75 天）\n「${customer.company_name}」已進入第 75 天，請加速開發`
      )

      results.warning++
    }

    // ===== 60 天：第二次提醒（業務 + 課長） =====
    if (elapsed >= 60 && elapsed < 75 && !fired.has('notify_60')) {
      await supabase.from('customer_history').insert({
        customer_id: customer.id,
        action_type: 'notify_60',
        action_by: salesId,
        note: '系統自動通知：開發已滿 60 天',
      })

      const recipients = new Set<string>([salesId, ...managerIds])
      await notifyAll(supabase, Array.from(recipients), {
        title: '🟡 關注提醒（第 60 天）',
        message: `「${customer.company_name}」已開發 60 天，請留意進度`,
        link: `/customers/${customer.id}`,
      })
      results.notify_60++
    }

    // ===== 30 天：第一次提醒（業務） =====
    if (elapsed >= 30 && elapsed < 60 && !fired.has('notify_30')) {
      await supabase.from('customer_history').insert({
        customer_id: customer.id,
        action_type: 'notify_30',
        action_by: salesId,
        note: '系統自動通知：開發已滿 30 天',
      })

      await notifyAll(supabase, [salesId], {
        title: '🟢 開發提醒（第 30 天）',
        message: `「${customer.company_name}」已開發 30 天，請持續跟進`,
        link: `/customers/${customer.id}`,
      })
      results.notify_30++
    }
  }

  // 跟進待辦到期提醒（到期日 = 今天、未完成）→ 通知建立者
  const todayStr = today.toISOString().slice(0, 10)
  const { data: dueFollowUps } = await supabase
    .from('customer_follow_ups')
    .select('id, content, created_by, customers!customer_id(company_name)')
    .eq('is_done', false)
    .eq('due_date', todayStr)
  let followUpReminders = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const f of (dueFollowUps || []) as any[]) {
    const company = f.customers?.company_name || '客戶'
    await notifyAll(supabase, [f.created_by], {
      title: '🎯 今日待跟進',
      message: `「${company}」：${f.content}`,
      link: '/dashboard',
    })
    followUpReminders++
  }

  return NextResponse.json({
    message: 'Status check completed',
    timestamp: today.toISOString(),
    results: { ...results, follow_up_reminders: followUpReminders },
  })
}

// Helper：批次寄站內通知
// 使用 any 避免 Supabase generic 型別衝突
async function notifyAll(
  supabase: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  userIds: string[],
  { title, message, link }: { title: string; message: string; link: string }
) {
  if (userIds.length === 0) return
  await supabase.from('notifications').insert(
    userIds.map((uid: string) => ({ user_id: uid, title, message, link }))
  )
}
