import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'

// POST /api/admin/assessments/update
// body: { id, name?, deadline? }
// 更新活動名稱 / 截止時間
export async function POST(request: Request) {
  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: '未登入' }, { status: 401 })
  const { data: profile } = await supa.from('users').select('role, team, is_active').eq('id', authUser.id).single()
  const allowed = !!profile && profile.is_active !== false && (
    ['admin', 'director', 'hr'].includes(profile.role) || profile.team === '財管部'
  )
  if (!allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 })

  let body: { id?: string; name?: string; deadline?: string | null }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  const id = (body.id || '').trim()
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: '活動名稱不可空白' }, { status: 400 })
    if (name.length > 100) return NextResponse.json({ error: '活動名稱過長（上限 100 字）' }, { status: 400 })
    patch.name = name
  }
  if (body.deadline !== undefined) {
    patch.deadline = body.deadline || null
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '沒有要更新的欄位' }, { status: 400 })
  }

  const admin = createServiceRoleClient()
  const { error } = await admin.from('assessment_events').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: '更新失敗：' + error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
