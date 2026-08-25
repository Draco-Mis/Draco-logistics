import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'
import bigfiveTestJson from '@/data/bigfive-test.json'
import type { BigFiveScores, BigFiveTestJson, BigFiveDimension } from '@/types/bigfive'

const JSON_DATA = bigfiveTestJson as unknown as BigFiveTestJson
const DIM_KEYS = Object.keys(JSON_DATA.dimensions) as BigFiveDimension[]

export const maxDuration = 60

const SYSTEM_PROMPT = `你是一位資深的組織心理學顧問與團隊教練。將收到一個團隊成員的 Big Five 人格
特質匯總（每位成員的五大維度等級 + 群組平均），請輸出**團隊化學作用分析**。

【撰寫原則】
- 引用組織心理學概念但用繁體中文（台灣用法）自然闡述
- 每個結論都要落到具體職場情境，不只是抽象描述
- 引用維度時用情境化語言，禁止寫具體數字
- 平衡看待優勢與風險，給 HR / 部門主管可執行的建議

【輸出結構】請用繁體中文撰寫 800-1000 字。每節必須寫完整內容：

# 一、團隊人格輪廓
（120-160 字）描述整個團隊的群體性格樣貌，點出 2-3 個最鮮明的群體軸線
（如「整體偏執行型，創新導向不足」「外向能量充沛但細節敏感度低」），並指出組成密度
（同質 vs 異質）

# 二、團隊優勢

**1. 共同的天然強項**：（120 字左右）這支團隊在什麼類型的任務上特別佔優勢，給一個
典型情境

**2. 互補的多樣性**：（120 字左右）團隊裡誰補上誰的盲點？描述互補的人格組合如何
轉化為團隊韌性

# 三、團隊風險

**1. 結構性盲點**：（130 字左右）團隊在哪種任務情境下可能集體失準？
（如全部偏外向 → 缺乏深度思考；同質性高的盡責性低 → 容易拖延；
N 高與 N 低差距大 → 情緒節奏不同步…），解釋心理根源

**2. 衝突熱點**：（130 字左右）團隊內部最可能在哪種事件中爆發衝突？衝突會以什麼形式
浮現（公開爭論 / 暗流 / 退縮…）

# 四、給主管的領導建議
（150-200 字）綜合以上，列 3 個具體可執行的領導動作：

**1.** （第一個建議的具體做法）
**2.** （第二個建議的具體做法）
**3.** （第三個建議的具體做法）

每個建議要結合此團隊的特定人格分布，不要泛泛而談

【格式】
- 大段用 # 標題
- 小節用 **粗體**
- 段落間空行
- 不需要總結`

interface RequestBody {
  submission_ids?: string[]
  scope_label?: string  // 例如「業務部」「2025 新進人員」
  event_id?: string  // 來源活動 id（為了快取 key 區分不同活動的同組人）
  regenerate?: boolean  // 強制重新生成
}

