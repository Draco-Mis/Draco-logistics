'use client'

import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { APP_VERSION, currentChangelog } from '@/lib/changelog'

const STORAGE_KEY = 'draco:whatsnew-seen'

// 登入後「更新公告」：第一次看到新版本會自動跳出；
// 也可由側邊欄的版本徽章手動觸發（監聽 window 'open-whatsnew' 事件）。
export function WhatsNew() {
  const [open, setOpen] = useState(false)
  const entry = currentChangelog()

  useEffect(() => {
    // 自動：尚未看過此版本 → 跳出
    let seen: string | null = null
    try { seen = localStorage.getItem(STORAGE_KEY) } catch {/* ignore */}
    if (seen !== APP_VERSION) setOpen(true)

    // 手動：其他元件 dispatch 'open-whatsnew' 時開啟
    const handler = () => setOpen(true)
    window.addEventListener('open-whatsnew', handler)
    return () => window.removeEventListener('open-whatsnew', handler)
  }, [])

  function close() {
    try { localStorage.setItem(STORAGE_KEY, APP_VERSION) } catch {/* ignore */}
    // 通知其他元件（版本徽章）更新「已看過」狀態
    window.dispatchEvent(new Event('whatsnew-seen'))
    setOpen(false)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[115] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-fade-in"
      onClick={close}
    >
      <div
        className="card w-full max-w-md max-h-[85vh] overflow-y-auto animate-scale-in p-0"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* 標題區 */}
        <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-accent-500 to-accent-700 text-white rounded-t-2xl">
          <button
            onClick={close}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/15 transition"
            aria-label="關閉"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 text-white/90 text-xs font-medium mb-1">
            <Sparkles className="w-4 h-4" /> 系統更新
          </div>
          <h2 className="text-xl font-bold tracking-tight">{entry.label}</h2>
          <p className="text-white/80 text-sm mt-0.5">以下是這次的新功能與改進</p>
        </div>

        {/* 更新項目 */}
        <div className="p-4 space-y-1">
          {entry.items.map((it, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded-xl hover:bg-gray-50 transition animate-fade-in-up"
              style={{ animationDelay: `${i * 45}ms`, animationFillMode: 'both' }}
            >
              <span className="text-xl shrink-0 leading-none mt-0.5">{it.emoji}</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900">{it.title}</div>
                <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{it.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 pb-4 pt-1">
          <button onClick={close} className="btn-primary w-full text-sm">開始使用</button>
        </div>
      </div>
    </div>
  )
}
