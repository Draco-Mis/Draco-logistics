// 輕量彩帶：純 DOM + CSS，無外部套件。成交等慶祝時刻呼叫 fireConfetti()。
// 尊重 prefers-reduced-motion：直接略過。
export function fireConfetti(count = 80) {
  if (typeof window === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

  const colors = ['#36a3ff', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4']
  const root = document.createElement('div')
  root.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:200;overflow:hidden'
  document.body.appendChild(root)

  // 動態插入 keyframes（只插一次）
  if (!document.getElementById('confetti-kf')) {
    const style = document.createElement('style')
    style.id = 'confetti-kf'
    style.textContent =
      '@keyframes confetti-fall{0%{transform:translateY(-10vh) rotate(0);opacity:1}' +
      '100%{transform:translateY(110vh) rotate(720deg);opacity:0}}'
    document.head.appendChild(style)
  }

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div')
    const size = 6 + Math.floor(Math.random() * 8)
    const left = Math.random() * 100
    const delay = Math.random() * 250
    const dur = 1600 + Math.random() * 1400
    const color = colors[i % colors.length]
    const round = Math.random() > 0.5
    p.style.cssText =
      `position:absolute;top:-10vh;left:${left}vw;width:${size}px;height:${size * (round ? 1 : 1.6)}px;` +
      `background:${color};border-radius:${round ? '50%' : '2px'};` +
      `animation:confetti-fall ${dur}ms cubic-bezier(0.2,0.6,0.4,1) ${delay}ms forwards`
    root.appendChild(p)
  }

  setTimeout(() => root.remove(), 3400)
}
