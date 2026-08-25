'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import type { User, Customer } from '@/types/database'
import { getStatusLabel, getStatusColor, formatDate, formatDateTime, cn } from '@/lib/utils'
import { useConfirm } from '@/components/ui/ConfirmDialog'

interface DepartedRow {
  user: User
  customers: Customer[]
}

export default function DepartedUsersPage() {
  const { user: currentUser } = useAuth()
  const supabase = createClient()
  const confirm = useConfirm()

  const [departed, setDeparted] = useState<DepartedRow[]>([])
  const [activeUsers, setActiveUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [transferModalFor, setTransferModalFor] = useState<DepartedRow | null>(null)
  const [transferTargetId, setTransferTargetId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 權限分層：
  //   admin / chairman / director → 全公司
  //   manager → 同團隊
  //   其他 → 無權
  const canView = !!currentUser && ['admin', 'chairman', 'director', 'manager'].includes(currentUser.role)
  const isSuperAdmin = !!currentUser && ['admin', 'chairman'].includes(currentUser.role)
  const isManagerScope = currentUser?.role === 'manager'

  async function loadAll() {
    if (!currentUser) return
    setLoading(true)
    setMessage(null)

    // 依角色過濾範圍
    let departedQuery = supabase.from('users').select('*').eq('is_active', false)
    let activeQuery = supabase.from('users').select('*').eq('is_active', true).order('name')
    if (isManagerScope) {
      departedQuery = departedQuery.eq('team', currentUser.team)
      activeQuery = activeQuery.eq('team', currentUser.team)
    }

    const [departedRes, activeRes] = await Promise.all([
      departedQuery.order('deactivated_at', { ascending: false, nullsFirst: false }),
      activeQuery,
    ])

    if (!departedRes.data) {
      setLoading(false)
      return
    }

    const departedUsers = departedRes.data as User[]
    setActiveUsers((activeRes.data as User[]) || [])

    // 為每位離職員工撈他名下的客戶
    if (departedUsers.length === 0) {
      setDeparted([])
      setLoading(false)
      return
    }

    const ids = departedUsers.map(u => u.id)
    const { data: customersData } = await supabase
      .from('customers')
      .select('id, company_name, assigned_to, status, grade, created_date, last_contact_date, deleted_at')
      .in('assigned_to', ids)
      .order('company_name')

    const byUserId = new Map<string, Customer[]>()
    for (const c of (customersData || []) as Customer[]) {
      const arr = byUserId.get(c.assigned_to) ?? []
      arr.push(c)
      byUserId.set(c.assigned_to, arr)
    }

    setDeparted(departedUsers.map(u => ({ user: u, customers: byUserId.get(u.id) ?? [] })))
    setLoading(false)
  }

  useEffect(() => {
    if (canView) loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser])

  const totalOrphans = useMemo(
    () => departed.reduce((sum, d) => sum + d.customers.length, 0),
    [departed]
  )

  async function handleReactivate(u: User) {
    const ok = await confirm({ title: '恢復在職', message: `確定要將「${u.chinese_name || u.name}」恢復為在職員工嗎？`, confirmLabel: '恢復' })
    if (!ok) return
    setSubmitting(true)
    const res = await fetch('/api/admin/users/update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, is_active: true }),
    })
    const data = await res.json()
    if (!res.ok) {
      setMessage({ type: 'error', text: `恢復失敗：${data.error || res.status}` })
    } else {
      setMessage({ type: 'success', text: `${u.chinese_name || u.name} 已恢復在職` })
      loadAll()
    }
    setSubmitting(false)
  }

  async function handleBulkTransfer() {
    if (!transferModalFor || !transferTargetId || !currentUser) return
    const target = activeUsers.find(u => u.id === transferTargetId)
    if (!target) return
    const list = transferModalFor.customers
    if (list.length === 0) {
      setTransferModalFor(null)
      return
    }
    const ok = await confirm({
      title: '批次轉移客戶',
      message: `確定要把「${transferModalFor.user.chinese_name || transferModalFor.user.name}」名下的 ${list.length} 筆客戶全部轉給「${target.chinese_name || target.name}」？\n\n• 90 天倒數會重設\n• 鎖檔客戶會解鎖為重新開發中\n• 已成交 / 長期合作 / 未成交 維持原狀`,
      confirmLabel: '全部轉移',
    })
    if (!ok) return

    setSubmitting(true)
    const today = new Date().toISOString().split('T')[0]
    let success = 0
    let failed = 0
    const historyRows: { customer_id: string; action_type: string; action_by: string; from_user: string; to_user: string; note: string }[] = []

    for (const c of list) {
      const isTrackedStatus = ['active_developing', 'warning', 'reactivating', 'negotiating', 'locked'].includes(c.status)
      const updates: Record<string, unknown> = { assigned_to: target.id }
      if (isTrackedStatus) {
        updates.created_date = today
        updates.status = 'reactivating'
        updates.locked_at = null
        updates.locked_reason = null
      }
      const { error } = await supabase.from('customers').update(updates).eq('id', c.id)
      if (error) {
        failed++
      } else {
        success++
        historyRows.push({
          customer_id: c.id,
          action_type: 'transfer_approved',
          action_by: currentUser.id,
          from_user: transferModalFor.user.id,
          to_user: target.id,
          note: `離職交接：${transferModalFor.user.chinese_name || transferModalFor.user.name} → ${target.chinese_name || target.name}`,
        })
      }
    }

    if (historyRows.length > 0) {
      await supabase.from('customer_history').insert(historyRows)
    }

    // 通知接手人
    if (success > 0) {
      await supabase.from('notifications').insert({
        user_id: target.id,
        title: '🎁 您接手了離職員工的客戶',
        message: `${transferModalFor.user.chinese_name || transferModalFor.user.name} 名下 ${success} 筆客戶已轉移給您，90 天倒數已重設`,
        link: '/my-customers',
      })
    }

    setMessage({
      type: failed === 0 ? 'success' : 'error',
      text: failed === 0
        ? `已轉移 ${success} 筆客戶給 ${target.chinese_name || target.name}`
        : `轉移完成：成功 ${success} 筆 · 失敗 ${failed} 筆`,
    })
    setTransferModalFor(null)
    setTransferTargetId('')
    setSubmitting(false)
    loadAll()
  }

  if (!canView) {
    return <div className="p-4 text-center py-12 text-gray-400">您沒有權限查看此頁面</div>
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight dark:text-gray-100 mb-1">離職員工管理</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        已停用使用者與他們名下尚未轉移的客戶。批次轉移會重設 90 天倒數並解除鎖檔狀態。
        {isManagerScope && <span className="text-orange-500"> · 你目前看到的是「{currentUser?.team}」團隊的離職員工</span>}
        {!isSuperAdmin && canView && <span className="text-gray-400"> · 「恢復在職」需請管理員操作</span>}
      </p>

      {/* 統計 */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{departed.length}</p>
          <p className="text-xs text-gray-500">離職員工</p>
        </div>
        <div className="card text-center">
          <p className={cn('text-2xl font-bold', totalOrphans > 0 ? 'text-orange-500' : 'text-gray-900')}>
            {totalOrphans}
          </p>
          <p className="text-xs text-gray-500">名下未轉移的客戶</p>
        </div>
      </div>

      {message && (
        <div className={cn(
          'card mb-4 border',
          message.type === 'success'
            ? 'border-green-300 bg-green-50 dark:bg-green-900/20'
            : 'border-red-300 bg-red-50 dark:bg-red-900/20'
        )}>
          <p className={cn(
            'text-sm',
            message.type === 'success' ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
          )}>{message.text}</p>
        </div>
      )}

      {loading && (
        <div className="p-4 flex justify-center items-center min-h-[30vh]">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}

      {!loading && departed.length === 0 && (
        <div className="card text-center py-12 text-gray-400">目前沒有離職員工</div>
      )}

      {/* 離職員工清單 */}
      <div className="space-y-3">
        {departed.map(d => (
          <div key={d.user.id} className="card">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {d.user.chinese_name || d.user.name}
                  </span>
                  <span className="badge bg-red-100 text-red-600">已離職</span>
                  {d.user.team && (
                    <span className="text-xs text-gray-500">{d.user.team}</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {d.user.email}
                  {d.user.deactivated_at && (
                    <span className="ml-3">離職時間：{formatDateTime(d.user.deactivated_at)}</span>
                  )}
                </div>
                <div className="text-sm mt-2">
                  名下尚有 <span className={cn('font-bold', d.customers.length > 0 ? 'text-orange-600' : 'text-gray-400')}>{d.customers.length}</span> 筆未轉移客戶
                </div>
              </div>

              <div className="flex flex-col items-end gap-2 shrink-0">
                {d.customers.length > 0 && (
                  <button
                    onClick={() => { setTransferModalFor(d); setTransferTargetId('') }}
                    disabled={submitting}
                    className="btn-primary text-sm disabled:opacity-40"
                  >📤 批次轉移 ({d.customers.length})</button>
                )}
                {isSuperAdmin && (
                  <button
                    onClick={() => handleReactivate(d.user)}
                    disabled={submitting}
                    className="btn-secondary text-sm disabled:opacity-40"
                  >🔓 恢復在職</button>
                )}
              </div>
            </div>

            {/* 展開客戶清單 */}
            {d.customers.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setExpandedId(expandedId === d.user.id ? null : d.user.id)}
                  className="text-xs text-primary-600 hover:underline"
                >
                  {expandedId === d.user.id ? '▲ 收起客戶清單' : '▼ 展開查看 ' + d.customers.length + ' 筆客戶'}
                </button>
                {expandedId === d.user.id && (
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {d.customers.map(c => (
                      <Link
                        key={c.id}
                        href={`/customers/${c.id}`}
                        target="_blank"
                        className="text-sm border border-gray-200 dark:border-gray-700 rounded p-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{c.company_name}</div>
                        <div className="text-xs flex gap-2 flex-wrap mt-0.5">
                          <span className={getStatusColor(c.status)}>{getStatusLabel(c.status)}</span>
                          <span className="text-gray-500">{c.grade} · 建檔 {formatDate(c.created_date)}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 批次轉移 modal */}
      {transferModalFor && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => !submitting && setTransferModalFor(null)}
        >
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-5 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-1">批次轉移客戶</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              將「{transferModalFor.user.chinese_name || transferModalFor.user.name}」名下 <strong>{transferModalFor.customers.length}</strong> 筆客戶轉給：
            </p>
            <select
              value={transferTargetId}
              onChange={(e) => setTransferTargetId(e.target.value)}
              className="input-field mb-4"
              disabled={submitting}
            >
              <option value="">請選擇接手人</option>
              {activeUsers.map(u => (
                <option key={u.id} value={u.id}>
                  {u.chinese_name || u.name}（{u.team || '—'}）
                </option>
              ))}
            </select>

            <div className="text-xs text-gray-500 mb-4 space-y-1">
              <p>• 90 天倒數會重設為今天</p>
              <p>• 鎖檔客戶會解鎖並改為「重新開發中」</p>
              <p>• 已成交 / 長期合作 / 未成交 維持原狀</p>
              <p>• 接手人會收到站內通知</p>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setTransferModalFor(null)}
                disabled={submitting}
                className="btn-secondary text-sm"
              >取消</button>
              <button
                onClick={handleBulkTransfer}
                disabled={!transferTargetId || submitting}
                className="btn-primary text-sm disabled:opacity-40"
              >{submitting ? '轉移中…' : '確認轉移'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
