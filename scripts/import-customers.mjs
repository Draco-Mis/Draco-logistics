// Import customers from Notion CSV export into Supabase
// Usage: node scripts/import-customers.mjs <path-to-csv>
// Example: node scripts/import-customers.mjs ~/Downloads/Draco\ CRM.csv

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import Papa from 'papaparse'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://fbnqanywnnjtntvliljw.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibnFhbnl3bm5qdG50dmxpbGp3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjIzMzM0NCwiZXhwIjoyMDkxODA5MzQ0fQ.Lgj3TfGbNPLi_XFrRwZ7Gf-3GXBI8-yTW7ovoTn0J3E'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// ──────────────────────────────────────────────────────────────────────
// Mapping rules
// ──────────────────────────────────────────────────────────────────────

// Notion 狀態 → customers.status
const STATUS_MAP = {
  '潛在客戶': 'active_developing',
  '初步接觸': 'active_developing',
  '需求評估': 'active_developing',
  '合作洽談': 'active_developing',
  '提案中':   'active_developing',
  '活躍客戶': 'active_developing',
  '流失客戶': 'locked',
}

// Notion 業務欄位值 → users.name（英文名）
// 離職員工用 null 表示跳過
const SALES_MAP = {
  'Leo': 'Leo',
  '登泰/Leo': 'Leo',
  '登泰/Reina': 'Reina',
  'Kenny': 'Kenny',
  'chris.chou-kh@dracolog.com': 'Chris',
  'Brad': 'Brad',
  '登泰/Andy': 'Andy',
  '登泰/May': 'May',
  'Annie': null,              // 已離職
  'oscar.hung-kh@dracolog.com': 'Oscar',
  '郭家圻Jumbo': 'Jumbo',
  'Grace': 'Grace',
  'sophie.chen-kh@dracolog.com': 'Sophie',
  'Aaron': 'Aaron',
  'jill.lin-kh@dracolog.com': 'Jill',
  'REX': 'Rex',
  'Flora': null,              // 已離職
  'Hans': 'Hans',
  'Vera Yeh': 'Vera',
  '登泰/Leona': null,         // 已離職
  'Max': 'Max',
  'max.wang-kg@dracolog.com': 'Max',
  'josh.hsieh-kh@dracolog.com': 'Hans',  // Josh 不在 users 表，先派給 Hans
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function expandPath(p) {
  if (p.startsWith('~')) return resolve(homedir(), p.slice(2))
  return resolve(p)
}

// Notion 匯出的日期格式可能是：
//   "2025年11月3日 上午11:57"（中文格式，本次 Notion 匯出實際格式）
//   "2025/01/15 10:30 (GMT+8)"
//   "2025-01-15"
// 我們只要 YYYY-MM-DD；若解析失敗回傳 null
function parseDate(v) {
  if (!v || typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  // 同時支援 年月日 / 斜線 / 連字號 三種分隔符
  const m = s.match(/(\d{4})\s*[年\/\-]\s*(\d{1,2})\s*[月\/\-]\s*(\d{1,2})/)
  if (!m) return null
  const y = m[1], mo = m[2].padStart(2, '0'), d = m[3].padStart(2, '0')
  return `${y}-${mo}-${d}`
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

async function main() {
  const csvArg = process.argv[2]
  if (!csvArg) {
    console.error('用法: node scripts/import-customers.mjs <path-to-csv>')
    process.exit(1)
  }
  const csvPath = expandPath(csvArg)
  console.log(`📄 讀取 CSV: ${csvPath}\n`)

  const csvContent = readFileSync(csvPath, 'utf-8')

  // 1) 載入 users 對照表
  console.log('👥 載入 users 資料...')
  const { data: users, error: uerr } = await supabase
    .from('users')
    .select('id, name, email')
  if (uerr) {
    console.error('❌ 無法讀取 users:', uerr.message)
    process.exit(1)
  }
  const nameToId = new Map(users.map(u => [u.name, u.id]))
  const hansId = nameToId.get('Hans')
  if (!hansId) {
    console.error('❌ 找不到 Hans 帳號（需要他當 created_by）')
    process.exit(1)
  }
  console.log(`✅ 已載入 ${users.length} 位使用者\n`)

  // 2) 解析 CSV
  const parsed = Papa.parse(csvContent, {
    header: true,
    skipEmptyLines: true,
  })
  if (parsed.errors.length) {
    console.warn('⚠️ CSV 解析警告:', parsed.errors.slice(0, 3))
  }
  console.log(`📋 CSV 共 ${parsed.data.length} 筆\n`)

  // 3) 轉換成 customers rows
  const rows = []
  const stats = {
    skippedResigned: 0,
    skippedNoSales: 0,
    skippedUnknownSales: new Map(),  // salesName → count
    skippedUnknownStatus: new Map(), // statusName → count
    skippedNoCompany: 0,
    ok: 0,
  }

  for (const r of parsed.data) {
    const companyName = (r['屬性'] || '').trim()
    if (!companyName) {
      stats.skippedNoCompany++
      continue
    }

    // 業務對應
    const salesRaw = (r['業務'] || '').trim()
    if (!salesRaw) {
      stats.skippedNoSales++
      continue
    }
    if (!(salesRaw in SALES_MAP)) {
      stats.skippedUnknownSales.set(salesRaw, (stats.skippedUnknownSales.get(salesRaw) || 0) + 1)
      continue
    }
    const mappedName = SALES_MAP[salesRaw]
    if (mappedName === null) {
      stats.skippedResigned++
      continue
    }
    const assignedId = nameToId.get(mappedName)
    if (!assignedId) {
      console.warn(`⚠️ users 表找不到 ${mappedName}（來自 CSV 的 "${salesRaw}"）`)
      stats.skippedUnknownSales.set(salesRaw, (stats.skippedUnknownSales.get(salesRaw) || 0) + 1)
      continue
    }

    // 狀態對應
    const statusRaw = (r['狀態'] || '').trim()
    const status = STATUS_MAP[statusRaw] || 'active_developing'
    if (statusRaw && !(statusRaw in STATUS_MAP)) {
      stats.skippedUnknownStatus.set(statusRaw, (stats.skippedUnknownStatus.get(statusRaw) || 0) + 1)
      // 不 skip，用預設 active_developing
    }

    // 日期
    const createdDate = parseDate(r['建立時間']) || today()
    const lastContactDate = parseDate(r['聯絡時間']) || null

    rows.push({
      company_name: companyName,
      assigned_to: assignedId,
      created_by: hansId,
      created_date: createdDate,
      last_contact_date: lastContactDate,
      status,
      grade: 'C',
    })
    stats.ok++
  }

  // 4) 報告
  console.log('═══════ 轉換結果 ═══════')
  console.log(`✅ 將匯入：${stats.ok} 筆`)
  console.log(`⏭️  跳過（離職員工）：${stats.skippedResigned}`)
  console.log(`⏭️  跳過（無業務欄位）：${stats.skippedNoSales}`)
  console.log(`⏭️  跳過（無公司名）：${stats.skippedNoCompany}`)
  if (stats.skippedUnknownSales.size) {
    console.log('⚠️  未對應的業務名稱（已跳過）:')
    for (const [k, v] of stats.skippedUnknownSales) console.log(`    - "${k}" × ${v}`)
  }
  if (stats.skippedUnknownStatus.size) {
    console.log('⚠️  未對應的狀態（已用預設 active_developing）:')
    for (const [k, v] of stats.skippedUnknownStatus) console.log(`    - "${k}" × ${v}`)
  }
  console.log('═══════════════════════\n')

  // 5) Dry-run 確認
  if (process.argv.includes('--dry-run')) {
    console.log('🔍 dry-run 模式，顯示前 3 筆預覽：')
    console.log(JSON.stringify(rows.slice(0, 3), null, 2))
    console.log('\n（未寫入資料庫）')
    return
  }

  if (rows.length === 0) {
    console.log('沒有可匯入的資料。')
    return
  }

  // 6) 分批 insert
  const BATCH_SIZE = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from('customers').insert(batch)
    if (error) {
      console.error(`❌ 第 ${i / BATCH_SIZE + 1} 批失敗:`, error.message)
      console.error('首筆資料:', JSON.stringify(batch[0], null, 2))
      process.exit(1)
    }
    inserted += batch.length
    console.log(`  ✅ 已寫入 ${inserted}/${rows.length}`)
  }

  console.log(`\n🎉 匯入完成！共 ${inserted} 筆客戶資料。`)
}

main().catch(err => {
  console.error('❌ 執行錯誤:', err)
  process.exit(1)
})
