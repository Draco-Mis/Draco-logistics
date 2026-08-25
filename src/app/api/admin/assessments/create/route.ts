import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'

// POST /api/admin/assessments/create
// body: { name, deadline? (ISO string) }
// 自動產生 8 位隨機 code，回傳新建活動
export async function POST(request: Request) {
  // 驗證 admin/director/hr 或 課別=財管部
  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: '未登入' }, { status: 401 })
  const { data: profile } = await supa.from('users').select('role, team, is_active').eq('id', authUser.id).single()
  const allowed = !!profile && profile.is_active !== false && (
    ['admin', 'director', 'hr'].includes(profile.role) || profile.team === '財管部'
  )
  if (!allowed) {
    return NextResponse.json({ error: '權限不足' }, { status: 403 })
  }

  let body: { name?: string; deadline?: string | null; target_categories?: string[] | null; kind?: string; test_type?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  const name = (body.name || '').trim()
  if (!name) return NextResponse.json({ error: '請填寫活動名稱' }, { status: 400 })

  // 驗證目標分類（null 或空陣列代表「不限分類」）
  const ALLOWED_CATEGORIES = [
    'chairman', 'department_head', 'section_head', 'deputy_section_head',
    'supervisor', 'project_lead', 'operations', 'sales', 'staff',
  ]
  let targetCategories: string[] | null = null
  if (Array.isArray(body.target_categories) && body.target_categories.length > 0) {
    const invalid = body.target_categories.filter(c => !ALLOWED_CATEGORIES.includes(c))
    if (invalid.length > 0) {
      return NextResponse.json({ error: `不允許的分類：${invalid.join(', ')}` }, { status: 400 })
    }
    targetCategories = body.target_categories
  }

  const kind: 'employee' | 'interview' =
    body.kind === 'interview' ? 'interview' : 'employee'

  const testType: 'logic' | 'bigfive' =
    body.test_type === 'bigfive' ? 'bigfive' : 'logic'

  const admin = createServiceRoleClient()

  // 產生唯一 8 位英數 code（碰撞重試最多 10 次）
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 去掉易混淆 I/O/0/1
  let code = ''
  for (let attempt = 0; attempt < 10; attempt++) {
    let c = ''
    for (let i = 0; i < 8; i++) c += chars[Math.floor(Math.random() * chars.length)]
    const { data: exists } = await admin.from('assessment_events').select('id').eq('code', c).maybeSingle()
    if (!exists) { code = c; break }
  }
  if (!code) return NextResponse.json({ error: '產生 code 失敗，請重試' }, { status: 500 })

  const { data: event, error } = await admin
    .from('assessment_events')
    .insert({
      code,
      name,
      test_types: [testType],
      deadline: body.deadline || null,
      is_active: true,
      created_by: authUser.id,
      target_categories: targetCategories,
      kind,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: '建立失敗：' + error.message }, { status: 500 })
  return NextResponse.json({ event })
}
