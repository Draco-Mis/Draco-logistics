'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Users, Search, Edit3, X, Check, BarChart3, UserPlus, Trash2, AlertTriangle, UserMinus, Undo2 } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase-client'
import {
  useEmployees, computeCategoryCounts, getAllCategoryKeys, getAllCategoriesMeta,
} from '@/lib/employees'
import type { Employee, EmployeeCategory } from '@/types/employee'
import { cn } from '@/lib/utils'
import { BigFiveRadarMulti } from '@/components/BigFiveRadar'
import { useToast } from '@/components/ui/Toast'
import type { BigFiveScores } from '@/types/bigfive'

const CATEGORY_COLORS: Record<EmployeeCategory, string> = {
  chairman: 'bg-purple-50 text-purple-700 ring-purple-200',
  department_head: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  section_head: 'bg-accent-50 text-accent-700 ring-accent-200',
  deputy_section_head: 'bg-sky-50 text-sky-700 ring-sky-200',
  supervisor: 'bg-teal-50 text-teal-700 ring-teal-200',
  project_lead: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  operations: 'bg-amber-50 text-amber-700 ring-amber-200',
  sales: 'bg-rose-50 text-rose-700 ring-rose-200',
  staff: 'bg-gray-100 text-gray-700 ring-gray-200',
}

