import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase-server'

// POST /api/assess/[code]/bigfive/start
// body: { respondent_name, english_name?, department, employee_code? }
// 建立 Big Five submission，或沿用既有 in_progress
export async function POST(request: Request, { params }: { params: { code: string } }) {
  const code = params.code
  const admin = createServiceRoleClient()

  let body: { respondent_name?: string; english_name?: string; department?: string; employee_code?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  const name = (body.respondent_name || '').trim()
  const dept = (body.department || '').trim()
  const empCode = (body.employee_code || '').trim() || null
  let englishName = (body.english_name || '').trim() || null
  if (!name || !dept) {
    return NextResponse.json({ error: '請填寫姓名與部門' }, { status: 400 })
  }

  const { data: event } = await admin
    .from('assessment_events')
    .select('*')
    .eq('code', code)
    .maybeSingle()
  if (!event) return NextResponse.json({ error: '找不到此測驗連結' }, { status: 404 })
  if (!event.is_active) return NextResponse.json({ error: '此測驗已停用' }, { status: 410 })
  if (event.deadline && new Date(event.deadline) < new Date()) {
    return NextResponse.json({ error: '此測驗已截止' }, { status: 410 })
  }
  if (!Array.isArray(event.test_types) || !event.test_types.includes('bigfive')) {
    return NextResponse.json({ error: '此活動不是 Big Five 測驗' }, { status: 400 })
  }

  // 查員工名冊：取得英文名 + 員工 id（用來把作答紀錄歸檔到名冊）
  let employeeId: string | null = null
  if (name) {
    const { data: emp } = await admin
      .from('employees')
      .select('id, english_name')
      .eq('chinese_name', name)
      .maybeSingle()
    if (emp?.id) employeeId = emp.id
    if (!englishName && emp?.english_name) englishName = emp.english_name
  }

  // 防重複（completed）
  const { data: existingCompleted } = await admin
    .from('assessment_submissions')
    .select('id')
    .eq('event_id', event.id)
    .eq('respondent_name', name)
    .eq('department', dept)
    .eq('status', 'completed')
    .maybeSingle()
  if (existingCompleted) {
    return NextResponse.json({ error: '您已完成此測驗，無法重複作答' }, { status: 409 })
  }

  // 沿用 in_progress
  const { data: existingInProgress } = await admin
    .from('assessment_submissions')
    .select('*')
    .eq('event_id', event.id)
    .eq('respondent_name', name)
    .eq('department', dept)
    .eq('status', 'in_progress')
    .maybeSingle()

  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || request.headers.get('x-real-ip')
    || null

  let submissionId: string
  if (existingInProgress) {
    submissionId = existingInProgress.id
  } else {
    const { data: inserted, error: insErr } = await admin
      .from('assessment_submissions')
      .insert({
        event_id: event.id,
        respondent_name: name,
        english_name: englishName,
        department: dept,
        employee_code: empCode,
        version: 'A',  // Big Five 不打亂題序，固定填 A
        status: 'in_progress',
        ip_address: ip,
        hired_employee_id: employeeId,
      })
      .select()
      .single()
    if (insErr || !inserted) {
      return NextResponse.json({ error: '建立作答紀錄失敗：' + (insErr?.message || '未知') }, { status: 500 })
    }
    submissionId = inserted.id
  }

  return NextResponse.json({
    submission_id: submissionId,
    existing_answers: existingInProgress?.bigfive_answers ?? {},
  })
}
