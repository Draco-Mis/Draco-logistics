// 批次邀請腳本：為 users 表中尚未建立 Auth 帳號的人建立帳號並寄密碼設定邀請信
// 使用方式：
//   node scripts/invite-users.mjs --email may-kh@dracolog.com         寄單一人
//   node scripts/invite-users.mjs --all                                寄全部尚未有 Auth 的人

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'

const SUPABASE_URL = 'https://fbnqanywnnjtntvliljw.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibnFhbnl3bm5qdG50dmxpbGp3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjIzMzM0NCwiZXhwIjoyMDkxODA5MzQ0fQ.Lgj3TfGbNPLi_XFrRwZ7Gf-3GXBI8-yTW7ovoTn0J3E'
const SITE_URL = 'https://draco-crm.vercel.app'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ---------- 解析參數 ----------
const args = process.argv.slice(2)
const emailArg = args.indexOf('--email') > -1 ? args[args.indexOf('--email') + 1] : null
const allFlag = args.includes('--all')

if (!emailArg && !allFlag) {
  console.log('使用方式：')
  console.log('  node scripts/invite-users.mjs --email <email>    寄單一人')
  console.log('  node scripts/invite-users.mjs --all               寄全部尚未有 Auth 的人')
  process.exit(1)
}

// ---------- 主流程 ----------
async function main() {
  console.log('📋 讀取 users 表...')
  const { data: tableUsers, error: tableErr } = await admin
    .from('users')
    .select('id, email, name, chinese_name, is_active')
  if (tableErr) throw tableErr

  console.log('🔐 讀取 Auth users...')
  const { data: { users: authUsers }, error: authErr } = await admin.auth.admin.listUsers({ perPage: 200 })
  if (authErr) throw authErr

  const authEmails = new Set(authUsers.map(u => u.email))

  // 決定要處理哪些人
  let targets = []
  if (emailArg) {
    const u = tableUsers.find(x => x.email === emailArg)
    if (!u) {
      console.error(`❌ 找不到 email=${emailArg} 的使用者`)
      process.exit(1)
    }
    targets = [u]
  } else if (allFlag) {
    targets = tableUsers.filter(u => u.is_active && !authEmails.has(u.email))
  }

  if (targets.length === 0) {
    console.log('✅ 沒有需要處理的使用者（全部都已有 Auth 帳號）')
    return
  }

  console.log(`\n📤 準備處理 ${targets.length} 位使用者：\n`)

  for (const user of targets) {
    const alreadyHasAuth = authEmails.has(user.email)
    console.log(`▸ ${user.chinese_name}（${user.name}）- ${user.email}`)

    // 1. 如果還沒有 Auth，先建立
    if (!alreadyHasAuth) {
      const tempPassword = randomBytes(24).toString('base64url')
      const { error: createErr } = await admin.auth.admin.createUser({
        id: user.id,  // 讓 Auth UID 對齊 users.id
        email: user.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          chinese_name: user.chinese_name,
          name: user.name,
        },
      })
      if (createErr) {
        console.log(`   ❌ 建立 Auth 失敗：${createErr.message}`)
        continue
      }
      console.log(`   ✅ Auth 帳號已建立`)
    } else {
      console.log(`   ℹ️  Auth 帳號已存在，只重寄密碼設定信`)
    }

    // 2. 寄密碼重設信
    //    導到 /api/auth/callback 讓後端交換 code → session cookie，再跳到 /set-password
    const { error: resetErr } = await admin.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${SITE_URL}/api/auth/callback?next=/set-password`,
    })
    if (resetErr) {
      console.log(`   ❌ 寄信失敗：${resetErr.message}`)
      continue
    }
    console.log(`   📧 邀請信已寄出 → ${user.email}`)
  }

  console.log(`\n🎉 完成！`)
}

main().catch(err => {
  console.error('❌ 錯誤：', err)
  process.exit(1)
})
