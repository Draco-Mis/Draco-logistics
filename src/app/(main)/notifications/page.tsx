'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Trash2, Info, Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { formatDateTime, cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonListItem } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useNotifications } from '@/lib/notifications-context'

const TRIGGER_INFO = [
  { icon: '🟢', label: '開發提醒（第 30 天）', who: '負責業務' },
  { icon: '🟡', label: '關注提醒（第 60 天）', who: '業務 + 課長/部長' },
  { icon: '🟠', label: '黃燈警示（第 75 天）', who: '業務 + 課長/部長' },
  { icon: '🔴', label: '緊急警告（第 80 天）', who: '業務 + 課長/部長 + Hans' },
  { icon: '⚫', label: '鎖檔通知（第 90 天）', who: '全部主管 + 業務' },
  { icon: '🔄', label: '有人申請認領客戶', who: '所有 admin + 課長/部長' },
  { icon: '✅', label: '認領審核結果（核准/拒絕）', who: '申請人' },
  { icon: '📌', label: '客戶被重新指派', who: '新業務 + 原業務' },
  { icon: '👋', label: '業務離職客戶鎖檔', who: 'Hans' },
  { icon: '💬', label: '有人在你的客戶留言', who: '負責業務' },
  { icon: '📊', label: '每週摘要（週一早上）', who: '所有在職人員' },
  { icon: '👋', label: '登入歡迎通知', who: '登入的人' },
]

interface Notification {
  id: string
  title: string
  message: string
  link: string | null
  is_read: boolean
  created_at: string
}

type Filter = 'all' | 'unread' | 'read'

export default function NotificationsPage() {
  const { user } = useAuth()
  const supabase = createClient()
  const toast = useToast()
  const confirm = useConfirm()
  const { refresh: refreshBadge } = useNotifications()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    fetchNotifications()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function fetchNotifications() {
    if (!user) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (data) setNotifications(data)
    setLoading(false)
  }

  // 標記單筆為已讀（保持原順序，不重新 fetch）
  async function markAsRead(id: string) {
    const target = notifications.find(n => n.id === id)
    if (!target || target.is_read) return
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
    refreshBadge()
  }

  // 刪除單筆
  async function deleteOne(id: string, e?: React.MouseEvent) {
    e?.preventDefault()
    e?.stopPropagation()
    const ok = await confirm({ title: '刪除通知', message: '確定要刪除這則通知？', danger: true, confirmLabel: '刪除' })
    if (!ok) return

    setNotifications(prev => prev.filter(n => n.id !== id))
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', id)
    if (error) {
      // rollback
      toast.error('刪除失敗：' + error.message)
      fetchNotifications()
    } else {
      refreshBadge()
    }
  }

  // 全部標記已讀
  async function markAllRead() {
    if (unreadCount === 0) return
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user!.id)
      .eq('is_read', false)
    refreshBadge()
    toast.success('已全部標為已讀')
  }

  // 清除已讀
  async function clearRead() {
    if (readCount === 0) return
    const ok = await confirm({ title: '清除已讀通知', message: `確定要刪除全部已讀通知（${readCount} 則）？`, danger: true, confirmLabel: '刪除' })
    if (!ok) return
    setNotifications(prev => prev.filter(n => !n.is_read))
    await supabase
      .from('notifications')
      .delete()
      .eq('user_id', user!.id)
      .eq('is_read', true)
    refreshBadge()
  }

  const unreadCount = notifications.filter(n => !n.is_read).length
  const readCount = notifications.filter(n => n.is_read).length

  const filteredNotifications = useMemo(() => {
    if (filter === 'unread') return notifications.filter(n => !n.is_read)
    if (filter === 'read') return notifications.filter(n => n.is_read)
    return notifications
  }, [notifications, filter])

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-2">
        <div className="h-8 w-40 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse mb-5" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card"><SkeletonListItem /></div>
        ))}
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">通知中心</h1>
        <div className="flex gap-3">
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-xs text-accent-600 hover:text-accent-700 font-medium transition-colors duration-200"
            >
              全部標為已讀
            </button>
          )}
          {readCount > 0 && (
            <button
              onClick={clearRead}
              className="text-xs text-red-500 hover:text-red-600 font-medium transition-colors duration-200"
            >
              清除已讀
            </button>
          )}
        </div>
      </div>

      {/* 通知觸發條件 */}
      <details className="card mb-5 text-sm">
        <summary className="cursor-pointer font-semibold text-gray-700 select-none flex items-center gap-2">
          <Info className="w-4 h-4 text-accent-600" />
          系統會在什麼情況下產生通知？
        </summary>
        <div className="mt-3 space-y-1.5">
          {TRIGGER_INFO.map((t, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="shrink-0">{t.icon}</span>
              <span className="flex-1">{t.label}</span>
              <span className="text-gray-500 text-xs shrink-0">{t.who}</span>
            </div>
          ))}
        </div>
      </details>

      {/* 篩選 tabs */}
      <div className="flex gap-2 mb-5">
        {([
          { key: 'all', label: '全部', count: notifications.length },
          { key: 'unread', label: '未讀', count: unreadCount },
          { key: 'read', label: '已讀', count: readCount },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={cn(
              'px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ease-apple',
              filter === t.key
                ? 'bg-gray-900 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            {t.label} <span className="opacity-70 tabular-nums ml-0.5">({t.count})</span>
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filteredNotifications.map((n) => {
          const body = (
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {!n.is_read && (
                    <span className="w-2 h-2 rounded-full bg-accent-500 shrink-0 shadow-sm shadow-accent-500/50" />
                  )}
                  <p className={cn(
                    'text-gray-900 truncate tracking-tight',
                    n.is_read ? 'font-normal' : 'font-semibold',
                  )}>
                    {n.title}
                  </p>
                </div>
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">{n.message}</p>
                <p className="text-xs text-gray-400 mt-1.5">{formatDateTime(n.created_at)}</p>
              </div>
              <button
                onClick={(e) => deleteOne(n.id, e)}
                className="shrink-0 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all duration-200"
                aria-label="刪除通知"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )

          return (
            <div
              key={n.id}
              className={cn(
                'card transition-all duration-200 ease-apple',
                !n.is_read && 'ring-2 ring-accent-500/20 bg-accent-50/40',
              )}
            >
              {n.link ? (
                <Link href={n.link} onClick={() => markAsRead(n.id)} className="block">
                  {body}
                </Link>
              ) : (
                <div onClick={() => markAsRead(n.id)} className="cursor-pointer">
                  {body}
                </div>
              )}
            </div>
          )
        })}
        {filteredNotifications.length === 0 && (
          <EmptyState
            icon={Bell}
            title={filter === 'unread' ? '沒有未讀通知' : filter === 'read' ? '沒有已讀通知' : '目前沒有通知'}
            description={filter === 'all' ? '系統事件（客戶警示、認領審核、每週摘要等）會顯示在這裡。' : undefined}
          />
        )}
      </div>
    </div>
  )
}
