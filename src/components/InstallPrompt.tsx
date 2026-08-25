'use client'

import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'draco:install-dismissed'

// 「加入主畫面」引導：瀏覽器可安裝 PWA 時，底部跳出可關閉的提示。
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    let dismissed = false
    try { dismissed = localStorage.getItem(DISMISS_KEY) === '1' } catch {/* ignore */}
    if (dismissed) return

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch {/* ignore */}
    setShow(false)
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice.catch(() => {})
    dismiss()
  }

  if (!show) return null

  return (
    <div className="fixed bottom-20 md:bottom-4 left-1/2 -translate-x-1/2 z-[90] w-[calc(100%-2rem)] max-w-sm animate-fade-in-up">
      <div className="card flex items-center gap-3 shadow-card-hover">
        <div className="w-10 h-10 rounded-xl bg-accent-50 text-accent-600 flex items-center justify-center shrink-0">
          <Download className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">把 Draco LOP 加到主畫面</p>
          <p className="text-xs text-gray-500">像 App 一樣一鍵開啟、全螢幕使用。</p>
        </div>
        <button onClick={install} className="btn-primary text-xs shrink-0">加入</button>
        <button onClick={dismiss} className="p-1.5 text-gray-400 hover:text-gray-600 shrink-0" aria-label="關閉">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
