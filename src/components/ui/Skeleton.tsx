'use client'

import { cn } from '@/lib/utils'

// 通用 skeleton 區塊：寬高顏色可調，預設淡灰、圓角、脈動動畫
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800', className)}
      {...props}
    />
  )
}

// 列表項 skeleton（含頭像 + 兩行文字）
export function SkeletonListItem() {
  return (
    <div className="flex items-center gap-3 p-3">
      <Skeleton className="w-10 h-10 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
      <Skeleton className="w-12 h-6 shrink-0" />
    </div>
  )
}

// 表格行 skeleton
export function SkeletonTableRow({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="border-b border-gray-100">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="p-3">
          <Skeleton className="h-3" />
        </td>
      ))}
    </tr>
  )
}

// 卡片 skeleton
export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card space-y-3">
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3', i === rows - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}

// 統計數字 skeleton
export function SkeletonStat() {
  return (
    <div className="card">
      <Skeleton className="h-3 w-1/2 mb-2" />
      <Skeleton className="h-8 w-1/3" />
    </div>
  )
}
