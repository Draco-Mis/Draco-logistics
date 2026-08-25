'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCw, Home } from 'lucide-react'

// (main) 區塊的錯誤邊界：任一頁 render 出錯時顯示友善畫面，而非白屏。
export default function MainError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 方便日後除錯（送到 console，未上報第三方）
    console.error('[app error]', error)
  }, [error])

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="card max-w-md w-full text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mb-4">
          <AlertTriangle className="w-7 h-7" />
        </div>
        <h1 className="text-lg font-bold text-gray-900 tracking-tight">這個頁面出了點狀況</h1>
        <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
          畫面載入時發生錯誤，你的資料沒有遺失。可以重試，或回首頁再操作一次。
        </p>
        {error?.digest && (
          <p className="text-[11px] text-gray-400 mt-2">錯誤代碼：{error.digest}</p>
        )}
        <div className="flex gap-2 justify-center mt-5">
          <button onClick={reset} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <RotateCw className="w-4 h-4" /> 重試
          </button>
          <Link href="/dashboard" className="btn-secondary text-sm inline-flex items-center gap-1.5">
            <Home className="w-4 h-4" /> 回首頁
          </Link>
        </div>
      </div>
    </div>
  )
}
