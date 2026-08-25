'use client'

import { useEffect, useState } from 'react'

export interface StockMatch {
  code: string
  name: string
  shortName: string
  type: '上市' | '上櫃'
}

// 輸入公司名稱，自動從 TWSE/TPEx 比對上市櫃代號
// debounce 500ms，避免打字時連續呼叫
export function useStockLookup(companyName: string) {
  const [matches, setMatches] = useState<StockMatch[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const q = companyName.trim()
    if (q.length < 2) {
      setMatches([])
      return
    }

    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/stock-lookup?q=${encodeURIComponent(q)}`)
        if (resp.ok) {
          const data = await resp.json()
          setMatches(data)
        }
      } catch {
        // 查詢失敗不影響使用
      }
      setLoading(false)
    }, 500)

    return () => clearTimeout(timer)
  }, [companyName])

  return { matches, loading }
}
