// 從 Notion CSV 回填客戶的「建立時間」到 created_date 欄位
// 超過 90 天的客戶：狀態改為 locked，建檔日期改為今天（重新計時）
//
// 使用：
//   node scripts/backfill-created-date.mjs           預覽（不寫入）
//   node scripts/backfill-created-date.mjs --run     正式執行

import fs from 'fs'
import Papa from 'papaparse'
import { createClient } from '@supabase/supabase-js'
import os from 'os'
import path from 'path'

const CSV_PATH = path.join(os.homedir(), 'Downloads', 'Draco CRM 2a006b221bbb80d4be23f4958341af57_all.csv')
const SUPABASE_URL = 'https://fbnqanywnnjtntvliljw.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibnFhbnl3bm5qdG50dmxpbGp3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjIzMzM0NCwiZXhwIjoyMDkxODA5MzQ0fQ.Lgj3TfGbNPLi_XFrRwZ7Gf-3GXBI8-yTW7ovoTn0J3E'

const run = process.argv.includes('--run')
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 把 "2025年11月3日 上午11:57" 轉成 "2025-11-03"
function parseChineseDate(str) {
  if (!str) return null
  const m = str.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (!m) return null
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
}

async function main() {
  console.log('📄 讀 CSV...')
  const csvContent = fs.readFileSync(CSV_PATH, 'utf-8')
  const { data: rows } = Papa.parse(csvContent, { header: true, skipEmptyLines: true })
  console.log(`   CSV 共 ${rows.length} 筆`)

  // 建立 company_name -> 最早 created_date 的 map（同名取最早）
  const csvMap = new Map()
  for (const row of rows) {
    const name = (row['屬性'] || '').trim()
    const dateStr = parseChineseDate(row['建立時間'])
    if (!name || !dateStr) continue
    const existing = csvMap.get(name)
    if (!existing || dateStr < existing) csvMap.set(name, dateStr)
  }
  console.log(`   CSV 唯一公司名: ${csvMap.size}`)

  console.log('\n💾 讀資料庫所有客戶...')
  // Supabase 單次查詢預設上限 1000 筆，用 range 分頁抓完全部
  const customers = []
  let from = 0
  const size = 1000
  while (true) {
    const { data, error } = await supabase
      .from('customers')
      .select('id, company_name, created_date, status')
      .range(from, from + size - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    customers.push(...data)
    if (data.length < size) break
    from += size
  }
  console.log(`   DB 共 ${customers.length} 筆`)

  // 計算 90 天前的日期
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() - 90)
  const cutoffStr = cutoff.toISOString().split('T')[0]
  console.log(`   今天: ${todayStr}`)
  console.log(`   90 天分界: ${cutoffStr}`)

  // 配對 + 分類
  const toLock = []      // 超過 90 天 -> 鎖檔 + 重設日期
  const toBackfill = []  // 90 天內 -> 回填日期
  const notMatched = []  // CSV 找不到配對

  for (const c of customers) {
    const csvDate = csvMap.get(c.company_name)
    if (!csvDate) {
      notMatched.push(c)
      continue
    }
    if (csvDate < cutoffStr) {
      toLock.push({ ...c, csvDate })
    } else if (csvDate !== c.created_date) {
      toBackfill.push({ ...c, csvDate })
    }
    // 同日就不用動
  }

  console.log('\n📊 預覽分類')
  console.log(`   🔴 超過 90 天 → 鎖檔 + 重設: ${toLock.length} 筆`)
  console.log(`   🟢 90 天內 → 回填日期:      ${toBackfill.length} 筆`)
  console.log(`   ⚠️  CSV 找不到配對:          ${notMatched.length} 筆`)
  console.log(`   ➡️  日期相同不動:            ${customers.length - toLock.length - toBackfill.length - notMatched.length} 筆`)

  if (notMatched.length > 0 && notMatched.length <= 20) {
    console.log('\n   未配對的客戶（前 20 筆）：')
    notMatched.slice(0, 20).forEach(c => console.log(`     - ${c.company_name}`))
  } else if (notMatched.length > 20) {
    console.log(`\n   未配對的客戶前 10 筆：`)
    notMatched.slice(0, 10).forEach(c => console.log(`     - ${c.company_name}`))
    console.log(`   ...還有 ${notMatched.length - 10} 筆未列出`)
  }

  if (toLock.length > 0) {
    console.log('\n   🔴 會被鎖檔的客戶範例（前 5 筆）：')
    toLock.slice(0, 5).forEach(c =>
      console.log(`     - ${c.company_name}（原日期 ${c.csvDate}）`)
    )
  }

  if (toBackfill.length > 0) {
    console.log('\n   🟢 會被回填日期的客戶範例（前 5 筆）：')
    toBackfill.slice(0, 5).forEach(c =>
      console.log(`     - ${c.company_name}: ${c.created_date} → ${c.csvDate}`)
    )
  }

  if (!run) {
    console.log('\n👉 以上是預覽。確認後執行：')
    console.log('   node scripts/backfill-created-date.mjs --run')
    return
  }

  console.log('\n🚀 開始寫入...')

  // 批次處理：一次一筆比較保險
  let successLock = 0
  let failLock = 0
  for (const c of toLock) {
    const { error } = await supabase
      .from('customers')
      .update({
        created_date: todayStr,
        status: 'locked',
        locked_at: new Date().toISOString(),
        locked_reason: `原建檔日 ${c.csvDate}（已逾 90 天），重新計時`,
      })
      .eq('id', c.id)
    if (error) {
      console.log(`   ❌ ${c.company_name}: ${error.message}`)
      failLock++
    } else {
      successLock++
    }
  }

  let successBackfill = 0
  let failBackfill = 0
  for (const c of toBackfill) {
    const { error } = await supabase
      .from('customers')
      .update({ created_date: c.csvDate })
      .eq('id', c.id)
    if (error) {
      console.log(`   ❌ ${c.company_name}: ${error.message}`)
      failBackfill++
    } else {
      successBackfill++
    }
  }

  console.log('\n🎉 完成！')
  console.log(`   鎖檔 + 重設：成功 ${successLock} / 失敗 ${failLock}`)
  console.log(`   回填日期：  成功 ${successBackfill} / 失敗 ${failBackfill}`)
  console.log(`   未動到：    ${notMatched.length + (customers.length - toLock.length - toBackfill.length - notMatched.length)} 筆`)
}

main().catch(err => {
  console.error('❌ 執行錯誤：', err)
  process.exit(1)
})
