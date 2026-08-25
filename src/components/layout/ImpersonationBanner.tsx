'use client'

import { useAuth } from '@/lib/auth-context'
import { getRoleLabel } from '@/lib/utils'

export default function ImpersonationBanner() {
  const { viewingAs, realUser, stopImpersonation } = useAuth()
  if (!viewingAs || !realUser) return null

  const roleLabel = getRoleLabel(viewingAs.role)
  const teamLabel = viewingAs.team || ''
  const inactive = viewingAs.is_active === false

  return (
    <div className="sticky top-0 z-[60] bg-orange-500 text-white text-sm shadow-md">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">👁</span>
          <div className="min-w-0">
            <span className="font-bold">偽裝中</span>
            <span className="opacity-90 ml-2 truncate">
              以 <span className="font-bold">{viewingAs.chinese_name}</span>
              <span className="opacity-80 ml-1">（{[roleLabel, teamLabel].filter(Boolean).join(' · ')}）</span>
              {inactive && <span className="ml-2 bg-red-700 text-white px-1.5 rounded text-xs">已離職</span>}
              <span className="opacity-80"> 的視角檢視</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="hidden sm:inline opacity-80 text-xs">
            實際登入：{realUser.chinese_name}
          </span>
          <button
            onClick={stopImpersonation}
            className="bg-white text-orange-700 hover:bg-orange-50 font-bold px-3 py-1 rounded text-xs"
          >
            ✕ 退出偽裝
          </button>
        </div>
      </div>
      <div className="bg-orange-600 text-center text-xs py-0.5 opacity-90">
        僅 UI 視角：選單與按鈕按對方權限顯示，但資料庫操作仍以你本人身份執行
      </div>
    </div>
  )
}
