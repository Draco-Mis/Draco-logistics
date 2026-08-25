'use client'

import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'

interface EmptyStateProps {
  icon?: LucideIcon
  emoji?: string
  title: string
  description?: string
  actionHref?: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({ icon: Icon, emoji, title, description, actionHref, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="text-center py-12 px-6">
      <div className="mx-auto w-16 h-16 mb-4 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center text-3xl text-gray-400 ring-1 ring-gray-200">
        {emoji ? emoji : Icon ? <Icon className="w-8 h-8" strokeWidth={1.5} /> : '📭'}
      </div>
      <h3 className="text-base font-semibold text-gray-900 tracking-tight mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">{description}</p>}
      {(actionHref || onAction) && actionLabel && (
        <div className="mt-5">
          {actionHref ? (
            <Link href={actionHref} className="btn-primary text-sm inline-flex items-center gap-1.5">
              {actionLabel}
            </Link>
          ) : (
            <button onClick={onAction} className="btn-primary text-sm">{actionLabel}</button>
          )}
        </div>
      )}
    </div>
  )
}
