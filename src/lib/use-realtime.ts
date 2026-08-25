import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase-client'

type RealtimeStatus = 'connecting' | 'connected' | 'disconnected'

interface TableFilter {
  table: string
  /** PostgREST 風格 filter，例如 `customer_id=eq.<uuid>`。為空字串表示全表訂閱。 */
  filter?: string
}

interface UseRealtimeOptions {
  /** 唯一頻道名稱，每個頁面用一個 */
  channelName: string
  /** 要訂閱的表（一張或多張） */
  tables: TableFilter[]
  /** 收到變動時的 callback（會經過 debounce） */
  onChange: () => void | Promise<void>
  /** debounce ms，預設 500 */
  debounceMs?: number
  /** 是否啟用（false 則不訂閱），預設 true */
  enabled?: boolean
}

/**
 * 訂閱 Supabase Realtime 變動 + 提供連線狀態 + 最後更新時間（每 30 秒自動 tick）
 */
export function useRealtimeStatus(opts: UseRealtimeOptions) {
  const { channelName, tables, onChange, debounceMs = 500, enabled = true } = opts
  const [status, setStatus] = useState<RealtimeStatus>('connecting')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [, forceTick] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const onChangeRef = useRef(onChange)
  // 保持最新的 onChange 引用，避免每次 callback 變更都重新訂閱
  onChangeRef.current = onChange

  const markUpdated = useCallback(() => setLastUpdated(new Date()), [])

  useEffect(() => {
    if (!enabled) return
    const supabase = createClient()
    let channel = supabase.channel(channelName)
    for (const t of tables) {
      channel = channel.on(
        'postgres_changes' as never,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { event: '*', schema: 'public', table: t.table, ...(t.filter ? { filter: t.filter } : {}) } as any,
        () => {
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => {
            void onChangeRef.current()
          }, debounceMs)
        }
      )
    }
    channel.subscribe((s) => {
      if (s === 'SUBSCRIBED') setStatus('connected')
      else if (s === 'CLOSED' || s === 'TIMED_OUT' || s === 'CHANNEL_ERROR') setStatus('disconnected')
      else setStatus('connecting')
    })

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      void supabase.removeChannel(channel)
    }
    // 把 tables 內容序列化進依賴；channelName 變了重新訂閱
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, JSON.stringify(tables), enabled, debounceMs])

  // 每 30 秒 tick 一次，重新算「N 分鐘前」
  useEffect(() => {
    const id = setInterval(() => forceTick(n => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  return { status, lastUpdated, markUpdated }
}

/** 把 Date 轉成「剛剛 / N 秒前 / N 分鐘前 / N 小時前」 */
export function formatRelativeTime(d: Date | null): string {
  if (!d) return '—'
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diff < 5) return '剛剛'
  if (diff < 60) return `${diff} 秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`
  return `${Math.floor(diff / 86400)} 天前`
}
