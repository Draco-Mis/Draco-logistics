import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import type { User } from '@/types/database'

// 12 個正式產業類別 + 常見別名映射
export const INDUSTRY_ALIAS: Record<string, string> = {
  '電子科技業': '電子科技業', '機械製造業': '機械製造業', '化工原物料': '化工原物料',
  '紡織成衣業': '紡織成衣業', '食品飲料業': '食品飲料業', '醫療保健業': '醫療保健業',
  '汽車零組件': '汽車零組件', '貿易進出口': '貿易進出口', '電商零售業': '電商零售業',
  '建材五金業': '建材五金業', '能源環保業': '能源環保業', '其他': '其他',
  '電子業': '電子科技業', '電子': '電子科技業', '科技業': '電子科技業', '半導體': '電子科技業',
  '機械業': '機械製造業', '機械': '機械製造業', '製造業': '機械製造業', '製造': '機械製造業',
  '化工業': '化工原物料', '化工': '化工原物料', '原物料': '化工原物料',
  '紡織業': '紡織成衣業', '紡織': '紡織成衣業', '成衣': '紡織成衣業',
  '食品業': '食品飲料業', '食品': '食品飲料業', '飲料': '食品飲料業',
  '醫療業': '醫療保健業', '醫療': '醫療保健業', '保健': '醫療保健業', '生技': '醫療保健業',
  '汽車業': '汽車零組件', '汽車': '汽車零組件', '零組件': '汽車零組件',
  '貿易業': '貿易進出口', '貿易': '貿易進出口', '進出口': '貿易進出口',
  '電商': '電商零售業', '零售': '電商零售業', '零售業': '電商零售業',
  '建材': '建材五金業', '五金': '建材五金業', '建材業': '建材五金業',
  '能源業': '能源環保業', '能源': '能源環保業', '環保': '能源環保業', '環保業': '能源環保業',
  '服務業': '其他', '服務': '其他',
}

// 各邏輯欄位的可接受別名（不分大小寫、空白）
const FIELD_ALIASES = {
  company_name: ['公司名稱', '客戶名稱', '客戶', '公司', 'company', 'company_name', 'name'],
  sales: ['業務員', '業務', '負責業務', '負責人', '負責業務員', 'sales', 'salesperson', 'assigned_to', 'assigned'],
  industry: ['產業', '產業分類', '產業類別', 'industry'],
  created_date: ['建檔日期', '建立日期', '建立時間', '建檔時間', 'created_at', 'created_date', 'date'],
} as const

export interface ParsedRow {
  rowNumber: number          // 1-based 對應檔案第幾列（含標題列）
  company_name: string
  sales_input: string        // 原始字串
  sales_id: string | null    // 解析到的 user.id
  industry: string | null    // 正規化後 enum 值
  industry_input: string     // 原始字串
  created_date: string       // YYYY-MM-DD
  errors: string[]
}

export interface ParseResult {
  rows: ParsedRow[]
  totalErrors: number
  unmatchedSalesNames: string[]
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '')
}

function findField(row: Record<string, unknown>, aliases: readonly string[]): string {
  const normAliases = aliases.map(a => normalizeKey(a))
  for (const [key, val] of Object.entries(row)) {
    if (normAliases.includes(normalizeKey(key))) {
      const v = val == null ? '' : String(val)
      return v.trim()
    }
  }
  return ''
}

function toIsoDate(input: string): string | null {
  if (!input) return null
  const s = input.trim()
  if (!s) return null
  // 支援常見格式：YYYY-MM-DD, YYYY/MM/DD, 純日期物件 stringify 結果
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return d.toISOString().split('T')[0]
}

function findUserByName(input: string, users: User[]): User | null {
  if (!input) return null
  const trimmed = input.trim()
  const lower = trimmed.toLowerCase()
  return (
    users.find(u => u.chinese_name === trimmed) ??
    users.find(u => u.name?.toLowerCase() === lower) ??
    null
  )
}

function mapRow(raw: Record<string, unknown>, rowNumber: number, users: User[]): ParsedRow {
  const company_name = findField(raw, FIELD_ALIASES.company_name)
  const sales_input = findField(raw, FIELD_ALIASES.sales)
  const industry_input = findField(raw, FIELD_ALIASES.industry)
  const date_input = findField(raw, FIELD_ALIASES.created_date)

  const errors: string[] = []
  if (!company_name) errors.push('公司名稱必填')

  let sales_id: string | null = null
  if (sales_input) {
    const u = findUserByName(sales_input, users)
    if (u) sales_id = u.id
    else errors.push(`找不到業務員「${sales_input}」，請手動指定`)
  } else {
    errors.push('業務員必填')
  }

  const industry = industry_input ? (INDUSTRY_ALIAS[industry_input.trim()] ?? null) : null

  const created_date =
    toIsoDate(date_input) ?? new Date().toISOString().split('T')[0]

  return {
    rowNumber,
    company_name,
    sales_input,
    sales_id,
    industry,
    industry_input,
    created_date,
    errors,
  }
}

async function readCSV(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (r) => resolve(r.data),
      error: reject,
    })
  })
}

async function readXLSX(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const first = wb.SheetNames[0]
  if (!first) return []
  const sheet = wb.Sheets[first]
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false })
}

export async function parseFile(file: File, users: User[]): Promise<ParseResult> {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  let raw: Record<string, unknown>[]
  if (ext === 'csv') raw = await readCSV(file)
  else if (ext === 'xlsx' || ext === 'xls') raw = await readXLSX(file)
  else throw new Error(`不支援的檔案格式：.${ext}（僅支援 .xlsx、.xls、.csv）`)

  // 過濾全空白列
  const nonEmpty = raw.filter(r =>
    Object.values(r).some(v => v != null && String(v).trim() !== '')
  )

  // rowNumber 從 2 開始（第 1 列是標題）
  const rows = nonEmpty.map((r, i) => mapRow(r, i + 2, users))
  const totalErrors = rows.reduce((s, r) => s + r.errors.length, 0)
  const unmatchedSalesNames = Array.from(
    new Set(rows.filter(r => r.sales_input && !r.sales_id).map(r => r.sales_input))
  )

  return { rows, totalErrors, unmatchedSalesNames }
}

// 在使用者於 UI 手動補正後，重新評估錯誤
export function recomputeRowErrors(row: ParsedRow): ParsedRow {
  const errors: string[] = []
  if (!row.company_name) errors.push('公司名稱必填')
  if (!row.sales_id) errors.push('業務員必填')
  return { ...row, errors }
}
