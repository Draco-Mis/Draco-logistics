import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'

// GET：列出所有 job profile
// POST：建立或更新（含 id 即更新）
export async function GET() {
  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: '未登入' }, { status: 401 })
  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from('bigfive_job_profiles')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profiles: data || [] })
}

interface ProfileBody {
  id?: string
  name?: string
  description?: string
  ideal?: Record<string, number>
  weights?: Record<string, number> | null
}

export async function POST(request: Request) {
  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: '未登入' }, { status: 401 })
  const { data: profile } = await supa.from('users').select('role, team, is_active').eq('id', authUser.id).single()
  const allowed = !!profile && profile.is_active !== false && (
    ['admin', 'chairman', 'director', 'hr'].includes(profile.role) || profile.team === '財管部'
  )
  if (!allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 })

  let body: ProfileBody
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  if (!body.name?.trim()) return NextResponse.json({ error: '請填寫名稱' }, { status: 400 })
  if (!body.ideal || typeof body.ideal !== 'object') return NextResponse.json({ error: '請提供 ideal 維度分布' }, { status: 400 })
  for (const k of ['E', 'A', 'C', 'N', 'O']) {
    if (typeof body.ideal[k] !== 'number') return NextResponse.json({ error: `ideal.${k} 不是數字` }, { status: 400 })
  }

  const admin = createServiceRoleClient()
  if (body.id) {
    const { error } = await admin
      .from('bigfive_job_profiles')
      .update({
        name: body.name.trim(),
        description: body.description?.trim() || null,
        ideal: body.ideal,
        weights: body.weights || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, id: body.id })
  } else {
    const { data, error } = await admin
      .from('bigfive_job_profiles')
      .insert({
        name: body.name.trim(),
        description: body.description?.trim() || null,
        ideal: body.ideal,
        weights: body.weights || null,
        created_by: authUser.id,
      })
      .select('id')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message || '建立失敗' }, { status: 500 })
    return NextResponse.json({ success: true, id: data.id })
  }
}

export async function DELETE(request: Request) {
  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: '未登入' }, { status: 401 })
  const { data: profile } = await supa.from('users').select('role, team, is_active').eq('id', authUser.id).single()
  const allowed = !!profile && profile.is_active !== false && (
    ['admin', 'chairman', 'director', 'hr'].includes(profile.role) || profile.team === '財管部'
  )
  if (!allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const id = (searchParams.get('id') || '').trim()
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })
  const admin = createServiceRoleClient()
  const { error } = await admin.from('bigfive_job_profiles').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
