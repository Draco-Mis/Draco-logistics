import { SkeletonListItem } from '@/components/ui/Skeleton'

// 頁面載入骨架屏：統一各頁的載入外觀（取代原本的置中轉圈）
export function PageLoading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-2">
      <div className="h-8 w-40 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse mb-4" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card"><SkeletonListItem /></div>
      ))}
    </div>
  )
}
