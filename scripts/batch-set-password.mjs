// 批次為 users 表中尚未建立 Auth 帳號的人建立帳號並設臨時密碼
// 使用方式：
//   node scripts/batch-set-password.mjs           預覽（不執行）
//   node scripts/batch-set-password.mjs --run     實際執行

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://fbnqanywnnjtntvliljw.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibnFhbnl3bm5qdG50dmxpbGp3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjIzMzM0NCwiZXhwIjoyMDkxODA5MzQ0fQ.Lgj3TfGbNPLi_XFrRwZ7Gf-3GXBI8-yTW7ovoTn0J3E'
const TEMP_PASSWORD = 'Draco2026'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const run = process.argv.includes('--run')

async function main() {
  console.log('📋 讀取 users 表...')
  const { data: tableUsers, error: tableErr } = await admin
    .from('users')
    .select('id, email, name, chinese_name, team, is_active')
    .eq('is_active', true)
  if (tableErr) throw tableErr

  console.log('🔐 讀取 Auth users...')
  const { data: { users: authUsers }, error: authErr } = await admin.auth.admin.listUsers({ perPage: 200 })
  if (authErr) throw authErr

  const authEmails = new Set(authUsers.map(u => u.email))

  const needCreate = tableUsers.filter(u => !authEmails.has(u.email))
  const alreadyHave = tableUsers.filter(u => authEmails.has(u.email))

  console.log()
  console.log(`✅ 已有 Auth 帳號：${alreadyHave.length} 位`)
  alreadyHave.forEach(u => console.log(`   ${u.chinese_name}（${u.name}）- ${u.email}`))
  console.log()
  console.log(`🔸 需要建立：${needCreate.length} 位`)
  needCreate.forEach(u => console.log(`   ${u.chinese_name}（${u.name}）- ${u.email}`))

  if (!run) {
    console.log()
    console.log('👉 以上是預覽。確認無誤後執行：')
    console.log('   node scripts/batch-set-password.mjs --run')
    return
  }

  console.log()
  console.log(`🚀 開始批次建立（臨時密碼：${TEMP_PASSWORD}）...`)
  console.log()

  let success = 0
  let failed = 0
  for (const user of needCreate) {
    const { error } = await admin.auth.admin.createUser({
      id: user.id, // Auth UID 對齊 users.id
      email: user.email,
      password: TEMP_PASSWORD,
      email_confirm: true,
      user_metadata: {
        chinese_name: user.chinese_name,
        name: user.name,
      },
    })
    if (error) {
      console.log(`❌ ${user.chinese_name}（${user.email}）：${error.message}`)
      failed++
    } else {
      // 將 password_changed 設為 false 以啟動「首次登入強制改密碼」
      await admin.from('users').update({ password_changed: false }).eq('id', user.id)
      console.log(`✅ ${user.chinese_name}（${user.email}）`)
      success++
    }
  }

  console.log()
  console.log(`🎉 完成！成功 ${success} 位，失敗 ${failed} 位`)
  console.log()
  console.log('=== 請公告給大家 ===')
  console.log(`網址：https://draco-crm.vercel.app`)
  console.log(`帳號：自己的 email（@dracolog.com）`)
  console.log(`密碼：${TEMP_PASSWORD}`)
  console.log(`登入後請到「更多」→「修改密碼」設定自己的密碼`)
}

main().catch(err => {
  console.error('❌ 錯誤：', err)
  process.exit(1)
})
