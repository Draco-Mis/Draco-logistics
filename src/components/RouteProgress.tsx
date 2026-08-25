'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

// 頂部路由載入進度條：點站內連結時開始跑，換頁完成時填滿並淡出。
// 純視覺「秒回」感受，無外部套件。
export function RouteProgress() {
  const pathname = usePathname()
  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  function clearTimers() {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  // 點到站內連結 → 啟動進度（快速衝到 ~80% 再緩慢爬）
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement)?.closest('a')
      if (!a) return
      const href = a.getAttribute('href')
      if (!href || !href.startsWith('/') || a.target === '_blank') return
      if (href === pathname) return
      clearTimers()
      setVisible(true)
      setWidth(8)
      timers.current.push(setTimeout(() => setWidth(45), 50))
      timers.current.push(setTimeout(() => setWidth(80), 250))
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [pathname])

  // 換頁完成 → 填滿並淡出
  useEffect(() => {
    if (!visible) return
    setWidth(100)
    const t1 = setTimeout(() => setVisible(false), 250)
    const t2 = setTimeout(() => setWidth(0), 500)
    return () => { clearTimeout(t1); clearTimeout(t2) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return (
    <div className="fixed top-0 left-0 right-0 z-[120] h-0.5 pointer-events-none">
      <div
        className="h-full bg-accent-500 shadow-[0_0_8px_rgba(54,163,255,0.6)] transition-all duration-200 ease-out"
        style={{ width: `${width}%`, opacity: visible ? 1 : 0 }}
      />
    </div>
  )
}