export default function EmployeesPage() {
  const { user } = useAuth()
  const canView = !!user && (
    ['admin', 'chairman', 'director', 'hr'].includes(user.role) || user.team === '財管部'
  )

  const { employees, loading, error, setEmployees } = useEmployees()
  const supabase = createClient()
  const toast = useToast()
  const categoriesMeta = getAllCategoriesMeta()
  const allCategoryKeys = getAllCategoryKeys()

  const [view, setView] = useState<'active' | 'resigned'>('active')
  const [categoryFilter, setCategoryFilter] = useState<EmployeeCategory | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [editEnglish, setEditEnglish] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editUnit, setEditUnit] = useState('')
  const [editCategory, setEditCategory] = useState<EmployeeCategory>('staff')
  const [historyEmp, setHistoryEmp] = useState<Employee | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<Employee | null>(null)
  const [archiving, setArchiving] = useState(false)

  // 在職 / 離職 兩份清單
  const activeList = useMemo(() => employees.filter(e => !e.resigned_at), [employees])
  const resignedList = useMemo(() => employees.filter(e => !!e.resigned_at), [employees])
  const viewList = view === 'active' ? activeList : resignedList

  const counts = useMemo(() => computeCategoryCounts(viewList), [viewList])

  const filtered = useMemo(() => {
    let list = viewList
    if (categoryFilter !== 'all') {
      list = list.filter(e => e.category === categoryFilter)
    }
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter(e =>
        e.name.includes(q) ||
        e.english.toLowerCase().includes(q) ||
        e.title.includes(q) ||
        e.unit.includes(q),
      )
    }
    return list
  }, [viewList, categoryFilter, searchQuery])

  // 職稱建議選項：本次要新增的 4 個 + 名冊中已存在的職稱（去重）
  const titleSuggestions = useMemo(() => {
    const preset = ['專案課長', '專案副理', 'ＯＰ', '副課長']
    const existing = employees.map(e => e.title?.trim()).filter(Boolean) as string[]
    return Array.from(new Set([...preset, ...existing]))
  }, [employees])

  // 單位建議選項：常見部門 + 名冊中已存在的單位（去重）
  const unitSuggestions = useMemo(() => {
    const preset = ['業務部', '物流一部', '物流二部', '報關部', '財管部', '電商課', '專案課', '副總', '管理部']
    const existing = employees.map(e => e.unit?.trim()).filter(Boolean) as string[]
    return Array.from(new Set([...preset, ...existing]))
  }, [employees])

  function startEdit(emp: Employee) {
    if (!emp.id) return
    setEditEnglish(emp.english)
    setEditTitle(emp.title)
    setEditUnit(emp.unit)
    setEditCategory(emp.category)
    setEditingId(emp.id)
  }

  async function saveEmployee(emp: Employee) {
    if (!emp.id) return
    const newEnglish = editEnglish.trim()
    const newTitle = editTitle.trim()
    const newUnit = editUnit.trim()
    const newCategory = editCategory
    // 沒有變更就直接收起
    if (newEnglish === emp.english && newTitle === emp.title && newUnit === emp.unit && newCategory === emp.category) {
      setEditingId(null)
      return
    }
    setSavingId(emp.id)
    const prev = { english: emp.english, title: emp.title, unit: emp.unit, category: emp.category }
    // 樂觀更新
    setEmployees(employees.map(e => e.id === emp.id ? { ...e, english: newEnglish, title: newTitle, unit: newUnit, category: newCategory } : e))
    const { error: err } = await supabase
      .from('employees')
      .update({ english_name: newEnglish || null, title: newTitle || null, unit: newUnit || null, category: newCategory, updated_at: new Date().toISOString() })
      .eq('id', emp.id)
    setSavingId(null)
    setEditingId(null)
    if (err) {
      toast.error('更新失敗：' + err.message)
      // 還原
      setEmployees(employees.map(e => e.id === emp.id ? { ...e, ...prev } : e))
    }
  }

  async function addEmployee(form: { name: string; english: string; title: string; unit: string; category: EmployeeCategory }) {
    const maxSort = employees.reduce((m, e) => Math.max(m, e.sort_order ?? 0), 0)
    const { data, error: err } = await supabase
      .from('employees')
      .insert({
        chinese_name: form.name.trim(),
        english_name: form.english.trim() || null,
        title: form.title.trim() || null,
        unit: form.unit.trim() || null,
        category: form.category,
        sort_order: maxSort + 1,
      })
      .select('id, chinese_name, english_name, title, unit, category, sort_order')
      .single()
    if (err || !data) throw new Error(err?.message || '新增失敗')
    const row = data as { id: string; chinese_name: string; english_name: string | null; title: string | null; unit: string | null; category: EmployeeCategory; sort_order: number }
    const newEmp: Employee = {
      id: row.id,
      name: row.chinese_name,
      english: row.english_name || '',
      title: row.title || '',
      unit: row.unit || '',
      category: row.category,
      sort_order: row.sort_order,
      resigned_at: null,
    }
    setEmployees([...employees, newEmp].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
    setShowAdd(false)
  }

  // 離職歸檔（軟性，可復職）
  async function archiveEmployee(emp: Employee) {
    if (!emp.id) return
    setArchiving(true)
    const ts = new Date().toISOString()
    const { error: err } = await supabase
      .from('employees')
      .update({ resigned_at: ts, updated_at: ts })
      .eq('id', emp.id)
    setArchiving(false)
    if (err) {
      toast.error('歸檔失敗：' + err.message + '（若提示欄位不存在，請先在 Supabase 執行 migration 035）')
      return
    }
    setEmployees(employees.map(e => e.id === emp.id ? { ...e, resigned_at: ts } : e))
    setArchiveTarget(null)
  }

  // 復職（回到在職名冊）
  async function restoreEmployee(emp: Employee) {
    if (!emp.id) return
    setSavingId(emp.id)
    const { error: err } = await supabase
      .from('employees')
      .update({ resigned_at: null, updated_at: new Date().toISOString() })
      .eq('id', emp.id)
    setSavingId(null)
    if (err) {
      toast.error('復職失敗：' + err.message)
      return
    }
    setEmployees(employees.map(e => e.id === emp.id ? { ...e, resigned_at: null } : e))
  }

  // 永久刪除（不可復原）
  async function deleteEmployee(emp: Employee) {
    if (!emp.id) return
    setDeleting(true)
    const { error: err } = await supabase.from('employees').delete().eq('id', emp.id)
    setDeleting(false)
    if (err) {
      toast.error('刪除失敗：' + err.message)
      return
    }
    setEmployees(employees.filter(e => e.id !== emp.id))
    setDeleteTarget(null)
  }

  if (!canView) {
    return <div className="p-4 text-center py-12 text-gray-400">您沒有權限查看此頁面</div>
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">員工名冊</h1>
          <p className="text-sm text-gray-500 mt-1">
            登泰國際物流組織 · 在職 {activeList.length} 人
            {resignedList.length > 0 && ` · 離職 ${resignedList.length} 人`}
             · 用於人才適性評估目標派發
          </p>
        </div>
        {!loading && !error && view === 'active' && (
          <button
            onClick={() => setShowAdd(true)}
            className="btn-primary text-sm shrink-0 flex items-center gap-1.5"
          >
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline">新增員工</span>
          </button>
        )}
      </div>

      {!loading && !error && (
        <div className="mb-4 inline-flex rounded-xl bg-gray-100 p-1">
          {([
            { key: 'active', label: '在職名冊', n: activeList.length },
            { key: 'resigned', label: '離職員工', n: resignedList.length },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => { setView(t.key); setCategoryFilter('all'); setEditingId(null) }}
              className={cn(
                'px-4 py-1.5 rounded-lg text-sm font-medium transition-all',
                view === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {t.label} <span className="tabular-nums opacity-70">{t.n}</span>
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="card text-center py-12">
          <div className="w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full animate-spin inline-block" />
        </div>
      )}

      {error && (
        <div className="card bg-red-50 border border-red-200 text-red-700 text-sm">
          載入員工名冊失敗：{error}
          <p className="text-xs mt-2 text-red-600">
            可能原因：DB migration 025 還沒在 Supabase 跑（請參照 supabase/migrations/025_employees_table.sql）。
          </p>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* 分類統計（一鍵切換篩選） */}
          <div className="card mb-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <button
                onClick={() => setCategoryFilter('all')}
                className={cn(
                  'p-3 rounded-xl text-left transition-all duration-200 ease-apple',
                  categoryFilter === 'all'
                    ? 'bg-gray-900 text-white shadow-md'
                    : 'bg-gray-50 hover:bg-gray-100 text-gray-700',
                )}
              >
                <div className="text-xs opacity-80 mb-0.5">全部</div>
                <div className="text-xl font-bold tabular-nums">{viewList.length}</div>
              </button>
              {allCategoryKeys.map(key => (
                <button
                  key={key}
                  onClick={() => setCategoryFilter(key)}
                  className={cn(
                    'p-3 rounded-xl text-left transition-all duration-200 ease-apple',
                    categoryFilter === key
                      ? 'bg-gray-900 text-white shadow-md'
                      : 'bg-gray-50 hover:bg-gray-100 text-gray-700',
                  )}
                >
                  <div className="text-xs opacity-80 mb-0.5 truncate">{categoriesMeta[key].label}</div>
                  <div className="text-xl font-bold tabular-nums">{counts[key]}</div>
                </button>
              ))}
            </div>

            {categoryFilter !== 'all' && categoriesMeta[categoryFilter].description && (
              <p className="text-xs text-gray-500 mt-3 px-1 leading-relaxed">
                <span className="font-semibold">{categoriesMeta[categoryFilter].label}：</span>
                {categoriesMeta[categoryFilter].description}
              </p>
            )}
          </div>

          {/* 搜尋 */}
          <div className="card mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜尋姓名（中文/英文）或職稱…"
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none transition-all text-sm"
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">顯示 {filtered.length} / {viewList.length} 人</p>
          </div>

          {/* 列表（含 inline 編輯） */}
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600">
                <tr>
                  <th className="text-left p-3 font-semibold">中文姓名</th>
                  <th className="text-left p-3 font-semibold">英文名</th>
                  <th className="text-left p-3 font-semibold">單位</th>
                  <th className="text-left p-3 font-semibold">職稱</th>
                  <th className="text-left p-3 font-semibold">分類</th>
                  {view === 'resigned' && <th className="text-left p-3 font-semibold">離職日期</th>}
                  <th className="text-right p-3 font-semibold w-32"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const isEditing = editingId === e.id
                  const isSaving = savingId === e.id
                  return (
                    <tr key={e.id} className="border-t border-gray-100 hover:bg-gray-50/50 transition-colors">
                      <td className="p-3 font-medium text-gray-900">{e.name}</td>
                      <td className="p-3 text-gray-700">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editEnglish}
                            onChange={(ev) => setEditEnglish(ev.target.value)}
                            onKeyDown={(ev) => { if (ev.key === 'Enter') saveEmployee(e); if (ev.key === 'Escape') setEditingId(null) }}
                            disabled={isSaving}
                            autoFocus
                            placeholder="英文名"
                            className="w-28 text-sm rounded-lg border border-accent-300 px-2 py-1 focus:ring-2 focus:ring-accent-500/30 outline-none bg-white"
                          />
                        ) : e.english}
                      </td>
                      <td className="p-3 text-gray-600">
                        {isEditing ? (
                          <>
                            <input
                              type="text"
                              list="employee-unit-suggestions"
                              value={editUnit}
                              onChange={(ev) => setEditUnit(ev.target.value)}
                              onKeyDown={(ev) => { if (ev.key === 'Enter') saveEmployee(e); if (ev.key === 'Escape') setEditingId(null) }}
                              disabled={isSaving}
                              placeholder="單位"
                              className="w-24 text-sm rounded-lg border border-accent-300 px-2 py-1 focus:ring-2 focus:ring-accent-500/30 outline-none bg-white"
                            />
                            <datalist id="employee-unit-suggestions">
                              {unitSuggestions.map(u => <option key={u} value={u} />)}
                            </datalist>
                          </>
                        ) : (e.unit || <span className="text-gray-300">—</span>)}
                      </td>
                      <td className="p-3 text-gray-600">
                        {isEditing ? (
                          <>
                            <input
                              type="text"
                              list="employee-title-suggestions"
                              value={editTitle}
                              onChange={(ev) => setEditTitle(ev.target.value)}
                              onKeyDown={(ev) => { if (ev.key === 'Enter') saveEmployee(e); if (ev.key === 'Escape') setEditingId(null) }}
                              disabled={isSaving}
                              placeholder="職稱"
                              className="w-28 text-sm rounded-lg border border-accent-300 px-2 py-1 focus:ring-2 focus:ring-accent-500/30 outline-none bg-white"
                            />
                            <datalist id="employee-title-suggestions">
                              {titleSuggestions.map(t => <option key={t} value={t} />)}
                            </datalist>
                          </>
                        ) : e.title}
                      </td>
                      <td className="p-3">
                        {isEditing ? (
                          <select
                            value={editCategory}
                            onChange={(ev) => setEditCategory(ev.target.value as EmployeeCategory)}
                            disabled={isSaving}
                            className="text-sm rounded-lg border border-accent-300 px-2 py-1 focus:ring-2 focus:ring-accent-500/30 outline-none bg-white"
                          >
                            {allCategoryKeys.map(k => (
                              <option key={k} value={k}>{categoriesMeta[k].label}</option>
                            ))}
                          </select>
                        ) : (
                          <span className={cn('badge ring-1', CATEGORY_COLORS[e.category])}>
                            {categoriesMeta[e.category]?.label || e.category}
                          </span>
                        )}
                      </td>
                      {view === 'resigned' && (
                        <td className="p-3 text-gray-500 text-xs whitespace-nowrap">
                          {e.resigned_at ? new Date(e.resigned_at).toLocaleDateString('zh-TW') : '—'}
                        </td>
                      )}
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* 查看歷次測驗（兩種檢視都有） */}
                          {!isEditing && !isSaving && (
                            <button
                              onClick={() => e.id && setHistoryEmp(e)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-fuchsia-600 hover:bg-fuchsia-50 transition"
                              aria-label="查看歷次測驗"
                              title="查看歷次測驗紀錄"
                            >
                              <BarChart3 className="w-4 h-4" />
                            </button>
                          )}

                          {view === 'active' ? (
                            isEditing ? (
                              <>
                                <button
                                  onClick={() => saveEmployee(e)}
                                  disabled={isSaving}
                                  className="p-1.5 rounded-lg text-white bg-accent-600 hover:bg-accent-700 transition disabled:opacity-60"
                                  aria-label="儲存"
                                  title="儲存變更"
                                >
                                  {isSaving
                                    ? <div className="w-4 h-4 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
                                    : <Check className="w-4 h-4" />}
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  disabled={isSaving}
                                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
                                  aria-label="取消"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            ) : isSaving ? (
                              <div className="w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full animate-spin inline-block" />
                            ) : (
                              <>
                                <button
                                  onClick={() => startEdit(e)}
                                  className="p-1.5 rounded-lg text-gray-400 hover:text-accent-600 hover:bg-accent-50 transition"
                                  aria-label="編輯"
                                  title="編輯單位 / 職稱 / 英文名 / 分類"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => e.id && setArchiveTarget(e)}
                                  className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition"
                                  aria-label="離職歸檔"
                                  title="離職歸檔（移到離職員工，可復職）"
                                >
                                  <UserMinus className="w-4 h-4" />
                                </button>
                              </>
                            )
                          ) : (
                            // 離職檢視：復職 / 永久刪除
                            isSaving ? (
                              <div className="w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full animate-spin inline-block" />
                            ) : (
                              <>
                                <button
                                  onClick={() => restoreEmployee(e)}
                                  className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition"
                                  aria-label="復職"
                                  title="復職（移回在職名冊）"
                                >
                                  <Undo2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => e.id && setDeleteTarget(e)}
                                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                                  aria-label="永久刪除"
                                  title="永久刪除（不可復原）"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={view === 'resigned' ? 7 : 6} className="text-center py-10 text-gray-400">
                      {view === 'resigned' ? '目前沒有離職員工' : '沒有符合條件的員工'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 說明 */}
          <div className="mt-4 rounded-2xl bg-gray-50/70 px-5 py-4 flex items-start gap-3">
            <Users className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
            <div className="text-xs text-gray-600 leading-relaxed">
              <p className="font-semibold mb-1">如何使用</p>
              {view === 'active' ? (
                <p>點 <BarChart3 className="inline w-3 h-3 mx-0.5" /> 看歷次測驗；點 <Edit3 className="inline w-3 h-3 mx-0.5" /> 編輯<b>單位 / 職稱 / 英文名 / 分類</b>，改完按 <Check className="inline w-3 h-3 mx-0.5" /> 儲存（或 Enter）；點 <UserMinus className="inline w-3 h-3 mx-0.5" /> 將員工<b>離職歸檔</b>（移到「離職員工」，之後可復職）。右上「新增員工」可手動新增。</p>
              ) : (
                <p>這裡是已<b>離職歸檔</b>的員工。點 <Undo2 className="inline w-3 h-3 mx-0.5" /> <b>復職</b>移回在職名冊；點 <Trash2 className="inline w-3 h-3 mx-0.5" /> <b>永久刪除</b>（不可復原，但過往測驗紀錄會保留）。離職者不列入在職統計，也不會被派發新的測驗。</p>
              )}
              <p className="mt-2">建立「<Link href="/admin/assessments" className="text-accent-600 hover:underline font-medium">人才適性評估</Link>」活動時可勾選目標分類，系統會用最新分類判斷哪些人應該完成測驗、哪些人尚未完成，並支援匯出 CSV。</p>
            </div>
          </div>
        </>
      )}

      {historyEmp && <EmployeeHistoryModal employee={historyEmp} onClose={() => setHistoryEmp(null)} />}
      {showAdd && (
        <AddEmployeeModal
          categoryKeys={allCategoryKeys}
          categoriesMeta={categoriesMeta}
          unitSuggestions={unitSuggestions}
          onSubmit={addEmployee}
          onClose={() => setShowAdd(false)}
        />
      )}
      {archiveTarget && (
        <ArchiveEmployeeModal
          employee={archiveTarget}
          archiving={archiving}
          onConfirm={() => archiveEmployee(archiveTarget)}
          onClose={() => !archiving && setArchiveTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteEmployeeModal
          employee={deleteTarget}
          deleting={deleting}
          onConfirm={() => deleteEmployee(deleteTarget)}
          onClose={() => !deleting && setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

// =============================================
// 新增員工 modal
// =============================================
function AddEmployeeModal({
  categoryKeys, categoriesMeta, unitSuggestions, onSubmit, onClose,
}: {
  categoryKeys: EmployeeCategory[]
  categoriesMeta: ReturnType<typeof getAllCategoriesMeta>
  unitSuggestions: string[]
  onSubmit: (form: { name: string; english: string; title: string; unit: string; category: EmployeeCategory }) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [english, setEnglish] = useState('')
  const [title, setTitle] = useState('')
  const [unit, setUnit] = useState('')
  const [category, setCategory] = useState<EmployeeCategory>(categoryKeys[categoryKeys.length - 1] ?? 'staff')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!name.trim()) { setError('請輸入中文姓名'); return }
    setSaving(true)
    setError(null)
    try {
      await onSubmit({ name, english, title, unit, category })
    } catch (e) {
      setError(e instanceof Error ? e.message : '新增失敗')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto animate-fade-in" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full my-4 animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-accent-600" />新增員工
          </h3>
          <button onClick={() => !saving && onClose()} className="btn-secondary text-sm shrink-0">✕</button>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">中文姓名 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              placeholder="例如：王小明"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none transition-all text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">英文名</label>
            <input
              type="text"
              value={english}
              onChange={e => setEnglish(e.target.value)}
              placeholder="例如：Ming"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none transition-all text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">單位</label>
            <input
              type="text"
              list="add-employee-unit-suggestions"
              value={unit}
              onChange={e => setUnit(e.target.value)}
              placeholder="例如：業務部"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none transition-all text-sm"
            />
            <datalist id="add-employee-unit-suggestions">
              {unitSuggestions.map(u => <option key={u} value={u} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">職稱</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="例如：OP助理"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none transition-all text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">分類</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value as EmployeeCategory)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none transition-all text-sm bg-white"
            >
              {categoryKeys.map(k => (
                <option key={k} value={k}>{categoriesMeta[k].label}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>

        <div className="px-6 pb-5 pt-1 flex justify-end gap-2">
          <button onClick={() => !saving && onClose()} disabled={saving} className="btn-secondary text-sm">取消</button>
          <button onClick={handleSubmit} disabled={saving} className="btn-primary text-sm flex items-center gap-1.5">
            {saving && <div className="w-3.5 h-3.5 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}
            新增
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================
// 離職歸檔確認 modal
// =============================================
function ArchiveEmployeeModal({
  employee, archiving, onConfirm, onClose,
}: {
  employee: Employee
  archiving: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-2 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mb-3">
            <UserMinus className="w-6 h-6 text-amber-500" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 tracking-tight">將此員工離職歸檔？</h3>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            <span className="font-semibold text-gray-800">{employee.name}</span>
            {employee.english && <span className="text-gray-500">（{employee.english}）</span>}
            將移到「離職員工」清單、不再列入在職名冊與測驗派發。過往測驗紀錄保留，日後可隨時<b>復職</b>。
          </p>
        </div>
        <div className="px-6 pb-5 pt-4 flex justify-center gap-2">
          <button onClick={onClose} disabled={archiving} className="btn-secondary text-sm">取消</button>
          <button
            onClick={onConfirm}
            disabled={archiving}
            className="text-sm px-4 py-2 rounded-xl bg-amber-500 text-white font-medium hover:bg-amber-600 transition flex items-center gap-1.5 disabled:opacity-60"
          >
            {archiving && <div className="w-3.5 h-3.5 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}
            確定歸檔
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================
// 永久刪除員工確認 modal
// =============================================
function DeleteEmployeeModal({
  employee, deleting, onConfirm, onClose,
}: {
  employee: Employee
  deleting: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-2 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-3">
            <AlertTriangle className="w-6 h-6 text-red-500" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 tracking-tight">永久刪除此員工？</h3>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            將<b>永久</b>移除 <span className="font-semibold text-gray-800">{employee.name}</span>
            {employee.english && <span className="text-gray-500">（{employee.english}）</span>}。
            此人過往的測驗紀錄會保留，但不再連結到此員工。此操作<b>無法復原</b>（若只是離職，建議用「離職歸檔」即可）。
          </p>
        </div>
        <div className="px-6 pb-5 pt-4 flex justify-center gap-2">
          <button onClick={onClose} disabled={deleting} className="btn-secondary text-sm">取消</button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="text-sm px-4 py-2 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 transition flex items-center gap-1.5 disabled:opacity-60"
          >
            {deleting && <div className="w-3.5 h-3.5 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}
            確定刪除
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================
// 員工歷次測驗紀錄 modal
// =============================================
interface SubmissionRow {
  id: string
  event_id: string
  respondent_name: string
  english_name: string | null
  department: string
  status: 'in_progress' | 'completed'
  started_at: string
  completed_at: string | null
  hired_employee_id: string | null
  logic_scores: { total?: { score: number; max: number; pct: number; level: string } } | null
  bigfive_scores: BigFiveScores | null
  assessment_events: {
    id: string
    code: string
    name: string
    kind: 'employee' | 'interview' | null
    test_types: string[] | null
  } | null
}

function EmployeeHistoryModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!employee.id) return
    let cancel = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/admin/employees/${employee.id}/submissions`)
        const data = await res.json()
        if (!res.ok) { setError(data.error || `載入失敗 ${res.status}`); return }
        if (!cancel) setSubmissions(data.submissions || [])
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : '載入失敗')
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => { cancel = true }
  }, [employee.id])

  const completed = submissions.filter(s => s.status === 'completed')
  const inProgress = submissions.filter(s => s.status === 'in_progress')

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full my-4 animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-3 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900 tracking-tight">
              {employee.name}
              {employee.english && <span className="text-base text-gray-500 font-normal ml-2">({employee.english})</span>}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {employee.title} · 測驗歷次紀錄
            </p>
          </div>
          <button onClick={onClose} className="btn-secondary text-sm shrink-0">✕</button>
        </div>

        <div className="px-6 py-4">
          {loading && (
            <div className="text-center py-8 text-gray-400">
              <div className="w-6 h-6 border-4 border-fuchsia-500 border-t-transparent rounded-full animate-spin inline-block" />
            </div>
          )}
          {error && <p className="text-red-500 text-sm">{error}</p>}
          {!loading && !error && submissions.length === 0 && (
            <p className="text-center py-8 text-gray-400 text-sm">尚無任何測驗紀錄</p>
          )}

          {/* Big Five 多次測驗趨勢（同人重測） */}
          {!loading && (() => {
            const bfSubs = completed.filter(s => s.assessment_events?.test_types?.includes('bigfive') && s.bigfive_scores)
            if (bfSubs.length < 2) return null
            const people = bfSubs.map((s, i) => ({
              name: s.completed_at ? new Date(s.completed_at).toLocaleDateString('zh-TW') : `#${i + 1}`,
              dimensions: (s.bigfive_scores as BigFiveScores).dimensions,
            })).reverse()  // 舊到新
            return (
              <div className="rounded-2xl bg-gradient-to-br from-fuchsia-50 to-white border border-fuchsia-200 p-3 mb-4">
                <h4 className="text-xs font-semibold text-fuchsia-900 mb-1">🌈 Big Five 多次測驗趨勢（{bfSubs.length} 次）</h4>
                <p className="text-[11px] text-gray-500 mb-1">看人格特質隨時間的漂移</p>
                <BigFiveRadarMulti people={people} height={240} />
              </div>
            )
          })()}

          {!loading && completed.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-gray-500 mb-1">已完成（{completed.length}）</h4>
              {completed.map(s => {
                const isBigFive = s.assessment_events?.test_types?.includes('bigfive')
                return (
                  <Link
                    key={s.id}
                    href={`/admin/assessments/${s.event_id}`}
                    className="block p-3 rounded-xl border border-gray-200 hover:border-accent-300 hover:bg-accent-50/30 transition"
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-gray-900 text-sm">{s.assessment_events?.name}</span>
                          {isBigFive ? (
                            <span className="badge text-[10px] bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200">🌈 Big Five</span>
                          ) : (
                            <span className="badge text-[10px] bg-accent-50 text-accent-700 ring-1 ring-accent-200">🧠 邏輯</span>
                          )}
                          {!s.hired_employee_id && (
                            <span className="badge text-[10px] bg-amber-50 text-amber-700 ring-1 ring-amber-200" title="此筆紀錄是用姓名比對推導出來的，尚未正式連結到此員工 id">
                              ⚠ 姓名比對
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {s.department}
                          {s.completed_at && <span className="ml-2">· {new Date(s.completed_at).toLocaleString('zh-TW')}</span>}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {isBigFive && s.bigfive_scores?.dimensions ? (
                          <div className="text-xs text-gray-600">五大維度</div>
                        ) : s.logic_scores?.total ? (
                          <>
                            <div className="text-base font-bold tabular-nums text-accent-700">{s.logic_scores.total.pct}%</div>
                            <div className="text-[10px] text-gray-500">{s.logic_scores.total.level}</div>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}

          {!loading && inProgress.length > 0 && (
            <div className="mt-4 space-y-2">
              <h4 className="text-xs font-semibold text-amber-700 mb-1">作答中（{inProgress.length}）</h4>
              {inProgress.map(s => (
                <div key={s.id} className="p-3 rounded-xl border border-amber-200 bg-amber-50/40 text-sm">
                  <span className="font-semibold text-gray-900">{s.assessment_events?.name}</span>
                  <span className="text-xs text-gray-500 ml-2">開始於 {new Date(s.started_at).toLocaleString('zh-TW')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
