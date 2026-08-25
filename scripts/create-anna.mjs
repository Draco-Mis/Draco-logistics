// 建立 Anna 為 admin 管理者帳號
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://fbnqanywnnjtntvliljw.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibnFhbnl3bm5qdG50dmxpbGp3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjIzMzM0NCwiZXhwIjoyMDkxODA5MzQ0fQ.Lgj3TfGbNPLi_XFrRwZ7Gf-3GXBI8-yTW7ovoTn0J3E'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const userData = {
  email: 'anna@dracolog.com',
  name: 'Anna',
  chinese_name: 'Anna',
  role: 'admin',
  team: '管理員',
  is_active: true,
}

const { data: inserted, error: insertErr } = await admin
  .from('users')
  .insert(userData)
  .select()
  .single()

if (insertErr) {
  console.log('❌ users 表插入失敗：', insertErr.message)
  process.exit(1)
}
console.log('✅ users 表建立，ID:', inserted.id)

const { error: authErr } = await admin.auth.admin.createUser({
  id: inserted.id,
  email: userData.email,
  password: 'Draco2026',
  email_confirm: true,
  user_metadata: {
    chinese_name: userData.chinese_name,
    name: userData.name,
  },
})

if (authErr) {
  console.log('❌ Auth 建立失敗：', authErr.message)
  await admin.from('users').delete().eq('id', inserted.id)
  process.exit(1)
}

console.log('✅ Auth 帳號建立成功')
console.log()
console.log('=== Anna 登入資訊 ===')
console.log('網址：https://draco-crm.vercel.app')
console.log('Email：anna@dracolog.com')
console.log('密碼：Draco2026')
console.log('角色：admin（管理員）')
