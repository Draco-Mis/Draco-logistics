import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'

// POST /api/admin/assessments/submission/hire
// body: { id, hired: boolean, notes?: string }
// 標記/取消標記面試人員為「已錄取」
export async function POST(request: Request) {
  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: '未登入' }, { status: 401 })
  const { data: profile } = await supa.from('users').select('role, team, is_active').eq('id', authUser.id).single()
  const allowed = !!profile && profile.is_active !== false && (
    ['admin', 'director', 'hr'].includes(profile.role) || profile.team === '財管部'
  )
  if (!allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 })

  let body: { id?: string; hired?: boolean; notes?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  const id = (body.id || '').trim()
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const admin = createServiceRoleClient()
  const patch: Record<string, unknown> = {
    hired_at: body.hired ? new Date().toISOString() : null,
  }
  if (typeof body.notes === 'string') patch.hire_notes = body.notes.trim() || null
  // 取消錄取的話，也要把員工名冊連結清掉
  if (!body.hired) patch.hired_employee_id = null

  const { error } = await admin
    .from('assessment_submissions')
    .update(patch)
    .eq('id', id)
  if (error) return NextResponse.json({ error: '更新失敗：' + error.message }, { status: 500 })

  return NextResponse.json({ success: true, hired_at: patch.hired_at })
}
