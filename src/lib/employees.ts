'use client'

import { useEffect, useState } from 'react'
import employeesData from '@/data/employees.json'
import { createClient } from '@/lib/supabase-client'
import type { Employee, EmployeeCategory, EmployeeRosterJson } from '@/types/employee'

const ROSTER = employeesData as EmployeeRosterJson

export function getCategoryMeta(category: EmployeeCategory) {
  return ROSTER.categories[category]
}

export function getAllCategoryKeys(): EmployeeCategory[] {
  return Object.keys(ROSTER.categories).sort(
    (a, b) => ROSTER.categories[a as EmployeeCategory].order - ROSTER.categories[b as EmployeeCategory].order,
  ) as EmployeeCategory[]
}

export function getAllCategoriesMeta() {
  return ROSTER.categories
}

/** 取得單純的 categories 設定（label / order / description） */
export function getCategoriesConfig() {
  return ROSTER.categories
}

/** 統計每個分類的人數 */
export function computeCategoryCounts(employees: Employee[]): Record<EmployeeCategory, number> {
  const out: Record<string, number> = {}
  for (const key of getAllCategoryKeys()) out[key] = 0
  for (const e of employees) {
    if (e.category in out) out[e.category] = (out[e.category] ?? 0) + 1
  }
  return out as Record<EmployeeCategory, number>
}

/** 把資料庫的 row 轉成前端 Employee 形狀 */
interface EmployeeRow {
  id: string
  chinese_name: string
  english_name: string | null
  title: string | null
  unit?: string | null
  category: string
  sort_order: number
  resigned_at?: string | null
}

function rowToEmployee(r: EmployeeRow): Employee {
  return {
    id: r.id,
    name: r.chinese_name,
    english: r.english_name || '',
    title: r.title || '',
    unit: r.unit || '',
    category: r.category as EmployeeCategory,
    sort_order: r.sort_order,
    resigned_at: r.resigned_at ?? null,
  }
}

/** React hook：從 DB 載入員工名冊，提供載入狀態 */
export function useEmployees() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  async function reload() {
    setLoading(true)
    setError(null)
    // 逐步降級 select：優先帶 unit + resigned_at；欄位尚未建立（migration 037 / 035 還沒跑）就退回
    const BASE = 'id, chinese_name, english_name, title, category, sort_order'
    const sel = (cols: string) =>
      supabase.from('employees').select(cols).order('sort_order', { ascending: true }) as unknown as
        Promise<{ data: EmployeeRow[] | null; error: { message: string } | null }>
    let res = await sel(`${BASE}, resigned_at, unit`)
    if (res.error && /unit/.test(res.error.message)) {
      res = await sel(`${BASE}, resigned_at`)
    }
    if (res.error && /resigned_at/.test(res.error.message)) {
      res = await sel(BASE)
    }
    if (res.error) {
      setError(res.error.message)
      setLoading(false)
      return
    }
    setEmployees((res.data as EmployeeRow[]).map(rowToEmployee))
    setLoading(false)
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { employees, loading, error, reload, setEmployees }
}

/** Filter helpers */
export function filterByCategories(employees: Employee[], categories: EmployeeCategory[]): Employee[] {
  if (categories.length === 0) return employees
  const set = new Set(categories)
  return employees.filter(e => set.has(e.category))
}
