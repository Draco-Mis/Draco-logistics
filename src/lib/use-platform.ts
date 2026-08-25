'use client'

import { useEffect, useState } from 'react'

/**
 * 偵測使用者作業系統，給對應的快捷鍵顯示符號
 * Mac → ⌘K
 * Windows / Linux → Ctrl+K
 */
export function useShortcutKey(): string {
  const [key, setKey] = useState<string>('Ctrl+K')
  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) || /Mac/i.test(navigator.platform)
    setKey(isMac ? '⌘K' : 'Ctrl+K')
  }, [])
  return key
}

/** 只取符號版本：⌘ 或 Ctrl */
export function useModKey(): string {
  const [key, setKey] = useState<string>('Ctrl')
  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) || /Mac/i.test(navigator.platform)
    setKey(isMac ? '⌘' : 'Ctrl')
  }, [])
  return key
}
