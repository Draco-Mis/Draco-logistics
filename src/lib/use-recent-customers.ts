'use client'

import { useEffect, useState } from 'react'

export interface RecentCustomer {
  id: string
  name: string
  viewed_at: string  // ISO timestamp
}

const STORAGE_KEY = 'recent-customers-v1'
const MAX = 10

function readStore(): RecentCustomer[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(x => x && typeof x.id === 'string' && typeof x.name === 'string').slice(0, MAX)
  } catch {
    return []
  }
}

function writeStore(list: RecentCustomer[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX))) } catch {/* ignore */}
}

/** 在客戶詳情頁 mount 時呼叫，把該筆紀錄推到最前面（移除舊重複） */
export function recordRecentView(id: string, name: string) {
  if (!id || !name) return
  const now = new Date().toISOString()
  const cur = readStore()
  const filtered = cur.filter(c => c.id !== id)
  const next = [{ id, name, viewed_at: now }, ...filtered].slice(0, MAX)
  writeStore(next)
  // 通知 dashboard 端 hook 更新（同 tab）
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('recent-customers-updated'))
  }
}

/** Dashboard 端 hook：回傳最新 N 筆紀錄 */
export function useRecentCustomers(limit: number = 5): RecentCustomer[] {
  const [list, setList] = useState<RecentCustomer[]>([])
  useEffect(() => {
    const sync = () => setList(readStore().slice(0, limit))
    sync()
    // 跨 tab 用 storage event，同 tab 用 custom event
    window.addEventListener('storage', sync)
    window.addEventListener('recent-customers-updated', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('recent-customers-updated', sync)
    }
  }, [limit])
  return list
}
