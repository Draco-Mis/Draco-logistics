import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'

// POST /api/admin/assessments/submission/update
// body: { id, respondent_name?, department?, employee_code? }
// 修正單筆受測者紀錄的基本資料（最常用：員工自己打錯名字）
export async function POST(request: Request) {
  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: '未登入' }, { status: 401 })
  const { data: profile } = await supa.from('users').select('role, team, is_active').eq('id', authUser.id).single()
  const allowed = !!profile && profile.is_active !== false && (
    ['admin', 'director', 'hr'].includes(profile.role) || profile.team === '財管部'
  )
  if (!allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 })

  let body: { id?: string; respondent_name?: string; english_name?: string; department?: string; employee_code?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  const id = (body.id || '').trim()
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof body.respondent_name === 'string') {
    const name = body.respondent_name.trim()
    if (!name) return NextResponse.json({ error: '姓名不可空白' }, { status: 400 })
    if (name.length > 50) return NextResponse.json({ error: '姓名過長' }, { status: 400 })
    patch.respondent_name = name
  }
  if (typeof body.english_name === 'string') patch.english_name = body.english_name.trim() || null
  if (typeof body.department === 'string') patch.department = body.department.trim() || null
  if (typeof body.employee_code === 'string') patch.employee_code = body.employee_code.trim() || null

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '沒有要更新的欄位' }, { status: 400 })
  }

  const admin = createServiceRoleClient()

  // 若姓名有更動，且該筆作答尚未連結到員工（hired_employee_id 為 null），
  // 嘗試用新姓名比對員工名冊重新歸檔。若 hired_employee_id 已有值（如面試錄取），
  // 不覆蓋以免破壞既有歸檔。
  if (typeof patch.respondent_name === 'string') {
    const { data: existing } = await admin
      .from('assessment_submissions')
      .select('hired_employee_id')
      .eq('id', id)
      .maybeSingle()
    if (existing && !existing.hired_employee_id) {
      const { data: emp } = await admin
        .from('employees')
        .select('id')
        .eq('chinese_name', patch.respondent_name)
        .maybeSingle()
      if (emp?.id) patch.hired_employee_id = emp.id
    }
  }

  const { error } = await admin.from('assessment_submissions').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: '更新失敗：' + error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
