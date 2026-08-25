'use client'

import { PageLoading } from '@/components/ui/PageLoading'

import { useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { Customer, CustomerStatus, Team } from '@/types/database'
import {
  formatDate,
  getElapsedDays,
  getRemainingDays,
  getWarningTier,
  getTierShortLabel,
  getStatusLabel,
  cn,
} from '@/lib/utils'
import { format } from 'date-fns'

// Excel 分頁對應的課別順序
const EXCEL_TEAMS: Team[] = ['業一課', '業二課', '專案課']

// 摘要用的狀態顯示順序
const STATUS_ORDER: CustomerStatus[] = [
  'active_developing',
  'negotiating',
  'warning',
  'reactivating',
  'completed',
  'long_term',
  'abandoned',
  'locked',
]

type Scope = 'all' | 'active' | 'warning' | 'locked'

const SCOPE_LABELS: Record<Scope, string> = {
  all: '全部客戶',
  active: '只匯出開發中（含警示）',
  warning: '只匯出鎖檔前警示客戶',
  locked: '只匯出鎖檔客戶',
}

export default function ExportPage() {
  const { user } = useAuth()
  const supabase = createClient()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<Scope>('all')
  const [exporting, setExporting] = useState(false)
  const [exportingXlsx, setExportingXlsx] = useState(false)

  useEffect(() => {
    (async () => {
      // 分頁迴圈撈全部客戶（避免匯出時被 1000 筆上限截斷）
      const all: Customer[] = []
      let from = 0
      const size = 1000
      while (true) {
        // 只帶匯出用到的負責人/建檔人欄位（原本抓兩個完整 user 物件）
        const { data, error } = await supabase
          .from('customers')
          .select('*, assigned_user:users!assigned_to(chinese_name, name, team), created_by_user:users!created_by(chinese_name)')
          .order('created_date', { ascending: false })
          .range(from, from + size - 1)
        if (error) { console.error('[export] 查詢客戶失敗:', error.message); break }
        if (!data || data.length === 0) break
        all.push(...(data as unknown as Customer[]))
        if (data.length < size) break
        from += size
      }
      setCustomers(all)
      setLoading(false)
    })()
  }, [])

  // 根據 scope 過濾
  const filtered = useMemo(() => {
    switch (scope) {
      case 'active':
        return customers.filter(c => ['active_developing', 'warning', 'reactivating'].includes(c.status))
      case 'warning':
        return customers.filter(c => c.status === 'warning')
      case 'locked':
        return customers.filter(c => c.status === 'locked')
      default:
        return customers
    }
  }, [customers, scope])

  async function handleExport() {
    setExporting(true)
    try {
      const rows = filtered.map(c => {
        const tier = getWarningTier(c.created_date, c.status)
        const remaining = getRemainingDays(c.created_date, c.status)
        return {
          '公司名稱': c.company_name,
          '公司類型': c.company_code_type || '',
          '公司代號': c.company_code || '',
          '客戶等級': c.grade,
          '狀態': getStatusLabel(c.status),
          '警示層級': getTierShortLabel(tier),
          '剩餘天數': c.status === 'locked' ? '已鎖檔' : remaining,
          '建檔日期': formatDate(c.created_date),
          '最後聯絡日期': c.last_contact_date ? formatDate(c.last_contact_date) : '',
          '負責業務(中)': c.assigned_user?.chinese_name || '',
          '負責業務(英)': c.assigned_user?.name || '',
          '負責業務課別': c.assigned_user?.team || '',
          '建檔人': c.created_by_user?.chinese_name || '',
          '鎖檔時間': c.locked_at ? format(new Date(c.locked_at), 'yyyy/MM/dd HH:mm') : '',
          '鎖檔原因': c.locked_reason || '',
        }
      })

      // 用 Papa 產生 CSV，加上 UTF-8 BOM 讓 Excel 能正確顯示中文
      const csv = Papa.unparse(rows, { header: true })
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })

      // 觸發下載
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const timestamp = format(new Date(), 'yyyyMMdd_HHmm')
      a.download = `draco-crm-customers_${scope}_${timestamp}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  async function handleExportExcel() {
    setExportingXlsx(true)
    try {
      const wb = XLSX.utils.book_new()

      // 把客戶依課別分組（assigned_user.team）
      const byTeam = new Map<string, Customer[]>()
      for (const c of customers) {
        const team = c.assigned_user?.team || '未分配'
        if (!byTeam.has(team)) byTeam.set(team, [])
        byTeam.get(team)!.push(c)
      }

      // ========= 摘要分頁 =========
      const statusCounts = STATUS_ORDER.map(s => ({
        status: s,
        count: customers.filter(c => c.status === s).length,
      }))
      const aboutToLock = customers.filter(c =>
        ['active_developing', 'warning', 'reactivating'].includes(c.status)
        && getElapsedDays(c.created_date) >= 75
      ).length
      const lockedCount = customers.filter(c => c.status === 'locked').length
      const activeCount = customers.filter(c =>
        ['active_developing', 'warning', 'reactivating'].includes(c.status)
      ).length

      const summaryRows: (string | number)[][] = [
        ['登泰國際 客戶資料匯出摘要'],
        ['匯出時間', format(new Date(), 'yyyy/MM/dd HH:mm')],
        ['匯出人', user?.chinese_name || user?.name || ''],
        [],
        ['總覽'],
        ['總客戶數', customers.length],
        ['開發中（含警示、重新開發）', activeCount],
        [],
        ['狀態分佈'],
        ...statusCounts.map(({ status, count }) => [getStatusLabel(status), count]),
        [],
        ['課別分佈'],
        ...EXCEL_TEAMS.map(team => [team, byTeam.get(team)?.length ?? 0]),
        ['其他課別', Array.from(byTeam.entries())
          .filter(([t]) => !EXCEL_TEAMS.includes(t as Team))
          .reduce((sum, [, list]) => sum + list.length, 0)],
        [],
        ['鎖檔風險'],
        ['即將鎖檔（建檔 75 天以上未處理）', aboutToLock],
        ['已鎖檔', lockedCount],
      ]
      const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows)
      summaryWs['!cols'] = [{ wch: 32 }, { wch: 16 }]
      XLSX.utils.book_append_sheet(wb, summaryWs, '摘要')

      // ========= 各課別分頁 =========
      const buildTeamRows = (list: Customer[]) =>
        list.map(c => ({
          '公司名稱': c.company_name,
          '負責業務': c.assigned_user?.chinese_name || c.assigned_user?.name || '',
          '建檔日期': formatDate(c.created_date),
          '狀態': getStatusLabel(c.status),
          '等級': c.grade,
          '最後更新時間': c.last_contact_date ? formatDate(c.last_contact_date) : '—',
        }))

      for (const team of EXCEL_TEAMS) {
        const list = byTeam.get(team) || []
        const rows = buildTeamRows(list)
        const ws = rows.length > 0
          ? XLSX.utils.json_to_sheet(rows)
          : XLSX.utils.aoa_to_sheet([['（此課別目前沒有客戶資料）']])
        ws['!cols'] = [
          { wch: 32 }, { wch: 12 }, { wch: 14 },
          { wch: 12 }, { wch: 6 }, { wch: 14 },
        ]
        XLSX.utils.book_append_sheet(wb, ws, team)
      }

      // 其他課別（如：業務部、電商課、管理員等）合併到一個「其他」分頁
      const othersList = Array.from(byTeam.entries())
        .filter(([t]) => !EXCEL_TEAMS.includes(t as Team))
        .flatMap(([, list]) => list)
      if (othersList.length > 0) {
        const rows = buildTeamRows(othersList).map((row, i) => ({
          ...row,
          '課別': othersList[i].assigned_user?.team || '未分配',
        }))
        const ws = XLSX.utils.json_to_sheet(rows)
        ws['!cols'] = [
          { wch: 32 }, { wch: 12 }, { wch: 14 },
          { wch: 12 }, { wch: 6 }, { wch: 14 }, { wch: 10 },
        ]
        XLSX.utils.book_append_sheet(wb, ws, '其他')
      }

      const filename = `draco-crm-customers_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`
      XLSX.writeFile(wb, filename)
    } finally {
      setExportingXlsx(false)
    }
  }

  if (user?.role !== 'admin') {
    return <div className="p-4 text-center py-12 text-gray-400">此頁面僅限管理員使用</div>
  }

  if (loading) {
    return (
      <PageLoading />
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">匯出資料</h1>
      <p className="text-sm text-gray-500">
        將客戶資料匯出為 CSV 檔案下載，可用 Excel、Google 試算表開啟。
      </p>

      {/* 匯出範圍 */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 mb-3">匯出範圍</h2>
        <div className="space-y-2">
          {(Object.entries(SCOPE_LABELS) as [Scope, string][]).map(([val, label]) => {
            const count =
              val === 'all' ? customers.length
                : val === 'active' ? customers.filter(c => ['active_developing', 'warning', 'reactivating'].includes(c.status)).length
                : val === 'warning' ? customers.filter(c => c.status === 'warning').length
                : customers.filter(c => c.status === 'locked').length
            return (
              <label
                key={val}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition',
                  scope === val
                    ? 'border-primary-600 bg-primary-50'
                    : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <input
                  type="radio"
                  name="scope"
                  value={val}
                  checked={scope === val}
                  onChange={() => setScope(val)}
                  className="w-4 h-4 text-primary-600"
                />
                <span className="flex-1 text-sm font-medium text-gray-800">{label}</span>
                <span className="text-sm text-gray-500">{count} 筆</span>
              </label>
            )
          })}
        </div>
      </div>

      {/* 欄位說明 */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 mb-2">匯出欄位</h2>
        <p className="text-xs text-gray-500 mb-2">共 15 個欄位</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">
          <span>• 公司名稱</span>
          <span>• 公司類型</span>
          <span>• 公司代號</span>
          <span>• 客戶等級</span>
          <span>• 狀態</span>
          <span>• 警示層級</span>
          <span>• 剩餘天數</span>
          <span>• 建檔日期</span>
          <span>• 最後聯絡日期</span>
          <span>• 負責業務(中)</span>
          <span>• 負責業務(英)</span>
          <span>• 負責業務課別</span>
          <span>• 建檔人</span>
          <span>• 鎖檔時間</span>
          <span>• 鎖檔原因</span>
        </div>
      </div>

      {/* 下載按鈕 */}
      <button
        onClick={handleExport}
        disabled={exporting || filtered.length === 0}
        className="btn-primary w-full py-3 text-base"
      >
        {exporting
          ? '準備下載中...'
          : filtered.length === 0
            ? '此範圍沒有資料'
            : `⬇️ 下載 CSV（${filtered.length} 筆，依上方範圍）`}
      </button>

      <p className="text-xs text-gray-400 text-center">
        檔案以 UTF-8 with BOM 編碼，Excel 可正常顯示中文
      </p>

      {/* Excel 多分頁匯出 */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 mb-2">匯出 Excel（多分頁）</h2>
        <p className="text-xs text-gray-500 mb-3">
          匯出全部客戶為 .xlsx 檔，依課別分頁（業一課／業二課／專案課／其他），並附摘要統計。<br />
          欄位：公司名稱、負責業務、建檔日期、狀態、等級、最後更新時間（= 最後聯絡日期）。
        </p>
        <button
          onClick={handleExportExcel}
          disabled={exportingXlsx || customers.length === 0}
          className="btn-primary w-full py-3 text-base"
        >
          {exportingXlsx
            ? '產生 Excel 中...'
            : customers.length === 0
              ? '沒有客戶資料'
              : `⬇️ 下載 Excel（全部 ${customers.length} 筆，依課別分頁）`}
        </button>
      </div>
    </div>
  )
}
