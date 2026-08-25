'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, XCircle, Info, X, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToastType = 'success' | 'error' | 'info'

interface ToastOptions {
  actionLabel?: string
  onAction?: () => void
  durationMs?: number
}

interface ToastItem {
  id: number
  type: ToastType
  message: string
  actionLabel?: string
  onAction?: () => void
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, options?: ToastOptions) => void
  success: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
  success: () => {},
  error: () => {},
})

const ICONS: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
}

const STYLES: Record<ToastType, string> = {
  success: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  error: 'text-red-600 bg-red-50 border-red-200',
  info: 'text-accent-700 bg-accent-50 border-accent-200',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const idRef = useRef(0)

  const remove = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((message: string, type: ToastType = 'info', options?: ToastOptions) => {
    const id = ++idRef.current
    setItems(prev => [...prev, { id, type, message, actionLabel: options?.actionLabel, onAction: options?.onAction }])
    // 有動作（如「復原」）時停留久一點
    const dur = options?.durationMs ?? (options?.onAction ? 6000 : type === 'error' ? 5000 : 3000)
    setTimeout(() => remove(id), dur)
  }, [remove])

  const success = useCallback((m: string, o?: ToastOptions) => toast(m, 'success', o), [toast])
  const error = useCallback((m: string, o?: ToastOptions) => toast(m, 'error', o), [toast])

  return (
    <ToastContext.Provider value={{ toast, success, error }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-[calc(100vw-2rem)] w-80 pointer-events-none">
        {items.map(t => {
          const Icon = ICONS[t.type]
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                'pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-card animate-scale-in',
                STYLES[t.type],
              )}
            >
              <Icon className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug break-words">{t.message}</p>
                {t.actionLabel && t.onAction && (
                  <button
                    onClick={() => { t.onAction?.(); remove(t.id) }}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold underline underline-offset-2 hover:opacity-80"
                  >
                    <Undo2 className="w-3.5 h-3.5" /> {t.actionLabel}
                  </button>
                )}
              </div>
              <button
                onClick={() => remove(t.id)}
                className="shrink-0 opacity-50 hover:opacity-100 transition"
                aria-label="關閉通知"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
