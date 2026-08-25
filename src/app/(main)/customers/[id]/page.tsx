'use client'

import { useEffect, useState } from 'react'
import { recordRecentView } from '@/lib/use-recent-customers'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { Customer, CustomerHistory, Comment, User, CustomerContact } from '@/types/database'
import { getRemainingDays, formatDate, formatDateTime, getGradeColor, getWarningTier, getTierLabel, getTierColor, getTierTextColor, getTierBgColor, getStatusLabel as getStatusLabelClient, getCustomerCompleteness, cn } from '@/lib/utils'
import { useStockLookup } from '@/lib/use-stock-lookup'
import { useRealtimeStatus } from '@/lib/use-realtime'
import { RealtimeBadge } from '@/components/RealtimeBadge'
import { INDUSTRIES } from '@/lib/constants'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { fireConfetti } from '@/lib/confetti'

interface PendingDeletion {
  id: string
  requested_by: string
  requested_at: string
  reason: string | null
  requested_by_user?: { chinese_name: string | null; name: string } | null
}

interface FollowUp {
  id: string
  content: string
  due_date: string | null
  is_done: boolean
  created_by: string
  created_at: string
  created_by_user?: { chinese_name: string | null; name: string } | null
}

export default function CustomerDetailPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  const toast = useToast()
  const confirm = useConfirm()

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [history, setHistory] = useState<CustomerHistory[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [contacts, setContacts] = useState<CustomerContact[]>([])
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null)
  const [deletionBusy, setDeletionBusy] = useState(false)
  const [showDeleteReq, setShowDeleteReq] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [newFollowUp, setNewFollowUp] = useState('')
  const [newFollowUpDue, setNewFollowUpDue] = useState('')
  const [addingFollowUp, setAddingFollowUp] = useState(false)
  const [priorityNoteInput, setPriorityNoteInput] = useState('')
  const [prioritySaving, setPrioritySaving] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [submittingComment, setSubmittingComment] = useState(false)
  const [claimNote, setClaimNote] = useState('')
  const [showClaimForm, setShowClaimForm] = useState(false)
  const [submittingClaim, setSubmittingClaim] = useState(false)

  // Editable fields
  const [editing, setEditing] = useState(false)
  const [editCompanyName, setEditCompanyName] = useState('')
  const [editCompanyCodeType, setEditCompanyCodeType] = useState('')
  const [editCompanyCode, setEditCompanyCode] = useState('')
  const [editIndustry, setEditIndustry] = useState('')
  const [lastContactDate, setLastContactDate] = useState('')
  const [grade, setGrade] = useState('')
  const [assignedTo, setAssignedTo] = useState('')

  // 編輯時自動查上市櫃代號
  const { matches: stockMatches } = useStockLookup(editing ? editCompanyName : '')
  const [allUsers, setAllUsers] = useState<User[]>([])

  // 狀態變更對話框
  const [pendingChange, setPendingChange] = useState<{
    status: 'active_developing' | 'negotiating' | 'completed' | 'long_term' | 'abandoned'
    actionType: 'mark_developing' | 'mark_negotiating' | 'mark_completed' | 'mark_long_term' | 'mark_abandoned'
    label: string
  } | null>(null)
  const [statusSaving, setStatusSaving] = useState(false)
  const [statusError, setStatusError] = useState('')
  const [statusSuccess, setStatusSuccess] = useState('')

  useEffect(() => {
    fetchAll()
  }, [id])

  // Realtime：訂閱此客戶的相關變動（customers / history / comments / contacts）
  const idStr = String(id ?? '')
  const { status: rtStatus, lastUpdated, markUpdated } = useRealtimeStatus({
    channelName: `customer-${idStr}`,
    tables: [
      { table: 'customers', filter: `id=eq.${idStr}` },
      { table: 'customer_history', filter: `customer_id=eq.${idStr}` },
      { table: 'comments', filter: `customer_id=eq.${idStr}` },
      { table: 'customer_contacts', filter: `customer_id=eq.${idStr}` },
    ],
    onChange: () => fetchAll(),
    enabled: !!idStr,
  })

  async function fetchAll() {
    const [customerRes, historyRes, commentsRes, contactsRes, deletionRes, followUpsRes] = await Promise.all([
      supabase
        .from('customers')
        .select('*, assigned_user:users!assigned_to(*), created_by_user:users!created_by(*)')
        .eq('id', id)
        .single(),
      supabase
        .from('customer_history')
        .select('*, action_by_user:users!action_by(*), from_user_data:users!from_user(*), to_user_data:users!to_user(*)')
        .eq('customer_id', id)
        .order('action_date', { ascending: false }),
      supabase
        .from('comments')
        .select('*, user:users!user_id(*)')
        .eq('customer_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('customer_contacts')
        .select('*')
        .eq('customer_id', id)
        .order('created_at', { ascending: true }),
      supabase
        .from('customer_deletion_requests')
        .select('*, requested_by_user:users!requested_by(chinese_name, name)')
        .eq('customer_id', id)
        .eq('status', 'pending')
        .maybeSingle(),
      supabase
        .from('customer_follow_ups')
        .select('*, created_by_user:users!created_by(chinese_name, name)')
        .eq('customer_id', id)
        .order('is_done', { ascending: true })
        .order('due_date', { ascending: true, nullsFirst: false }),
    ])

    if (customerRes.data) {
      setCustomer(customerRes.data)
      // 紀錄到 localStorage，Dashboard「最近查看的客戶」會用
      recordRecentView(customerRes.data.id, customerRes.data.company_name)
      setEditCompanyName(customerRes.data.company_name)
      setEditCompanyCodeType(customerRes.data.company_code_type || '')
      setEditCompanyCode(customerRes.data.company_code || '')
      setEditIndustry(customerRes.data.industry || '')
      setLastContactDate(customerRes.data.last_contact_date || '')
      setGrade(customerRes.data.grade)
      setAssignedTo(customerRes.data.assigned_to)
      setPriorityNoteInput(customerRes.data.priority_note || '')
    }
    if (historyRes.data) setHistory(historyRes.data)
    if (commentsRes.data) setComments(commentsRes.data)
    if (contactsRes.data) setContacts(contactsRes.data)
    setPendingDeletion((deletionRes.data as PendingDeletion) ?? null)
    setFollowUps((followUpsRes.data as FollowUp[]) ?? [])
    setLoading(false)
    markUpdated()
  }

  // 載入所有在職業務（給 admin/manager 的指派下拉選單）
  useEffect(() => {
    if (user?.role === 'admin' || user?.role === 'chairman' || user?.role === 'director' || user?.role === 'manager') {
      supabase
        .from('users')
        .select('*')
        .eq('is_active', true)
        .order('name')
        .then(({ data }) => { if (data) setAllUsers(data) })
    }
  }, [user])

  // 對「此客戶」有管理權限：
  //   admin / chairman / director → 一律可
  //   manager → 僅當自己的課別 == 該客戶負責業務的課別
  const isSuperRole = !!user && !!customer && (
    user.role === 'admin' ||
    user.role === 'chairman' ||
    user.role === 'director' ||
    (user.role === 'manager' && !!customer.assigned_user?.team && user.team === customer.assigned_user.team)
  )
  const isOwner = user && customer && customer.assigned_to === user.id

  const canEdit = user && customer && (
    isSuperRole ||
    (isOwner && customer.status !== 'locked')
  )

  // 聯絡人 / 歷史軌跡 / 留言 的檢視權限
  // - admin / chairman / director：全部可看
  // - manager：只看自己同課別負責的客戶
  // - 其他：只看自己負責的客戶
  const canViewDetails = !!user && !!customer && (
    user.role === 'admin' ||
    user.role === 'chairman' ||
    user.role === 'director' ||
    (user.role === 'manager' && !!customer.assigned_user?.team && user.team === customer.assigned_user.team) ||
    customer.assigned_to === user.id
  )

  // 鎖檔客戶：非主管（無法直接解鎖者）皆可送申請 —
  // 原負責業務→申請解鎖續辦、其他業務→申請認領，均需填原因、送主管審核。
  const canClaim = user && customer &&
    customer.status === 'locked' &&
    !isSuperRole
  const isOwnerClaim = !!user && !!customer && customer.assigned_to === user.id

  const canUnlock = user && customer &&
    customer.status === 'locked' &&
    isSuperRole

  // 負責業務可以把狀態改為：洽談中 / 已成交 / 未成交 / 改回開發中
  // （admin/chairman/manager 也都可以）
  const canChangeStatus = user && customer &&
    customer.status !== 'locked' &&
    (isSuperRole || isOwner)

  // 只有 admin / chairman / manager 可以設為「長期合作」
  const canSetLongTerm = user && customer &&
    customer.status !== 'locked' &&
    isSuperRole

  // ===================================================
  // 標記狀態：點按鈕時先設定 pending，顯示應用內對話框
  // ===================================================
  function requestStatusChange(
    newStatus: 'active_developing' | 'negotiating' | 'completed' | 'long_term' | 'abandoned',
    actionType: 'mark_developing' | 'mark_negotiating' | 'mark_completed' | 'mark_long_term' | 'mark_abandoned',
  ) {
    if (!customer || !user) return
    if (customer.status === newStatus) return
    const statusLabels: Record<typeof newStatus, string> = {
      active_developing: '開發中',
      negotiating: '洽談中',
      completed: '已成交',
      long_term: '長期合作',
      abandoned: '未成交',
    }
    setStatusError('')
    setStatusSuccess('')
    setPendingChange({ status: newStatus, actionType, label: statusLabels[newStatus] })
  }

  async function confirmStatusChange() {
    if (!pendingChange || !customer || !user) return
    setStatusSaving(true)
    setStatusError('')

    const updates: Record<string, unknown> = { status: pendingChange.status }
    if (customer.status === 'locked') {
      updates.locked_at = null
      updates.locked_reason = null
    }

    const { error } = await supabase
      .from('customers')
      .update(updates)
      .eq('id', customer.id)

    if (error) {
      setStatusError('狀態變更失敗：' + error.message)
      setStatusSaving(false)
      return
    }

    const { error: histErr } = await supabase.from('customer_history').insert({
      customer_id: customer.id,
      action_type: pendingChange.actionType,
      action_by: user.id,
      note: `${user.chinese_name} 將狀態由「${getStatusLabelClient(customer.status)}」改為「${pendingChange.label}」`,
    })
    if (histErr) {
      // 狀態已改成功，但歷史紀錄失敗 — 顯示警告但不 rollback
      console.warn('history insert failed:', histErr)
    }

    setStatusSuccess(`✅ 狀態已改為「${pendingChange.label}」`)
    // 成交慶祝：撒彩帶 🎉
    if (pendingChange.status === 'completed') fireConfetti()
    setStatusSaving(false)
    setPendingChange(null)
    await fetchAll()
    // 3 秒後清除成功訊息
    setTimeout(() => setStatusSuccess(''), 3000)
  }

  // 一鍵把「最後互動日期」設為今天（免進編輯模式）
  const [loggingContact, setLoggingContact] = useState(false)
  async function logContactToday() {
    if (!customer) return
    setLoggingContact(true)
    const prev = customer.last_contact_date
    const cid = customer.id
    const today = new Date().toISOString().split('T')[0]
    const { error } = await supabase.from('customers').update({ last_contact_date: today }).eq('id', cid)
    setLoggingContact(false)
    if (error) { toast.error('更新失敗：' + error.message); return }
    toast.success('已記錄今日聯絡', {
      actionLabel: '復原',
      onAction: async () => {
        await supabase.from('customers').update({ last_contact_date: prev }).eq('id', cid)
        fetchAll()
      },
    })
    fetchAll()
  }

  // 主管推薦優先開發
  async function setPriority(on: boolean) {
    if (!customer || !user) return
    setPrioritySaving(true)
    const patch = on
      ? { priority_flag: true, priority_note: priorityNoteInput.trim() || null, priority_by: user.id, priority_at: new Date().toISOString() }
      : { priority_flag: false, priority_note: null, priority_by: null, priority_at: null }
    const { error } = await supabase.from('customers').update(patch).eq('id', customer.id)
    if (error) { setPrioritySaving(false); toast.error('設定失敗：' + error.message); return }
    // 通知負責業務（開啟且不是自己）
    if (on && customer.assigned_to && customer.assigned_to !== user.id) {
      await supabase.from('notifications').insert({
        user_id: customer.assigned_to,
        title: '⭐ 主管建議優先開發',
        message: `${user.chinese_name} 建議優先開發「${customer.company_name}」${priorityNoteInput.trim() ? '：' + priorityNoteInput.trim() : ''}`,
        link: `/customers/${customer.id}`,
      })
    }
    setPrioritySaving(false)
    toast.success(on ? '已標記為優先開發' : '已取消優先標記')
    fetchAll()
  }

  // 跟進待辦
  async function addFollowUp() {
    if (!user || !customer || !newFollowUp.trim()) return
    setAddingFollowUp(true)
    const { error } = await supabase.from('customer_follow_ups').insert({
      customer_id: customer.id,
      content: newFollowUp.trim(),
      due_date: newFollowUpDue || null,
      created_by: user.id,
    })
    setAddingFollowUp(false)
    if (error) { toast.error('新增待辦失敗：' + error.message); return }
    setNewFollowUp(''); setNewFollowUpDue('')
    fetchAll()
  }

  async function toggleFollowUp(f: FollowUp) {
    const { error } = await supabase.from('customer_follow_ups')
      .update({ is_done: !f.is_done, completed_at: !f.is_done ? new Date().toISOString() : null })
      .eq('id', f.id)
    if (error) { toast.error('更新失敗：' + error.message); return }
    fetchAll()
  }

  async function deleteFollowUp(f: FollowUp) {
    const { error } = await supabase.from('customer_follow_ups').delete().eq('id', f.id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    fetchAll()
  }

  async function handleSave() {
    if (!customer || !user) return

    const isReassigning = assignedTo && assignedTo !== customer.assigned_to
    const canReassign = user.role === 'admin' || user.role === 'chairman' || user.role === 'director' || user.role === 'manager'

    if (!editCompanyName.trim()) {
      toast.error('公司名稱不能為空')
      return
    }

    const updates: Record<string, unknown> = {
      company_name: editCompanyName.trim(),
      company_code_type: editCompanyCodeType || null,
      company_code: editCompanyCode || null,
      industry: editIndustry || null,
      last_contact_date: lastContactDate || null,
      grade,
    }
    if (isReassigning && canReassign) {
      updates.assigned_to = assignedTo
      // 重新指派 → 重設 90 天倒數、狀態回到「重新開發」、清掉鎖檔
      updates.created_date = new Date().toISOString().split('T')[0]
      updates.status = 'reactivating'
      updates.locked_at = null
      updates.locked_reason = null
    }

    const { error } = await supabase
      .from('customers')
      .update(updates)
      .eq('id', customer.id)

    if (error) {
      toast.error('儲存失敗：' + error.message)
      return
    }

    // 若有重新指派 → 寫歷史 + 發通知
    if (isReassigning && canReassign) {
      const newAssignee = allUsers.find(u => u.id === assignedTo)
      const oldAssigneeName = customer.assigned_user?.chinese_name || '未指派'
      const newAssigneeName = newAssignee?.chinese_name || '未知'

      await supabase.from('customer_history').insert({
        customer_id: customer.id,
        action_type: 'transfer_approved',
        action_by: user.id,
        from_user: customer.assigned_to,
        to_user: assignedTo,
        note: `${user.chinese_name} 將客戶指派給 ${newAssigneeName}`,
      })

      // 重設 90 天倒數的稽核軌跡
      await supabase.from('customer_history').insert({
        customer_id: customer.id,
        action_type: 'reactivated',
        action_by: user.id,
        note: '重新指派 → 90 天倒數重設',
      })

      // 通知新業務
      await supabase.from('notifications').insert({
        user_id: assignedTo,
        title: '新指派客戶',
        message: `「${customer.company_name}」已指派給你（由 ${user.chinese_name} 操作）`,
        link: `/customers/${customer.id}`,
      })

      // 通知原業務（若存在且不是自己）
      if (customer.assigned_to && customer.assigned_to !== user.id && customer.assigned_to !== assignedTo) {
        await supabase.from('notifications').insert({
          user_id: customer.assigned_to,
          title: '客戶已轉移',
          message: `「${customer.company_name}」已由 ${user.chinese_name} 轉指派給 ${newAssigneeName}`,
          link: `/customers/${customer.id}`,
        })
      }
    }

    setEditing(false)
    fetchAll()
  }

  async function handleAddComment() {
    if (!newComment.trim() || !user || !customer) return
    setSubmittingComment(true)

    const commentText = newComment.trim()

    await supabase.from('comments').insert({
      customer_id: id,
      user_id: user.id,
      content: commentText,
    })

    // 通知負責業務（如果留言者不是負責業務）
    const notifyIds = new Set<string>()
    if (customer.assigned_to !== user.id) {
      notifyIds.add(customer.assigned_to)
    }
    // 通知之前在此客戶留過言的人（不含自己、不含負責業務已加）
    const { data: prevCommenters } = await supabase
      .from('comments')
      .select('user_id')
      .eq('customer_id', id)
      .neq('user_id', user.id)
    if (prevCommenters) {
      prevCommenters.forEach(c => notifyIds.add(c.user_id))
    }
    notifyIds.delete(user.id) // 確保不通知自己

    if (notifyIds.size > 0) {
      const preview = commentText.length > 50 ? commentText.slice(0, 50) + '...' : commentText
      await supabase.from('notifications').insert(
        Array.from(notifyIds).map(uid => ({
          user_id: uid,
          title: `💬 ${user.chinese_name} 在「${customer.company_name}」留言`,
          message: preview,
          link: `/customers/${customer.id}`,
        }))
      )
    }

    setNewComment('')
    setSubmittingComment(false)
    fetchAll()
  }

  async function handleClaim() {
    if (!user || !customer) return
    const reason = claimNote.trim()
    if (!reason) { toast.error('請填寫認領原因'); return }
    setSubmittingClaim(true)

    await supabase.from('transfer_requests').insert({
      customer_id: customer.id,
      requested_by: user.id,
      note: reason,
    })

    // Add history
    await supabase.from('customer_history').insert({
      customer_id: customer.id,
      action_type: 'transfer_requested',
      action_by: user.id,
      from_user: customer.assigned_to,
      to_user: user.id,
      note: reason,
    })

    // Notify admin & managers
    const { data: admins } = await supabase
      .from('users')
      .select('id')
      .in('role', ['admin', 'director', 'manager'])

    if (admins) {
      await supabase.from('notifications').insert(
        admins.map((a) => ({
          user_id: a.id,
          title: '認領申請',
          message: `${user.chinese_name} 申請認領「${customer.company_name}」`,
          link: `/transfers`,
        }))
      )
    }

    setShowClaimForm(false)
    setClaimNote('')
    setSubmittingClaim(false)
    toast.success('認領申請已送出，等待審核')
  }

  // 主管解鎖並展延 90 天：狀態→重新開發、重算 90 天倒數、通知業務
  async function handleUnlock() {
    if (!user || !customer) return
    const ok = await confirm({
      title: '解鎖並展延 90 天',
      message: `確認解鎖「${customer.company_name}」並展延 90 天？\n\n• 狀態改為「重新開發」\n• 90 天倒數重新計算（從今天起）\n• 由 ${customer.assigned_user?.chinese_name} 繼續開發`,
      confirmLabel: '解鎖・展延 90 天',
    })
    if (!ok) return

    const today = new Date().toISOString().split('T')[0]
    const { error } = await supabase
      .from('customers')
      .update({
        status: 'reactivating',
        locked_at: null,
        locked_reason: null,
        created_date: today,
      })
      .eq('id', customer.id)

    if (error) {
      toast.error('解鎖失敗：' + error.message)
      return
    }

    await supabase.from('customer_history').insert({
      customer_id: customer.id,
      action_type: 'reactivated',
      action_by: user.id,
      note: `${user.chinese_name} 解鎖並展延 90 天`,
    })

    // 通知原負責業務
    if (customer.assigned_to && customer.assigned_to !== user.id) {
      await supabase.from('notifications').insert({
        user_id: customer.assigned_to,
        title: '客戶已展延',
        message: `「${customer.company_name}」已由 ${user.chinese_name} 解鎖並展延 90 天，狀態改為「重新開發」，請繼續跟進`,
        link: `/customers/${customer.id}`,
      })
    }

    toast.success('已解鎖並展延 90 天')
    fetchAll()
  }

  // 管理員軟刪除：透過 RPC 繞過 RLS RETURNING 限制
  async function handleDelete() {
    if (!user || !customer) return
    if (user.role !== 'admin') return
    const first = await confirm({
      title: `刪除客戶「${customer.company_name}」`,
      message:
        `刪除後：\n` +
        `• 此客戶會從所有列表、報表、cron 中消失\n` +
        `• 聯絡人、留言、歷史軌跡會一併隱藏\n` +
        `• 軟刪除（資料庫仍保留，需要時可請工程師還原）`,
      danger: true,
      confirmLabel: '繼續刪除',
    })
    if (!first) return
    const second = await confirm({
      title: '最後確認',
      message: `真的要刪除「${customer.company_name}」？此動作會立即從介面移除該客戶。`,
      danger: true,
      confirmLabel: '確定刪除',
    })
    if (!second) return

    const { error } = await supabase.rpc('admin_soft_delete_customer', { p_id: customer.id })

    if (error) {
      toast.error('刪除失敗：' + error.message)
      return
    }

    const cid = customer.id
    const cname = customer.company_name
    router.push('/customers')
    // 誤刪救回：復原 = 把 deleted_at 設回 null
    toast.success(`已刪除「${cname}」`, {
      actionLabel: '復原',
      onAction: async () => {
        const { error: e } = await supabase.from('customers').update({ deleted_at: null }).eq('id', cid)
        if (e) toast.error('復原失敗：' + e.message)
        else toast.success(`已復原「${cname}」`)
      },
    })
  }

  // 非 admin：申請刪除 → 填理由 → 送課長審核
  function openDeleteRequest() {
    setDeleteReason('')
    setShowDeleteReq(true)
  }
  async function submitDeletion() {
    if (!user || !customer) return
    const reason = deleteReason.trim()
    if (!reason) { toast.error('請填寫刪除理由'); return }
    setDeletionBusy(true)
    const { error } = await supabase.rpc('request_customer_deletion', { p_customer_id: customer.id, p_reason: reason })
    setDeletionBusy(false)
    if (error) { toast.error('申請失敗：' + error.message); return }
    setShowDeleteReq(false)
    toast.success('已送出刪除申請，等待課長審核')
    fetchAll()
  }

  // 課長 / 主管：審核刪除申請
  async function reviewDeletion(approved: boolean) {
    if (!pendingDeletion) return
    const ok = await confirm({
      title: approved ? '核准刪除' : '拒絕刪除',
      message: approved
        ? `核准後「${customer?.company_name}」會立即從名單移除（軟刪除，資料庫仍保留）。`
        : `拒絕後此客戶維持不變。`,
      danger: approved,
      confirmLabel: approved ? '核准並刪除' : '拒絕申請',
    })
    if (!ok) return
    setDeletionBusy(true)
    const { error } = await supabase.rpc('review_customer_deletion', { p_request_id: pendingDeletion.id, p_approved: approved })
    setDeletionBusy(false)
    if (error) { toast.error('審核失敗：' + error.message); return }
    if (approved) { toast.success('已核准，客戶已移除'); router.push('/customers') }
    else { toast.success('已拒絕刪除申請'); fetchAll() }
  }

  if (loading) {
    return (
      <div className="p-4 flex justify-center items-center min-h-[50vh]">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="p-4 text-center py-12 text-gray-400">
        <p>找不到此客戶</p>
      </div>
    )
  }

  const remaining = getRemainingDays(customer.created_date, customer.status)
  const tier = getWarningTier(customer.created_date, customer.status)

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex justify-end">
        <RealtimeBadge status={rtStatus} lastUpdated={lastUpdated} onRefresh={fetchAll} />
      </div>
      {/* Header */}
      <div className="card">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                type="text"
                value={editCompanyName}
                onChange={(e) => setEditCompanyName(e.target.value)}
                className="input-field text-xl font-bold mb-1"
                required
              />
            ) : (
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">{customer.company_name}</h1>
            )}
            {editing ? (
              <>
                <div className="flex gap-2 mt-1">
                  <select
                    value={editCompanyCodeType}
                    onChange={(e) => setEditCompanyCodeType(e.target.value)}
                    className="input-field text-sm w-28"
                  >
                    <option value="">類型</option>
                    <option value="上市">上市</option>
                    <option value="上櫃">上櫃</option>
                    <option value="興櫃">興櫃</option>
                    <option value="一般公司">一般公司</option>
                  </select>
                  <input
                    type="text"
                    value={editCompanyCode}
                    onChange={(e) => setEditCompanyCode(e.target.value)}
                    className="input-field text-sm w-28"
                    placeholder="代號"
                  />
                  <select
                    value={editIndustry}
                    onChange={(e) => setEditIndustry(e.target.value)}
                    className="input-field text-sm w-28"
                  >
                    <option value="">產業</option>
                    {INDUSTRIES.map((ind) => (
                      <option key={ind} value={ind}>{ind}</option>
                    ))}
                  </select>
                </div>
                {stockMatches.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <span className="text-xs text-blue-600">🔍</span>
                    {stockMatches.slice(0, 5).map(m => (
                      <button
                        key={m.code}
                        type="button"
                        onClick={() => { setEditCompanyCodeType(m.type); setEditCompanyCode(m.code) }}
                        className={cn(
                          'px-2 py-0.5 rounded text-xs border transition',
                          editCompanyCode === m.code
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-100'
                        )}
                      >
                        {m.code} {m.shortName || m.name}（{m.type}）
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-gray-500">
                {customer.company_code && (
                  <span>{customer.company_code_type} {customer.company_code}</span>
                )}
                {customer.industry && (
                  <span className="badge bg-gray-100 text-gray-700">{customer.industry}</span>
                )}
                <span>建檔：{formatDate(customer.created_date)}</span>
              </div>
            )}
          </div>
          <span className={cn('badge text-sm', getTierColor(tier))}>
            {getTierLabel(tier)}
          </span>
        </div>

        {/* Remaining Days / Status Display */}
        <div className={cn('rounded-lg p-4 text-center mb-3', getTierBgColor(tier))}>
          {customer.status === 'completed' ? (
            <>
              <p className="text-sm text-gray-600 mb-1">成交狀態</p>
              <p className={cn('text-4xl font-bold', getTierTextColor(tier))}>🏆 已成交</p>
            </>
          ) : customer.status === 'long_term' ? (
            <>
              <p className="text-sm text-gray-600 mb-1">合作狀態</p>
              <p className={cn('text-4xl font-bold', getTierTextColor(tier))}>⭐ 長期合作</p>
            </>
          ) : customer.status === 'abandoned' ? (
            <>
              <p className="text-sm text-gray-600 mb-1">成交狀態</p>
              <p className={cn('text-4xl font-bold', getTierTextColor(tier))}>未成交</p>
            </>
          ) : customer.status === 'locked' ? (
            <>
              <p className="text-sm text-gray-600 mb-1">狀態</p>
              <p className={cn('text-4xl font-bold', getTierTextColor(tier))}>已鎖檔</p>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-1">剩餘開發天數</p>
              <p className={cn('text-4xl font-bold tabular-nums', getTierTextColor(tier))}>
                {remaining} 天
              </p>
            </>
          )}
        </div>

        {/* 鎖檔提示：引導主管用正確的「展延」動作，避免誤用備註 */}
        {customer.status === 'locked' && (
          <div className="mb-3 p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2">
            <span className="text-lg shrink-0">⏳</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800">此客戶已鎖檔（逾 90 天）</p>
              {canUnlock ? (
                <>
                  <p className="text-xs text-amber-700/90 mt-0.5 leading-relaxed">
                    要讓業務繼續開發，請按下方按鈕解鎖並展延。<b>在備註寫「同意展延」不會改變狀態。</b>
                  </p>
                  <button onClick={handleUnlock} className="btn-primary text-xs mt-2">🔓 解鎖・展延 90 天</button>
                </>
              ) : (
                <p className="text-xs text-amber-700/90 mt-0.5 leading-relaxed">
                  如需繼續開發，請按下方「{isOwnerClaim ? '申請解鎖續辦' : '申請認領'}」填原因送主管審核，或聯繫主管直接展延。
                </p>
              )}
            </div>
          </div>
        )}

        {/* Deal Status Actions */}
        <StatusActionsBar
          customer={customer}
          canChangeStatus={canChangeStatus}
          canSetLongTerm={canSetLongTerm}
          onChange={(newStatus, actionType) => requestStatusChange(newStatus, actionType)}
        />

        {/* 成功提示 */}
        {statusSuccess && (
          <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
            {statusSuccess}
          </div>
        )}

        {/* 狀態變更確認對話框（應用內，不用瀏覽器 confirm） */}
        {pendingChange && (
          <div
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => !statusSaving && setPendingChange(null)}
          >
            <div
              className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-900 mb-2">確認狀態變更</h3>
              <p className="text-sm text-gray-600 mb-4">
                將「<strong>{customer.company_name}</strong>」狀態改為「<strong>{pendingChange.label}</strong>」？
              </p>
              {statusError && (
                <p className="text-sm text-red-600 mb-3">{statusError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={confirmStatusChange}
                  disabled={statusSaving}
                  className="btn-primary flex-1 text-sm"
                >
                  {statusSaving ? '處理中...' : '確認'}
                </button>
                <button
                  onClick={() => setPendingChange(null)}
                  disabled={statusSaving}
                  className="btn-secondary text-sm"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-gray-500">負責業務</p>
            {editing && isSuperRole ? (
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="input-field text-sm mt-1"
              >
                {allUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.chinese_name}（{u.name}）· {u.team}
                  </option>
                ))}
              </select>
            ) : (
              <p className="font-medium">{customer.assigned_user?.chinese_name}（{customer.assigned_user?.name}）</p>
            )}
          </div>
          <div>
            <p className="text-gray-500">客戶等級</p>
            {editing ? (
              <>
                <select value={grade} onChange={(e) => setGrade(e.target.value)} className="input-field text-sm mt-1">
                  <option value="A">A 級（月均利潤 10 萬以上）</option>
                  <option value="B">B 級（月均利潤 3–10 萬）</option>
                  <option value="C">C 級（月均利潤 3 萬以下）</option>
                </select>
              </>
            ) : (
              <p className="font-medium mt-1">
                <span className={cn('inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold', getGradeColor(customer.grade))}>
                  {customer.grade || '—'}
                </span>
                <span className="ml-2 text-gray-600 text-sm">
                  {customer.grade === 'A' && '月均利潤 10 萬以上'}
                  {customer.grade === 'B' && '月均利潤 3–10 萬'}
                  {customer.grade === 'C' && '月均利潤 3 萬以下'}
                </span>
              </p>
            )}
          </div>
          <div>
            <p className="text-gray-500">建檔人</p>
            <p className="font-medium">{customer.created_by_user?.chinese_name}</p>
          </div>
          <div>
            <p className="text-gray-500">最後互動日期</p>
            {editing ? (
              <input
                type="date"
                value={lastContactDate}
                onChange={(e) => setLastContactDate(e.target.value)}
                className="input-field text-sm mt-1"
              />
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium">{customer.last_contact_date ? formatDate(customer.last_contact_date) : '尚未記錄'}</p>
                {canEdit && (
                  <button
                    onClick={logContactToday}
                    disabled={loggingContact}
                    className="text-xs text-accent-600 hover:text-accent-700 font-medium inline-flex items-center gap-1 rounded-lg px-2 py-0.5 hover:bg-accent-50 transition disabled:opacity-50"
                    title="把最後互動日期設為今天"
                  >
                    🕐 {loggingContact ? '記錄中…' : '紀錄今日聯絡'}
                  </button>
                )}
              </div>
            )}
          </div>
          {customer.locked_at && (
            <>
              <div>
                <p className="text-gray-500">鎖檔時間</p>
                <p className="font-medium">{formatDateTime(customer.locked_at)}</p>
              </div>
              <div>
                <p className="text-gray-500">鎖檔原因</p>
                <p className="font-medium">{customer.locked_reason || '系統自動鎖檔'}</p>
              </div>
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className="mt-4 flex gap-2">
          {canEdit && !editing && (
            <button onClick={() => setEditing(true)} className="btn-primary text-sm">
              編輯
            </button>
          )}
          {editing && (
            <>
              <button onClick={handleSave} className="btn-primary text-sm">儲存</button>
              <button onClick={() => { setEditing(false); setEditCompanyName(customer.company_name); setEditCompanyCodeType(customer.company_code_type || ''); setEditCompanyCode(customer.company_code || ''); setEditIndustry(customer.industry || ''); setGrade(customer.grade); setLastContactDate(customer.last_contact_date || ''); setAssignedTo(customer.assigned_to) }} className="btn-secondary text-sm">取消</button>
            </>
          )}
          {canClaim && !showClaimForm && (
            <button onClick={() => setShowClaimForm(true)} className="btn-primary text-sm">
              {isOwnerClaim ? '申請解鎖續辦' : '申請認領'}
            </button>
          )}
          {/* 解鎖・展延按鈕已移到上方鎖檔提示框，避免重複 */}
          {/* 刪除：admin 直接刪；其他可編輯者送審；有待審申請時這裡不重複顯示 */}
          {!editing && !pendingDeletion && user?.role === 'admin' && (
            <button onClick={handleDelete} className="btn-danger text-sm ml-auto">
              🗑️ 刪除客戶
            </button>
          )}
          {!editing && !pendingDeletion && user?.role !== 'admin' && canEdit && (
            <button onClick={openDeleteRequest} disabled={deletionBusy} className="btn-danger text-sm ml-auto disabled:opacity-50">
              🗑️ 申請刪除
            </button>
          )}
        </div>

        {/* 待刪除審核橫幅 */}
        {pendingDeletion && (
          <div className="mt-4 p-4 rounded-xl bg-red-50 border border-red-200">
            <div className="flex items-start gap-2">
              <span className="text-lg shrink-0">🗑️</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-800">此客戶有刪除申請，待審核</p>
                <p className="text-xs text-red-600/90 mt-0.5">
                  申請人：{pendingDeletion.requested_by_user?.chinese_name || pendingDeletion.requested_by_user?.name || '—'}
                  {' · '}{formatDateTime(pendingDeletion.requested_at)}
                  {pendingDeletion.reason ? ` · 原因：${pendingDeletion.reason}` : ''}
                </p>
                {isSuperRole ? (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => reviewDeletion(true)} disabled={deletionBusy} className="btn-danger text-sm disabled:opacity-50">核准並刪除</button>
                    <button onClick={() => reviewDeletion(false)} disabled={deletionBusy} className="btn-secondary text-sm disabled:opacity-50">拒絕</button>
                  </div>
                ) : (
                  <p className="text-xs text-red-500/80 mt-2">等待課長審核中…</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 申請刪除・填理由視窗 */}
        {showDeleteReq && (
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-fade-in"
            onClick={() => !deletionBusy && setShowDeleteReq(false)}
          >
            <div className="card w-full max-w-sm animate-scale-in" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold text-gray-900 tracking-tight flex items-center gap-2">
                🗑️ 申請刪除「{customer.company_name}」
              </h3>
              <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                送出後會通知該課課長審核，核准後客戶才會從名單移除。請填寫刪除理由：
              </p>
              <textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                rows={3}
                autoFocus
                placeholder="例如：重複建檔／客戶已倒閉／填錯資料…"
                className="input-field text-sm mt-3"
              />
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setShowDeleteReq(false)} disabled={deletionBusy} className="btn-secondary text-sm">取消</button>
                <button onClick={submitDeletion} disabled={deletionBusy || !deleteReason.trim()} className="btn-danger text-sm disabled:opacity-50">
                  {deletionBusy ? '送出中…' : '送出申請'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Claim Form */}
        {showClaimForm && (
          <div className="mt-4 p-4 bg-blue-50 rounded-lg space-y-3">
            <p className="text-sm font-medium text-blue-800">
              {isOwnerClaim ? '申請解鎖續辦此客戶' : '申請認領此客戶'} <span className="text-red-500">*需填原因</span>
            </p>
            <textarea
              value={claimNote}
              onChange={(e) => setClaimNote(e.target.value)}
              className="input-field text-sm"
              rows={3}
              autoFocus
              placeholder={isOwnerClaim
                ? '請說明續辦原因（必填）：例如 客戶仍在洽談中、近期有回應、需要再跟進…'
                : '請說明認領原因（必填）：例如 原業務離職、客戶主動找我、我有相關資源可推進…'}
            />
            <div className="flex gap-2">
              <button onClick={handleClaim} disabled={submittingClaim || !claimNote.trim()} className="btn-primary text-sm disabled:opacity-50">
                {submittingClaim ? '送出中...' : '送出申請'}
              </button>
              <button onClick={() => setShowClaimForm(false)} className="btn-secondary text-sm">取消</button>
            </div>
          </div>
        )}
      </div>

      {/* 主管推薦優先開發 */}
      {(customer.priority_flag || isSuperRole) && (
        <div className={cn('card', customer.priority_flag && 'bg-amber-50/50 border border-amber-200')}>
          {customer.priority_flag ? (
            <div className="flex items-start gap-2">
              <span className="text-lg shrink-0">⭐</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-amber-800">主管建議優先開發</p>
                {customer.priority_note && <p className="text-sm text-gray-700 mt-0.5">{customer.priority_note}</p>}
                {customer.priority_at && <p className="text-[11px] text-gray-400 mt-1">{formatDateTime(customer.priority_at)}</p>}
              </div>
              {isSuperRole && (
                <button onClick={() => setPriority(false)} disabled={prioritySaving} className="btn-secondary text-xs shrink-0 disabled:opacity-50">
                  取消優先
                </button>
              )}
            </div>
          ) : (
            // 未標記 + 主管：提供設為優先的控制
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">⭐</span>
                <div>
                  <h3 className="font-bold text-gray-900 text-sm">建議優先開發</h3>
                  <p className="text-xs text-gray-500">標記後會排在該業務名單最前面並通知他</p>
                </div>
              </div>
              <textarea
                value={priorityNoteInput}
                onChange={(e) => setPriorityNoteInput(e.target.value)}
                placeholder="給業務的建議（選填）：例如 這家最近有詢價，優先跟進"
                rows={2}
                className="input-field text-sm mb-2"
              />
              <button onClick={() => setPriority(true)} disabled={prioritySaving} className="btn-primary text-sm disabled:opacity-50">
                設為優先開發
              </button>
            </div>
          )}
        </div>
      )}

      {/* Data Completeness */}
      <CompletenessCard
        grade={customer.grade}
        companyCodeType={customer.company_code_type}
        lastContactDate={customer.last_contact_date}
        contactsCount={contacts.length}
      />

      {/* 跟進待辦 */}
      {canViewDetails && (
        <div className="card">
          <h2 className="font-bold text-gray-900 mb-3 flex items-center gap-1.5">
            🎯 跟進待辦
            {followUps.filter(f => !f.is_done).length > 0 && (
              <span className="text-xs font-normal text-gray-400">（{followUps.filter(f => !f.is_done).length} 項待辦）</span>
            )}
          </h2>
          {canEdit && (
            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <input
                type="text"
                value={newFollowUp}
                onChange={(e) => setNewFollowUp(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addFollowUp() }}
                placeholder="下一步要做什麼？例如：週五回電報價"
                className="input-field text-sm flex-1"
              />
              <input
                type="date"
                value={newFollowUpDue}
                onChange={(e) => setNewFollowUpDue(e.target.value)}
                className="input-field text-sm sm:w-40"
                title="到期日（到期會提醒）"
              />
              <button onClick={addFollowUp} disabled={addingFollowUp || !newFollowUp.trim()} className="btn-primary text-sm shrink-0 disabled:opacity-50">
                新增
              </button>
            </div>
          )}
          {followUps.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">尚無待辦。設一個「下一步 + 到期日」，到期會提醒你。</p>
          ) : (
            <div className="space-y-1.5">
              {followUps.map(f => {
                const overdue = !f.is_done && f.due_date && f.due_date < new Date().toISOString().slice(0, 10)
                const canManage = user?.id === f.created_by || user?.role === 'admin'
                return (
                  <div key={f.id} className={cn('flex items-start gap-2 p-2 rounded-lg', f.is_done ? 'opacity-50' : overdue ? 'bg-red-50' : 'hover:bg-gray-50')}>
                    <input
                      type="checkbox"
                      checked={f.is_done}
                      onChange={() => canManage && toggleFollowUp(f)}
                      disabled={!canManage}
                      className="w-4 h-4 mt-0.5 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-sm', f.is_done && 'line-through text-gray-400')}>{f.content}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {f.due_date && <span className={cn(overdue && 'text-red-500 font-medium')}>📅 {formatDate(f.due_date)}{overdue && '（已逾期）'} · </span>}
                        {f.created_by_user?.chinese_name || f.created_by_user?.name || ''}
                      </p>
                    </div>
                    {canManage && (
                      <button onClick={() => deleteFollowUp(f)} className="text-gray-300 hover:text-red-500 shrink-0 text-xs px-1" title="刪除">✕</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Contacts / Comments / History：僅負責業務與管理階層可見 */}
      {!canViewDetails ? (
        <div className="card bg-gray-50 border border-gray-200">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🔒</span>
            <div>
              <h2 className="font-semibold text-gray-800">聯絡資訊、歷史軌跡、留言</h2>
              <p className="text-sm text-gray-500 mt-1">
                僅負責業務本人、所屬課長、部長、董事長與管理員可檢視。
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
      {/* Contacts Section
         * 聯絡人寫入權限：
         *   admin / chairman / director / manager(同課別) → 一律可
         *   負責業務本人（任何 role）→ 客戶非鎖檔時可管理（migration 013）
         *   其他 → 僅可查看
         */}
      <ContactsSection
        contacts={contacts}
        canManage={!!(isSuperRole || (isOwner && customer.status !== 'locked'))}
        onRefresh={fetchAll}
        customerId={String(id)}
      />

      {/* Comments Section */}
      <div className="card">
        <h2 className="font-bold text-gray-900 mb-3">備註留言</h2>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="input-field flex-1"
            placeholder="輸入留言..."
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment() }}
          />
          <button
            onClick={handleAddComment}
            disabled={submittingComment || !newComment.trim()}
            className="btn-primary text-sm shrink-0"
          >
            送出
          </button>
        </div>

        <div className="space-y-3">
          {comments.map((comment) => (
            <div key={comment.id} className="border-l-2 border-primary-200 pl-3 py-1">
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                <span className="font-medium text-gray-700">{comment.user?.chinese_name}</span>
                <span>{formatDateTime(comment.created_at)}</span>
              </div>
              <p className="text-sm text-gray-800">{comment.content}</p>
            </div>
          ))}
          {comments.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">尚無留言</p>
          )}
        </div>
      </div>

      {/* History Section */}
      <div className="card">
        <h2 className="font-bold text-gray-900 mb-3">歷史軌跡</h2>
        <div className="space-y-3">
          {history.map((h) => (
            <div key={h.id} className="flex gap-3 text-sm">
              <div className="shrink-0 mt-1">
                <div className={cn(
                  'w-2.5 h-2.5 rounded-full',
                  h.action_type === 'created' ? 'bg-blue-500' :
                  h.action_type === 'notify_30' ? 'bg-lime-400' :
                  h.action_type === 'notify_60' ? 'bg-yellow-400' :
                  h.action_type === 'warning' ? 'bg-orange-500' :
                  h.action_type === 'notify_80' ? 'bg-red-500' :
                  h.action_type === 'locked' ? 'bg-gray-800' :
                  h.action_type === 'reactivated' ? 'bg-green-500' :
                  h.action_type === 'mark_negotiating' ? 'bg-blue-500' :
                  h.action_type === 'mark_completed' ? 'bg-amber-400' :
                  h.action_type === 'mark_long_term' ? 'bg-green-800' :
                  h.action_type === 'mark_abandoned' ? 'bg-gray-400' :
                  h.action_type === 'mark_developing' ? 'bg-green-500' :
                  'bg-gray-400'
                )} />
              </div>
              <div className="flex-1">
                <p className="text-gray-800">
                  {getHistoryLabel(h)}
                </p>
                {h.note && <p className="text-gray-500 text-xs mt-0.5">{h.note}</p>}
                <p className="text-gray-400 text-xs mt-0.5">
                  {formatDateTime(h.action_date)} · {h.action_by_user?.chinese_name}
                </p>
              </div>
            </div>
          ))}
          {history.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">無歷史記錄</p>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  )
}

function getHistoryLabel(h: CustomerHistory): string {
  switch (h.action_type) {
    case 'created': return '客戶建檔'
    case 'notify_30': return '🟢 開發提醒（第 30 天）'
    case 'notify_60': return '🟡 關注提醒（第 60 天）'
    case 'warning': return '🟠 黃燈警示（第 75 天）'
    case 'notify_80': return '🔴 緊急警告（第 80 天）'
    case 'locked': return '⚫ 鎖檔暫停（第 90 天）'
    case 'transfer_requested':
      return `${h.action_by_user?.chinese_name} 申請認領（原負責：${h.from_user_data?.chinese_name}）`
    case 'transfer_approved':
      return `客戶轉移：${h.from_user_data?.chinese_name} → ${h.to_user_data?.chinese_name}`
    case 'reactivated': return '重新開發'
    case 'mark_developing': return '↩️ 改回開發中'
    case 'mark_negotiating': return '🔵 標記為洽談中'
    case 'mark_completed': return '🏆 標記為已成交'
    case 'mark_long_term': return '⭐ 標記為長期合作'
    case 'mark_abandoned': return '❌ 標記為未成交'
    default: return h.action_type
  }
}

// ===================================================
// 狀態操作列：依權限顯示可用的「標記」按鈕
// ===================================================
function StatusActionsBar({
  customer,
  canChangeStatus,
  canSetLongTerm,
  onChange,
}: {
  customer: Customer
  canChangeStatus: boolean | null | undefined
  canSetLongTerm: boolean | null | undefined
  onChange: (
    s: 'active_developing' | 'negotiating' | 'completed' | 'long_term' | 'abandoned',
    a: 'mark_developing' | 'mark_negotiating' | 'mark_completed' | 'mark_long_term' | 'mark_abandoned'
  ) => void
}) {
  if (!canChangeStatus) return null

  // 按鈕清單（依目前狀態排除「已經是這個狀態」的按鈕）
  const actions: Array<{
    status: 'active_developing' | 'negotiating' | 'completed' | 'long_term' | 'abandoned'
    actionType: 'mark_developing' | 'mark_negotiating' | 'mark_completed' | 'mark_long_term' | 'mark_abandoned'
    label: string
    className: string
    privileged?: boolean
  }> = [
    { status: 'active_developing', actionType: 'mark_developing',  label: '↩️ 改回開發中',   className: 'bg-green-500 hover:bg-green-600 text-white' },
    { status: 'negotiating',       actionType: 'mark_negotiating', label: '🔵 洽談中',       className: 'bg-blue-500 hover:bg-blue-600 text-white' },
    { status: 'completed',         actionType: 'mark_completed',   label: '🏆 已成交',       className: 'bg-amber-400 hover:bg-amber-500 text-amber-900' },
    { status: 'long_term',         actionType: 'mark_long_term',   label: '⭐ 長期合作',     className: 'bg-green-800 hover:bg-green-900 text-white', privileged: true },
    { status: 'abandoned',         actionType: 'mark_abandoned',   label: '❌ 未成交',       className: 'bg-gray-400 hover:bg-gray-500 text-white' },
  ]

  return (
    <div className="border-t pt-3 mb-3">
      <p className="text-xs text-gray-500 mb-2">標記狀態</p>
      <div className="flex flex-wrap gap-2">
        {actions
          .filter(a => a.status !== customer.status)
          .filter(a => !a.privileged || canSetLongTerm)
          .map(a => (
            <button
              key={a.status}
              onClick={() => onChange(a.status, a.actionType)}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition', a.className)}
            >
              {a.label}
            </button>
          ))}
      </div>
      {!canSetLongTerm && (
        <p className="text-xs text-gray-400 mt-2">「長期合作」需課長或管理員才能設定</p>
      )}
    </div>
  )
}

// ===================================================
// 聯絡人區塊：可新增、編輯、刪除多筆聯絡人
// ===================================================
function ContactsSection({
  contacts,
  canManage,
  onRefresh,
  customerId,
}: {
  contacts: CustomerContact[]
  canManage: boolean
  onRefresh: () => void | Promise<void>
  customerId: string
}) {
  const supabase = createClient()
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', title: '', phone: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function resetForm() {
    setForm({ name: '', title: '', phone: '', email: '' })
    setError('')
  }

  function openAdd() {
    resetForm()
    setEditingId(null)
    setShowAddForm(true)
  }

  function openEdit(c: CustomerContact) {
    setForm({
      name: c.name,
      title: c.title || '',
      phone: c.phone || '',
      email: c.email || '',
    })
    setEditingId(c.id)
    setShowAddForm(true)
    setError('')
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('聯絡人姓名為必填')
      return
    }
    setSaving(true)
    setError('')

    const payload = {
      name: form.name.trim(),
      title: form.title.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
    }

    let err
    if (editingId) {
      const res = await supabase
        .from('customer_contacts')
        .update(payload)
        .eq('id', editingId)
      err = res.error
    } else {
      const res = await supabase
        .from('customer_contacts')
        .insert({ ...payload, customer_id: customerId, created_by: user?.id })
      err = res.error
    }

    setSaving(false)
    if (err) {
      setError('儲存失敗：' + err.message)
      return
    }

    setShowAddForm(false)
    setEditingId(null)
    resetForm()
    await onRefresh()
  }

  async function handleDelete(c: CustomerContact) {
    const ok = await confirm({ title: '刪除聯絡人', message: `確定要刪除聯絡人「${c.name}」？`, danger: true, confirmLabel: '刪除' })
    if (!ok) return
    const { error: delErr } = await supabase
      .from('customer_contacts')
      .delete()
      .eq('id', c.id)
    if (delErr) {
      toast.error('刪除失敗：' + delErr.message)
      return
    }
    await onRefresh()
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-gray-900">聯絡資訊</h2>
        {canManage && !showAddForm && (
          <button onClick={openAdd} className="text-sm text-primary-600 hover:text-primary-700 font-medium">
            ➕ 新增聯絡人
          </button>
        )}
      </div>

      {/* 聯絡人列表 */}
      <div className="space-y-2">
        {contacts.map((c) => (
          <div key={c.id} className="border border-gray-100 rounded-lg p-3 hover:bg-gray-50 transition">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900">{c.name}</span>
                  {c.title && (
                    <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                      {c.title}
                    </span>
                  )}
                </div>
                {c.phone && (
                  <a
                    href={`tel:${c.phone}`}
                    className="flex items-center gap-1.5 text-sm text-gray-700 hover:text-primary-600"
                  >
                    📞 <span>{c.phone}</span>
                  </a>
                )}
                {c.email && (
                  <a
                    href={`mailto:${c.email}`}
                    className="flex items-center gap-1.5 text-sm text-gray-700 hover:text-primary-600 break-all"
                  >
                    ✉️ <span>{c.email}</span>
                  </a>
                )}
              </div>
              {canManage && (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(c)}
                    className="p-1.5 text-gray-400 hover:text-primary-600 transition"
                    title="編輯"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => handleDelete(c)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition"
                    title="刪除"
                  >
                    🗑️
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {contacts.length === 0 && !showAddForm && (
          <p className="text-sm text-gray-400 text-center py-4">尚無聯絡人</p>
        )}
      </div>

      {/* 新增 / 編輯表單 */}
      {showAddForm && (
        <form onSubmit={handleSave} className="mt-4 p-3 bg-gray-50 rounded-lg space-y-3">
          <p className="text-sm font-semibold text-gray-700">
            {editingId ? '編輯聯絡人' : '新增聯絡人'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                姓名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input-field text-sm"
                required
                placeholder="王經理"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">職稱</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="input-field text-sm"
                placeholder="採購經理"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">電話</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="input-field text-sm"
                placeholder="02-1234-5678 或 0912-345-678"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="input-field text-sm"
                placeholder="name@company.com"
              />
            </div>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving} className="btn-primary text-sm">
              {saving ? '儲存中...' : editingId ? '更新' : '新增'}
            </button>
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setEditingId(null); resetForm() }}
              disabled={saving}
              className="btn-secondary text-sm"
            >
              取消
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ===================================================
// 資料完整度卡片
// ===================================================
function CompletenessCard({
  grade, companyCodeType, lastContactDate, contactsCount,
}: {
  grade: string
  companyCodeType: string | null
  lastContactDate: string | null
  contactsCount: number
}) {
  const result = getCustomerCompleteness({
    grade, companyCodeType, lastContactDate, contactsCount,
  })

  if (result.isComplete) {
    return (
      <div className="card bg-green-50 border-green-200">
        <div className="flex items-center gap-2">
          <span className="text-2xl">✅</span>
          <div>
            <p className="font-semibold text-green-900">資料完整度：100%</p>
            <p className="text-xs text-green-700">此客戶資料已完整填寫</p>
          </div>
        </div>
      </div>
    )
  }

  const barColor =
    result.score >= 75 ? 'bg-green-500' :
    result.score >= 50 ? 'bg-yellow-500' :
    'bg-orange-500'

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-bold text-gray-900">資料完整度</h2>
        <span className={cn(
          'text-sm font-semibold tabular-nums',
          result.score >= 75 ? 'text-green-600' :
          result.score >= 50 ? 'text-yellow-600' :
          'text-orange-600'
        )}>
          {result.completed} / {result.total}（{result.score}%）
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
        <div
          className={cn('h-full transition-all', barColor)}
          style={{ width: `${result.score}%` }}
        />
      </div>
      {/* Checklist */}
      <ul className="space-y-1.5 text-sm">
        {result.items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="shrink-0 mt-0.5">
              {item.done
                ? <span className="text-green-500">✓</span>
                : <span className="text-orange-500">○</span>}
            </span>
            <div className="flex-1">
              <span className={cn(
                item.done ? 'text-gray-700' : 'text-gray-900 font-medium'
              )}>
                {item.label}
              </span>
              {!item.done && item.hint && (
                <p className="text-xs text-gray-500 mt-0.5">{item.hint}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
