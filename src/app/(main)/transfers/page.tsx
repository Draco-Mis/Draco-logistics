'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { formatDateTime, cn } from '@/lib/utils'
import { canApproveTransfers } from '@/lib/permissions'
import { useToast } from '@/components/ui/Toast'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonListItem } from '@/components/ui/Skeleton'
import { ArrowLeftRight, Trash2 } from 'lucide-react'

// 兩種審核共用的顯示模型
interface ReviewItem {
  id: string
  customerId: string
  companyName: string
  customerTeam: string | null
  requesterName: string
  note: string | null
  requestedAt: string
  status: string
  reviewedByName: string | null
  reviewedAt: string | null
}

type Section = 'transfer' | 'deletion'
type Tab = 'pending' | 'history'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toItem(r: any, noteKey: 'note' | 'reason'): ReviewItem {
  return {
    id: r.id,
    customerId: r.customer_id,
    companyName: r.customer?.company_name || '（客戶）',
    customerTeam: r.customer?.assigned_user?.team ?? null,
    requesterName: r.requested_by_user?.chinese_name || r.requested_by_user?.name || '—',
    note: r[noteKey] ?? null,
    requestedAt: r.requested_at,
    status: r.status,
    reviewedByName: r.reviewed_by_user?.chinese_name || r.reviewed_by_user?.name || null,
    reviewedAt: r.reviewed_at ?? null,
  }
}

export default function ReviewCenterPage() {
  const { user } = useAuth()
  const supabase = createClient()
  const toast = useToast()
  const [transfers, setTransfers] = useState<ReviewItem[]>([])
  const [deletions, setDeletions] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('transfer')
  const [tab, setTab] = useState<Tab>('pending')

  useEffect(() => {
    fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchAll() {
    const sel = '*, customer:customers(id, company_name, assigned_user:users!assigned_to(team)), requested_by_user:users!requested_by(*), reviewed_by_user:users!reviewed_by(*)'
    const [t, d] = await Promise.all([
      supabase.from('transfer_requests').select(sel).order('requested_at', { ascending: false }),
      supabase.from('customer_deletion_requests').select(sel).order('requested_at', { ascending: false }),
    ])
    if (t.data) setTransfers((t.data as unknown[]).map(r => toItem(r, 'note')))
    if (d.data) setDeletions((d.data as unknown[]).map(r => toItem(r, 'reason')))
    setLoading(false)
  }

  async function handleReview(sec: Section, id: string, approved: boolean) {
    if (!user || reviewingId) return
    setReviewingId(id)
    const rpc = sec === 'transfer' ? 'review_transfer_request' : 'review_customer_deletion'
    const { data, error } = await supabase.rpc(rpc, { p_request_id: id, p_approved: approved })
    setReviewingId(null)
    if (error) { toast.error('審核失敗：' + error.message); return }
    const company = (data as { company_name?: string } | null)?.company_name
    const kind = sec === 'transfer' ? '認領' : '刪除'
    toast.success(`已${approved ? '核准' : '拒絕'}${company ? `「${company}」的` : ''}${kind}申請`)
    fetchAll()
  }

  const canReview = canApproveTransfers(user)

  // 對單筆是否有審核權：admin/chairman/director 全部可；manager 僅限客戶負責人同課別
  const canReviewThis = (item: ReviewItem) => {
    if (!user) return false
    if (user.role === 'admin' || user.role === 'chairman' || user.role === 'director') return true
    if (user.role === 'manager') return !!item.customerTeam && user.team === item.customerTeam
    return false
  }

  if (!canReview) {
    return <div className="p-4 text-center py-12 text-gray-400"><p>您沒有權限查看此頁面</p></div>
  }

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-2">
        <div className="h-8 w-40 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse mb-4" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card"><SkeletonListItem /></div>
        ))}
      </div>
    )
  }

  const list = section === 'transfer' ? transfers : deletions
  const pending = list.filter(r => r.status === 'pending')
  const history = list.filter(r => r.status !== 'pending')
  const shown = tab === 'pending' ? pending : history
  const transferPending = transfers.filter(r => r.status === 'pending').length
  const deletionPending = deletions.filter(r => r.status === 'pending').length
  const kind = section === 'transfer' ? '認領' : '刪除'

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight mb-4">審核中心</h1>

      {/* 類別切換 */}
      <div className="flex gap-2 mb-3">
        <SectionBtn active={section === 'transfer'} onClick={() => { setSection('transfer'); setTab('pending') }} icon={<ArrowLeftRight className="w-4 h-4" />} label="客戶轉移" count={transferPending} />
        <SectionBtn active={section === 'deletion'} onClick={() => { setSection('deletion'); setTab('pending') }} icon={<Trash2 className="w-4 h-4" />} label="客戶刪除" count={deletionPending} />
      </div>

      {/* 待審核 / 歷史 */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('pending')} className={cn('px-4 py-2 rounded-lg text-sm font-medium transition', tab === 'pending' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600')}>
          待審核 ({pending.length})
        </button>
        <button onClick={() => setTab('history')} className={cn('px-4 py-2 rounded-lg text-sm font-medium transition', tab === 'history' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600')}>
          歷史記錄
        </button>
      </div>

      <div className="space-y-3">
        {shown.map((item) => (
          <div key={item.id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link href={`/customers/${item.customerId}`} className="font-semibold text-primary-600 hover:underline">
                  {item.companyName}
                </Link>
                <p className="text-sm text-gray-500 mt-1">申請人：{item.requesterName}</p>
                {item.note && <p className="text-sm text-gray-600 mt-1">原因：{item.note}</p>}
                <p className="text-xs text-gray-400 mt-1">{formatDateTime(item.requestedAt)}</p>
              </div>
              {item.status === 'pending' ? (
                canReviewThis(item) ? (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => handleReview(section, item.id, true)} disabled={reviewingId === item.id}
                      className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg transition disabled:opacity-50">核准</button>
                    <button onClick={() => handleReview(section, item.id, false)} disabled={reviewingId === item.id}
                      className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg transition disabled:opacity-50">拒絕</button>
                  </div>
                ) : (
                  <span className="badge bg-gray-100 text-gray-500 shrink-0">非本課，無審核權</span>
                )
              ) : (
                <span className={cn('badge', item.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800')}>
                  {item.status === 'approved' ? '已核准' : '已拒絕'}
                </span>
              )}
            </div>
            {item.reviewedByName && (
              <p className="text-xs text-gray-400 mt-2">審核：{item.reviewedByName} · {item.reviewedAt ? formatDateTime(item.reviewedAt) : ''}</p>
            )}
          </div>
        ))}

        {shown.length === 0 && (
          <EmptyState
            icon={section === 'transfer' ? ArrowLeftRight : Trash2}
            title={tab === 'pending' ? `目前沒有待審核的${kind}申請` : '尚無歷史記錄'}
            description={tab === 'pending'
              ? (section === 'transfer' ? '業務提出認領客戶的申請後，會顯示在這裡等待審核。' : '業務申請刪除客戶後，會顯示在這裡等待課長審核。')
              : undefined}
          />
        )}
      </div>
    </div>
  )
}

function SectionBtn({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={cn('flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition border',
        active ? 'bg-accent-50 border-accent-200 text-accent-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}
    >
      {icon}
      {label}
      {count > 0 && (
        <span className={cn('min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center', active ? 'bg-accent-600 text-white' : 'bg-red-500 text-white')}>
          {count}
        </span>
      )}
    </button>
  )
}
