'use client'

import { useEffect, useRef, useState } from 'react'

// 數字跳動：從 0 動畫到目標值。用於儀表板統計卡。
// 尊重 prefers-reduced-motion：直接顯示最終值。
export function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = useState(target)
  const startedRef = useRef(false)

  useEffect(() => {
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce || target <= 0) { setValue(target); return }

    startedRef.current = true
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(eased * target))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    setValue(0)
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])

  return value
}
