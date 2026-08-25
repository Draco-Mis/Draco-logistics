import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'

// GET /api/admin/employees/[id]/submissions
// 取得指定員工的所有測驗紀錄（依完成時間排序）
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: '未登入' }, { status: 401 })
  const { data: profile } = await supa.from('users').select('role, team, is_active').eq('id', authUser.id).single()
  const allowed = !!profile && profile.is_active !== false && (
    ['admin', 'chairman', 'director', 'hr'].includes(profile.role) || profile.team === '財管部'
  )
  if (!allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 })

  const employeeId = params.id
  const admin = createServiceRoleClient()

  // 1. 找出歷史所有以「員工 FK」歸檔的紀錄
  const { data: byFk, error: byFkErr } = await admin
    .from('assessment_submissions')
    .select(`
      id, event_id, respondent_name, english_name, department, employee_code,
      status, started_at, completed_at,
      logic_scores, bigfive_scores,
      hired_employee_id,
      assessment_events!event_id(id, code, name, kind, test_types)
    `)
    .eq('hired_employee_id', employeeId)
    .order('completed_at', { ascending: false, nullsFirst: false })
  if (byFkErr) return NextResponse.json({ error: byFkErr.message }, { status: 500 })

  // 2. 若有些舊紀錄沒連 FK，但中文姓名跟此員工一致，也帶出來（避免遺漏）
  const { data: empRow } = await admin
    .from('employees')
    .select('chinese_name')
    .eq('id', employeeId)
    .maybeSingle()
  type Row = NonNullable<typeof byFk>[number]
  let byName: Row[] = []
  if (empRow?.chinese_name) {
    const existingIds = new Set((byFk || []).map((r: Row) => r.id))
    const { data } = await admin
      .from('assessment_submissions')
      .select(`
        id, event_id, respondent_name, english_name, department, employee_code,
        status, started_at, completed_at,
        logic_scores, bigfive_scores,
        hired_employee_id,
        assessment_events!event_id(id, code, name, kind, test_types)
      `)
      .eq('respondent_name', empRow.chinese_name)
      .is('hired_employee_id', null)
      .order('completed_at', { ascending: false, nullsFirst: false })
    byName = ((data as Row[] | null) || []).filter((r: Row) => !existingIds.has(r.id))
  }

  return NextResponse.json({
    submissions: [...(byFk || []), ...byName],
  })
}
