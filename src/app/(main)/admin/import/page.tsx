'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import type { Customer, User } from '@/types/database'
import { parseFile, recomputeRowErrors, type ParsedRow } from '@/lib/customer-import'
import { cn } from '@/lib/utils'

type Decision = 'skip' | 'overwrite'
type Step = 1 | 2 | 3 | 'done'

const FIELDS_TO_OVERWRITE = ['assigned_to', 'industry', 'created_date'] as const

export default function ImportPage() {
  const { user } = useAuth()
  const supabase = createClient()

  const [users, setUsers] = useState<User[]>([])
  const [existing, setExisting] = useState<Map<string, Customer>>(new Map())

  const [step, setStep] = useState<Step>(1)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [decisions, setDecisions] = useState<Record<number, Decision>>({})
  const [dragOver, setDragOver] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [markAsCompleted, setMarkAsCompleted] = useState(false)
  const [result, setResult] = useState<{ inserted: number; updated: number; skipped: number; failed: number } | null>(null)

  useEffect(() => {
    supabase.from('users').select('*').then(({ data }) => {
      if (data) setUsers(data)
    })
    // 分頁迴圈撈全部既有客戶供衝突檢查（避免 1000 筆上限導致衝突誤判）
    ;(async () => {
      const m = new Map<string, Customer>()
      let from = 0
      const size = 1000
      while (true) {
        const { data } = await supabase
          .from('customers')
          .select('id, company_name, assigned_to, industry, created_date, status, grade, created_by, last_contact_date, locked_at, locked_reason, company_code, company_code_type')
          .range(from, from + size - 1)
        if (!data || data.length === 0) break
        for (const c of data as Customer[]) {
          m.set(c.company_name.trim().toLowerCase(), c)
        }
        if (data.length < size) break
        from += size
      }
      setExisting(m)
    })()
  }, [])

  // --- Step 1：上傳 + 解析 ---

  async function handleFile(file: File) {
    setParseError(null)
    setRows([])
    setDecisions({})
    setParsing(true)
    try {
      const r = await parseFile(file, users)
      setRows(r.rows)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : '解析失敗')
    } finally {
      setParsing(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  // 在預覽表格中手動指定業務員
  function setSales(rowIdx: number, userId: string) {
    setRows(prev => prev.map((r, i) => {
      if (i !== rowIdx) return r
      const u = users.find(x => x.id === userId)
      return recomputeRowErrors({
        ...r,
        sales_id: userId || null,
        sales_input: u ? (u.chinese_name || u.name) : r.sales_input,
      })
    }))
  }

  const validRows = useMemo(() => rows.filter(r => r.errors.length === 0), [rows])

  // --- Step 2：衝突計算 ---

  const conflicts = useMemo(() => {
    return validRows
      .map((row, idxInValid) => {
        const ex = existing.get(row.company_name.trim().toLowerCase())
        if (!ex) return null
        return { row, existing: ex, indexInValid: idxInValid }
      })
      .filter((x): x is { row: ParsedRow; existing: Customer; indexInValid: number } => x !== null)
  }, [validRows, existing])

  function goToStep2() {
    // 衝突列預設「跳過」
    const init: Record<number, Decision> = {}
    for (const c of conflicts) init[c.indexInValid] = 'skip'
    setDecisions(init)
    setStep(2)
  }

  function setAllDecisions(d: Decision) {
    const next: Record<number, Decision> = {}
    conflicts.forEach(c => { next[c.indexInValid] = d })
    setDecisions(next)
  }

  // --- Step 3：摘要 + 匯入 ---

  const summary = useMemo(() => {
    let toInsert = 0
    let toUpdate = 0
    let toSkip = 0
    validRows.forEach((row, i) => {
      const ex = existing.get(row.company_name.trim().toLowerCase())
      if (!ex) toInsert++
      else if (decisions[i] === 'overwrite') toUpdate++
      else toSkip++
    })
    return { toInsert, toUpdate, toSkip, totalRows: rows.length, invalid: rows.length - validRows.length }
  }, [validRows, existing, decisions, rows.length])

  async function doImport() {
    if (!user) return
    setImporting(true)
    let inserted = 0
    let updated = 0
    let skipped = summary.toSkip
    let failed = 0

    const inserts: Record<string, unknown>[] = []
    const updates: { id: string; data: Record<string, unknown> }[] = []

    const today = new Date().toISOString().split('T')[0]
    validRows.forEach((row, i) => {
      const ex = existing.get(row.company_name.trim().toLowerCase())
      const payload: Record<string, unknown> = {
        assigned_to: row.sales_id,
        industry: row.industry,
        created_date: row.created_date,
      }
      if (!ex) {
        inserts.push({
          ...payload,
          company_name: row.company_name,
          grade: 'C',
          status: markAsCompleted ? 'completed' : 'active_developing',
          created_by: user.id,
        })
      } else if (decisions[i] === 'overwrite') {
        if (markAsCompleted) {
          // 批次標記已成交：強制 status=completed，繞過重設倒數邏輯
          updates.push({
            id: ex.id,
            data: { ...payload, status: 'completed', locked_at: null, locked_reason: null },
          })
        } else {
          // 業務員變動 → 重設 90 天倒數、狀態回 reactivating、清掉鎖檔
          const reassigning = row.sales_id !== ex.assigned_to
          const data = reassigning
            ? {
                ...payload,
                created_date: today,
                status: 'reactivating',
                locked_at: null,
                locked_reason: null,
              }
            : payload
          updates.push({ id: ex.id, data })
        }
      }
    })

    // 批次 insert（若為「整批已成交」，鏈接 select 取回新 ID 以便寫 history）
    const insertedIds: string[] = []
    if (inserts.length > 0) {
      if (markAsCompleted) {
        const { data: insertedData, error } = await supabase
          .from('customers')
          .insert(inserts)
          .select('id')
        if (error) failed += inserts.length
        else {
          inserted = inserts.length
          if (insertedData) insertedIds.push(...insertedData.map(c => c.id))
        }
      } else {
        const { error } = await supabase.from('customers').insert(inserts)
        if (error) failed += inserts.length
        else inserted = inserts.length
      }
    }

    // 逐筆 update（沒有 unique constraint，無法用 upsert）
    const updatedIds: string[] = []
    for (const u of updates) {
      const { error } = await supabase.from('customers').update(u.data).eq('id', u.id)
      if (error) failed++
      else {
        updated++
        updatedIds.push(u.id)
      }
    }

    // 標記已成交時寫 history 稽核（新增 + 覆蓋 都寫）
    if (markAsCompleted) {
      const historyEntries = [...insertedIds, ...updatedIds].map(customerId => ({
        customer_id: customerId,
        action_type: 'mark_completed',
        action_by: user.id,
        note: '匯入時批次標記為已成交',
      }))
      if (historyEntries.length > 0) {
        await supabase.from('customer_history').insert(historyEntries)
      }
    }

    setResult({ inserted, updated, skipped, failed })
    setImporting(false)
    setStep('done')
  }

  function reset() {
    setStep(1)
    setRows([])
    setDecisions({})
    setResult(null)
    setParseError(null)
    setMarkAsCompleted(false)
  }

  if (user?.role !== 'admin') {
    return <div className="p-4 text-center py-12 text-gray-400">您沒有權限查看此頁面</div>
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight dark:text-gray-100 mb-1">客戶匯入</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">支援 .xlsx、.xls、.csv，自動辨識欄位並比對既有客戶</p>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        {[
          { n: 1, label: '上傳 / 預覽' },
          { n: 2, label: '衝突檢查' },
          { n: 3, label: '確認匯入' },
        ].map(({ n, label }, i) => (
          <div key={n} className="flex items-center gap-2">
            <span className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center font-medium',
              step === n || step === 'done' && n === 3
                ? 'bg-primary-600 text-white'
                : (typeof step === 'number' && step > n)
                  ? 'bg-primary-200 text-primary-800'
                  : 'bg-gray-200 text-gray-500'
            )}>{n}</span>
            <span className={cn(
              step === n ? 'font-medium text-gray-900 dark:text-gray-100' : 'text-gray-500'
            )}>{label}</span>
            {i < 2 && <span className="text-gray-300 mx-1">→</span>}
          </div>
        ))}
      </div>

      {/* === Step 1：上傳 + 預覽 === */}
      {step === 1 && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cn(
              'card mb-4 border-2 border-dashed transition',
              dragOver ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-300 dark:border-gray-700'
            )}
          >
            <div className="text-center py-6">
              <p className="text-gray-600 dark:text-gray-300 mb-2">
                {dragOver ? '放開以上傳檔案' : '拖曳檔案到此處，或點擊下方按鈕選擇'}
              </p>
              <p className="text-xs text-gray-400 mb-4">支援 .xlsx、.xls、.csv</p>
              <label className="btn-primary cursor-pointer inline-block">
                選擇檔案
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f)
                    e.target.value = ''
                  }}
                />
              </label>
              {parsing && <p className="text-sm text-gray-500 mt-3">解析中...</p>}
              {parseError && <p className="text-sm text-red-500 mt-3">⚠️ {parseError}</p>}
            </div>
          </div>

          {rows.length > 0 && (
            <div className="card mb-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <h2 className="font-bold text-gray-900 dark:text-gray-100">預覽（共 {rows.length} 筆）</h2>
                  <p className="text-xs text-gray-500 mt-1">
                    有效 {validRows.length} 筆
                    {rows.length - validRows.length > 0 && (
                      <span className="text-red-500 ml-2">需修正 {rows.length - validRows.length} 筆</span>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={reset} className="btn-secondary text-sm">重新選擇</button>
                  <button
                    onClick={goToStep2}
                    disabled={validRows.length === 0}
                    className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    下一步：衝突檢查
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[28rem] overflow-y-auto -mx-2">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                    <tr>
                      <th className="text-left p-2 w-12">#</th>
                      <th className="text-left p-2">公司名稱</th>
                      <th className="text-left p-2">業務員</th>
                      <th className="text-left p-2">產業</th>
                      <th className="text-left p-2">建檔日期</th>
                      <th className="text-left p-2">狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const hasError = r.errors.length > 0
                      return (
                        <tr key={i} className={cn(
                          'border-t dark:border-gray-700',
                          hasError && 'bg-red-50 dark:bg-red-900/10'
                        )}>
                          <td className="p-2 text-gray-400">{r.rowNumber}</td>
                          <td className={cn('p-2', !r.company_name && 'text-red-500')}>
                            {r.company_name || <span className="italic">（缺）</span>}
                          </td>
                          <td className="p-2">
                            {r.sales_id ? (
                              <span>{r.sales_input}</span>
                            ) : (
                              <select
                                value=""
                                onChange={(e) => setSales(i, e.target.value)}
                                className="input-field text-xs py-1 px-2 border-red-400"
                              >
                                <option value="">⚠️ 選擇業務員（{r.sales_input || '空'}）</option>
                                {users.map(u => (
                                  <option key={u.id} value={u.id}>
                                    {u.chinese_name || u.name}（{u.team || '—'}）
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="p-2">
                            {r.industry ? (
                              <span>{r.industry}</span>
                            ) : r.industry_input ? (
                              <span className="text-yellow-600" title={`原始：${r.industry_input}`}>
                                未對應（{r.industry_input}）
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="p-2 text-gray-600 dark:text-gray-300">{r.created_date}</td>
                          <td className="p-2">
                            {hasError ? (
                              <span className="text-red-500 text-xs">{r.errors.join('；')}</span>
                            ) : (
                              <span className="text-green-600 text-xs">✓</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* === Step 2：衝突檢查 === */}
      {step === 2 && (
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h2 className="font-bold text-gray-900 dark:text-gray-100">衝突檢查</h2>
              <p className="text-xs text-gray-500 mt-1">
                {conflicts.length === 0
                  ? '沒有衝突，所有有效列都會新增'
                  : `${conflicts.length} 筆公司名稱已存在，請選擇處理方式`}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setStep(1)} className="btn-secondary text-sm">上一步</button>
              {conflicts.length > 0 && (
                <>
                  <button onClick={() => setAllDecisions('skip')} className="btn-secondary text-sm">全部跳過</button>
                  <button onClick={() => setAllDecisions('overwrite')} className="btn-secondary text-sm">全部覆蓋</button>
                </>
              )}
              <button onClick={() => setStep(3)} className="btn-primary text-sm">下一步：確認匯入</button>
            </div>
          </div>

          {conflicts.length > 0 && (
            <div className="space-y-3 max-h-[32rem] overflow-y-auto">
              {conflicts.map(({ row, existing: ex, indexInValid }) => {
                const decision = decisions[indexInValid] ?? 'skip'
                const exSales = users.find(u => u.id === ex.assigned_to)
                const newSales = users.find(u => u.id === row.sales_id)
                return (
                  <div key={indexInValid} className={cn(
                    'border rounded-lg p-3 transition',
                    decision === 'overwrite'
                      ? 'border-orange-400 bg-orange-50 dark:bg-orange-900/10'
                      : 'border-gray-200 dark:border-gray-700'
                  )}>
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                      <h3 className="font-medium">{row.company_name}</h3>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setDecisions(d => ({ ...d, [indexInValid]: 'skip' }))}
                          className={cn(
                            'px-3 py-1 text-xs rounded transition',
                            decision === 'skip'
                              ? 'bg-gray-700 text-white'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 hover:bg-gray-200'
                          )}
                        >跳過</button>
                        <button
                          onClick={() => setDecisions(d => ({ ...d, [indexInValid]: 'overwrite' }))}
                          className={cn(
                            'px-3 py-1 text-xs rounded transition',
                            decision === 'overwrite'
                              ? 'bg-orange-500 text-white'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 hover:bg-gray-200'
                          )}
                        >覆蓋更新</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="border rounded p-2 dark:border-gray-700">
                        <div className="text-gray-400 mb-1">📥 檔案資料（新）</div>
                        <div>業務員：{newSales ? (newSales.chinese_name || newSales.name) : '—'}</div>
                        <div>產業：{row.industry ?? '（未對應）'}</div>
                        <div>建檔：{row.created_date}</div>
                      </div>
                      <div className="border rounded p-2 dark:border-gray-700">
                        <div className="text-gray-400 mb-1">📁 資料庫（既有）</div>
                        <div>業務員：{exSales ? (exSales.chinese_name || exSales.name) : '—'}</div>
                        <div>產業：{ex.industry ?? '—'}</div>
                        <div>建檔：{ex.created_date}</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* === Step 3：確認 === */}
      {step === 3 && (
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="font-bold text-gray-900 dark:text-gray-100">確認匯入</h2>
            <div className="flex gap-2">
              <button onClick={() => setStep(2)} className="btn-secondary text-sm" disabled={importing}>上一步</button>
              <button
                onClick={doImport}
                disabled={importing || (summary.toInsert + summary.toUpdate === 0)}
                className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {importing ? '匯入中...' : '確認匯入'}
              </button>
            </div>
          </div>

          <label className={cn(
            'flex items-start gap-3 p-3 mb-4 rounded-lg border cursor-pointer transition',
            markAsCompleted
              ? 'border-green-400 bg-green-50 dark:bg-green-900/10'
              : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
          )}>
            <input
              type="checkbox"
              checked={markAsCompleted}
              onChange={(e) => setMarkAsCompleted(e.target.checked)}
              disabled={importing}
              className="mt-0.5"
            />
            <div className="text-sm">
              <div className="font-medium text-gray-900 dark:text-gray-100">
                這批客戶全部標記為已成交（status = completed）
              </div>
              <div className="text-xs text-gray-500 mt-1">
                勾選後：新增的客戶會直接設為「已成交」狀態，不受 90 天倒數限制；覆蓋既有客戶時也會強制改為已成交。會在 customer_history 留下 mark_completed 稽核紀錄。
              </div>
            </div>
          </label>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryBox label="新增" value={summary.toInsert} color="text-green-600" />
            <SummaryBox label="更新" value={summary.toUpdate} color="text-orange-600" />
            <SummaryBox label="跳過（衝突）" value={summary.toSkip} color="text-gray-500" />
            <SummaryBox label="無效（已排除）" value={summary.invalid} color="text-red-500" />
          </div>

          {summary.toInsert + summary.toUpdate === 0 && (
            <p className="text-sm text-gray-500 mt-3">沒有要寫入的資料。</p>
          )}
        </div>
      )}

      {/* === Done === */}
      {step === 'done' && result && (
        <div className="card bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800 mb-4">
          <h2 className="font-bold text-green-800 dark:text-green-300 mb-2">匯入完成</h2>
          <p className="text-sm text-green-700 dark:text-green-400 mb-3">
            新增 {result.inserted} · 更新 {result.updated} · 跳過 {result.skipped}
            {result.failed > 0 && <span className="text-red-600 ml-2">· 失敗 {result.failed}</span>}
          </p>
          <button onClick={reset} className="btn-primary text-sm">再匯入一批</button>
        </div>
      )}
    </div>
  )
}

function SummaryBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="border rounded-lg p-3 text-center dark:border-gray-700">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={cn('text-2xl font-bold', color)}>{value}</div>
    </div>
  )
}