export async function POST(request: Request) {
  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: '未登入' }, { status: 401 })
  const { data: profile } = await supa.from('users').select('role, team, is_active').eq('id', authUser.id).single()
  const allowed = !!profile && profile.is_active !== false && (
    ['admin', 'director', 'hr'].includes(profile.role) || profile.team === '財管部'
  )
  if (!allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 })

  let body: RequestBody
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  const ids = Array.isArray(body.submission_ids) ? body.submission_ids.filter(Boolean) : []
  if (ids.length < 2) return NextResponse.json({ error: '至少需要 2 位團隊成員' }, { status: 400 })
  if (ids.length > 30) return NextResponse.json({ error: '一次最多分析 30 位（避免超過 API 限制）' }, { status: 400 })
  const scopeLabel = (body.scope_label || '此團隊').trim()
  const eventId = (body.event_id || '').trim()
  const regenerate = !!body.regenerate

  // 快取 key：event_id（若有）+ 排序後的 ids（順序無關）
  const sortedIds = [...ids].sort()
  const cacheKey = `team:${eventId || 'noevent'}:${sortedIds.join('|')}`

  const admin = createServiceRoleClient()

  if (!regenerate) {
    const { data: cached, error: cacheErr } = await admin
      .from('bigfive_ai_artifacts')
      .select('profile, meta, created_at')
      .eq('cache_key', cacheKey)
      .maybeSingle()
    if (cacheErr) console.error('[bigfive/team-chemistry] 快取查詢失敗（可能是 migration 034 未套用）:', cacheErr.message)
    if (cached) {
      return NextResponse.json({
        profile: cached.profile,
        scope_label: cached.meta?.scope_label || scopeLabel,
        member_count: cached.meta?.member_count || sortedIds.length,
        avgs: cached.meta?.avgs || {},
        cached: true,
        generated_at: cached.created_at,
      })
    }
  }
  const { data: subs } = await admin
    .from('assessment_submissions')
    .select('id, respondent_name, english_name, department, bigfive_scores')
    .in('id', ids)

  type Sub = { id: string; respondent_name: string; english_name: string | null; department: string; bigfive_scores: BigFiveScores | null }
  const subsTyped = (subs as Sub[] | null) || []
  if (subsTyped.length < 2) return NextResponse.json({ error: '找不到指定成員的紀錄' }, { status: 404 })
  const valid = subsTyped.filter((s: Sub) => s.bigfive_scores) as (Sub & { bigfive_scores: BigFiveScores })[]
  if (valid.length < 2) return NextResponse.json({ error: '至少 2 位需有 Big Five 分數' }, { status: 400 })

  // 計算群組平均
  const sums: Record<string, number> = {}
  for (const k of DIM_KEYS) sums[k] = 0
  for (const s of valid) {
    const d = s.bigfive_scores.dimensions
    for (const k of DIM_KEYS) sums[k] += d[k]?.pct || 0
  }
  const avgs: Record<string, number> = {}
  for (const k of DIM_KEYS) avgs[k] = Math.round(sums[k] / valid.length)

  // 組成員工列表
  const memberLines = valid.map(s => {
    const d = s.bigfive_scores.dimensions
    const profile = DIM_KEYS.map(k => `${JSON_DATA.dimensions[k].label}=${d[k].level}`).join('、')
    return `- ${s.respondent_name}${s.english_name ? ' (' + s.english_name + ')' : ''}（${s.department}）：${profile}`
  }).join('\n')

  const avgLine = DIM_KEYS.map(k => `${JSON_DATA.dimensions[k].label}=${avgs[k]}%`).join('、')

  const userPrompt = `# 範圍：${scopeLabel}（共 ${valid.length} 位成員）

# 群組平均
${avgLine}

# 成員列表
${memberLines}

請依系統提示輸出團隊化學作用分析報告。`

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: '伺服器未設定 ANTHROPIC_API_KEY' }, { status: 500 })
  const client = new Anthropic({ apiKey })

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 5000,
      thinking: { type: 'disabled' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    })
    const final = await stream.finalMessage()
    const text = final.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text).join('\n').trim()
    if (!text) return NextResponse.json({ error: '生成內容為空' }, { status: 500 })

    // 永久快取
    const { error: upsertErr } = await admin
      .from('bigfive_ai_artifacts')
      .upsert({
        artifact_type: 'team_chemistry',
        cache_key: cacheKey,
        event_id: eventId || null,
        submission_ids: sortedIds,
        profile: text,
        meta: { scope_label: scopeLabel, member_count: valid.length, avgs },
        created_by: authUser.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'cache_key' })
    if (upsertErr) console.error('[bigfive/team-chemistry] 寫入快取失敗（可能是 migration 034 未套用，本次結果不會被快取）:', upsertErr.message)

    return NextResponse.json({
      profile: text,
      scope_label: scopeLabel,
      member_count: valid.length,
      avgs,
      cached: false,
      generated_at: new Date().toISOString(),
    })
  } catch (e) {
    return NextResponse.json({ error: 'AI 分析失敗：' + (e instanceof Error ? e.message : '未知錯誤') }, { status: 500 })
  }
}
