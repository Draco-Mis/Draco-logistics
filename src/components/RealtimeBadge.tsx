'use client'

import { formatRelativeTime } from '@/lib/use-realtime'
import { cn } from '@/lib/utils'

interface Props {
  status: 'connecting' | 'connected' | 'disconnected'
  lastUpdated: Date | null
  onRefresh: () => void | Promise<void>
}

export function RealtimeBadge({ status, lastUpdated, onRefresh }: Props) {
  const dotColor =
    status === 'connected' ? 'bg-green-500' :
    status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
    'bg-red-500'

  const label =
    status === 'connected' ? '即時同步' :
    status === 'connecting' ? '連線中…' :
    '連線中斷'

  const rel = formatRelativeTime(lastUpdated)
  const isStale = lastUpdated
    ? (Date.now() - lastUpdated.getTime()) > 5 * 60_000
    : false

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex items-center gap-1.5">
        <span className={cn('inline-block w-2 h-2 rounded-full', dotColor)} />
        <span className={status === 'disconnected' ? 'text-red-600' : 'text-gray-500'}>
          {label}
        </span>
      </span>
      <span className={cn('text-gray-400', isStale && 'text-orange-500')}>
        上次更新 {rel}
      </span>
      <button
        onClick={() => void onRefresh()}
        className="text-gray-500 hover:text-primary-600 transition"
        title="重新整理"
      >🔄</button>
    </div>
  )
}
