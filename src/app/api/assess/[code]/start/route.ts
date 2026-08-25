import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase-server'
import logicTestJson from '@/data/logic-test.json'
import { shuffleForVersion } from '@/lib/logic-test-shuffle'
import type { LogicTestJson, LogicTestVersion } from '@/types/logic-test'

const JSON_DATA = logicTestJson as unknown as LogicTestJson

// POST /api/assess/[code]/start
// body: { respondent_name, department, employee_code? }
// 流程：驗證活動有效 → 檢查同名+部門不可重複完成 → 隨機選版本 → 建立 submission → 回傳 shuffled questions + submission_id + version
export async function POST(request: Request, { params }: { params: { code: string } }) {
  const code = params.code
  const admin = createServiceRoleClient()

  let body: { respondent_name?: string; department?: string; employee_code?: string; english_name?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  const name = (body.respondent_name || '').trim()
  const dept = (body.department || '').trim()
  const empCode = (body.employee_code || '').trim() || null
  let englishName = (body.english_name || '').trim() || null

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
  if (!name || !dept) {
    return NextResponse.json({ error: '請填寫姓名與部門' }, { status: 400 })
  }

  // 找活動
  const { data: event } = await admin
    .from('assessment_events')
    .select('*')
    .eq('code', code)
    .maybeSingle()
  if (!event) {
    return NextResponse.json({ error: '找不到此測驗連結' }, { status: 404 })
  }
  if (!event.is_active) {
    return NextResponse.json({ error: '此測驗已停用' }, { status: 410 })
  }
  if (event.deadline && new Date(event.deadline) < new Date()) {
    return NextResponse.json({ error: '此測驗已截止' }, { status: 410 })
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

  // 若有同人同部門的 in_progress，沿用（避免重複建立）
  const { data: existingInProgress } = await admin
    .from('assessment_submissions')
    .select('*')
    .eq('event_id', event.id)
    .eq('respondent_name', name)
    .eq('department', dept)
    .eq('status', 'in_progress')
    .maybeSingle()

  // 隨機版本（用日期+name+dept 做 seed 也行，這裡直接 Math.random 簡單）
  const versions: LogicTestVersion[] = JSON_DATA.meta.versions
  let version: LogicTestVersion
  let submissionId: string

  // IP（best-effort，從 header）
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || request.headers.get('x-real-ip')
    || null

  if (existingInProgress) {
    submissionId = existingInProgress.id
    version = existingInProgress.version as LogicTestVersion
  } else {
    version = versions[Math.floor(Math.random() * versions.length)]
    const { data: inserted, error: insErr } = await admin
      .from('assessment_submissions')
      .insert({
        event_id: event.id,
        respondent_name: name,
        english_name: englishName,
        department: dept,
        employee_code: empCode,
        version,
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

  // 產生打亂後的題目（不送 answer）
  const { shuffledItems } = shuffleForVersion(code, version, JSON_DATA.items)

  return NextResponse.json({
    submission_id: submissionId,
    version,
    items: shuffledItems,
    categories: JSON_DATA.categories,
    existing_answers: existingInProgress?.logic_answers ?? {},
  })
}
