import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'

// POST /api/admin/assessments/submission/to-roster
// body: { id, chinese_name, english_name?, title?, category }
// 把面試錄取者加入 employees 名冊，並把該作答紀錄連結到新員工 id
export async function POST(request: Request) {
  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: '未登入' }, { status: 401 })
  const { data: profile } = await supa.from('users').select('role, team, is_active').eq('id', authUser.id).single()
  const allowed = !!profile && profile.is_active !== false && (
    ['admin', 'director', 'hr'].includes(profile.role) || profile.team === '財管部'
  )
  if (!allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 })

  let body: { id?: string; chinese_name?: string; english_name?: string; title?: string; category?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  const id = (body.id || '').trim()
  const name = (body.chinese_name || '').trim()
  const category = (body.category || '').trim()
  if (!id) return NextResponse.json({ error: '缺少 submission id' }, { status: 400 })
  if (!name) return NextResponse.json({ error: '姓名不可空白' }, { status: 400 })

  const ALLOWED_CAT = [
    'chairman', 'department_head', 'section_head', 'deputy_section_head',
    'supervisor', 'project_lead', 'operations', 'sales', 'staff',
  ]
  if (!ALLOWED_CAT.includes(category)) {
    return NextResponse.json({ error: '不允許的分類' }, { status: 400 })
  }

  const admin = createServiceRoleClient()

  // 查活動類型：員工測驗只是把人加進名冊，不設 hired_at；面試測驗才標記為已錄取
  const { data: sub } = await admin
    .from('assessment_submissions')
    .select('event_id')
    .eq('id', id)
    .single()
  let isInterview = false
  if (sub?.event_id) {
    const { data: ev } = await admin
      .from('assessment_events')
      .select('kind')
      .eq('id', sub.event_id)
      .single()
    isInterview = ev?.kind === 'interview'
  }

  // 取目前最大的 sort_order，新人放到最後面
  const { data: maxRow } = await admin
    .from('employees')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (maxRow?.sort_order ?? 0) + 1

  const { data: emp, error: insErr } = await admin
    .from('employees')
    .insert({
      chinese_name: name,
      english_name: (body.english_name || '').trim() || null,
      title: (body.title || '').trim() || null,
      category,
      sort_order: nextOrder,
    })
    .select('id, chinese_name')
    .single()
  if (insErr) return NextResponse.json({ error: '加入名冊失敗：' + insErr.message }, { status: 500 })

  // 把該作答紀錄連到新員工 id
  // - 面試活動：同時設 hired_at（視為錄取歸檔）
  // - 員工活動：只連結，不動 hired_at（只是補完分類）
  const patch: Record<string, unknown> = { hired_employee_id: emp.id }
  if (isInterview) patch.hired_at = new Date().toISOString()
  const { error: linkErr } = await admin
    .from('assessment_submissions')
    .update(patch)
    .eq('id', id)
  if (linkErr) return NextResponse.json({ error: '連結作答紀錄失敗：' + linkErr.message }, { status: 500 })

  return NextResponse.json({ success: true, employee: emp })
}
