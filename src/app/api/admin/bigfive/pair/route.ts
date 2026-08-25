import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'
import bigfiveTestJson from '@/data/bigfive-test.json'
import type { BigFiveScores, BigFiveTestJson, BigFiveDimension } from '@/types/bigfive'

const JSON_DATA = bigfiveTestJson as unknown as BigFiveTestJson
const DIM_KEYS = Object.keys(JSON_DATA.dimensions) as BigFiveDimension[]

export const maxDuration = 60

const SYSTEM_PROMPT = `你是一位資深的組織心理學顧問與團隊教練。將收到兩位職場夥伴的 Big Five
人格特質報告，請輸出他們之間的**兩人配對分析**。

【撰寫原則】
- 引用組織心理學概念但用繁體中文（台灣用法）自然闡述
- 每個結論都要落到**具體職場情境**：會議發言、跨部門協作、衝突處理、決策共識、回饋給予等
- 引用維度時用情境化語言（「相對偏外向」「明顯內斂」），禁止寫具體數字
- 保持平衡中立，不偏袒任何一方

【輸出結構】請用繁體中文撰寫 700-900 字。每節必須寫完整內容（不能只列標題）：

# 一、配對概覽
（100-150 字）一段話描述兩人的人格組合屬於哪一類型（互補型 / 同調型 / 摩擦型 / 補位型…），
並指出最鮮明的兩個差異或共通點

# 二、合作的天然優勢

**1. 互補處在哪**：（120 字左右）兩人各自彌補對方什麼盲點 / 提供對方什麼資源，給一個
典型工作情境的例子

**2. 共事時的最佳節奏**：（120 字左右）建議兩人在哪種工作分配 / 溝通頻率 / 決策模式下
能發揮最佳組合戰力

# 三、潛在摩擦與化解

**1. 最容易卡關的地方**：（120 字左右）依兩人人格差異，預測會在哪種情境出現摩擦（時程
壓力、跨部門爭資源、給回饋…），並解釋摩擦的心理根源

**2. 給雙方各一個調整建議**：（120 字左右）對 A 一句具體建議、對 B 一句具體建議，
不要泛泛而論

# 四、適合的合作型態
（100-150 字）建議他們適合哪種職場關係：PM 配對 / mentor-mentee（誰當 mentor）/
peer review 搭擋 / 跨部門 liaison…，並說明為什麼

【格式】
- 大段用 # 標題
- 小節用 **粗體**：例如「**1. 互補處在哪**：…」
- 段落間空行
- 不需要總結`

interface RequestBody {
  a_submission_id?: string
  b_submission_id?: string
  regenerate?: boolean  // 強制重新生成，覆蓋快取
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
  const a = (body.a_submission_id || '').trim()
  const b = (body.b_submission_id || '').trim()
  const regenerate = !!body.regenerate
  if (!a || !b || a === b) return NextResponse.json({ error: '請挑選兩位不同的受測者' }, { status: 400 })

  // 快取 key：排序後的兩個 id 連接（順序無關）
  const [id1, id2] = [a, b].sort()
  const cacheKey = `pair:${id1}|${id2}`

  const admin = createServiceRoleClient()

  // 若非強制重新生成，先查快取
  if (!regenerate) {
    const { data: cached, error: cacheErr } = await admin
      .from('bigfive_ai_artifacts')
      .select('profile, meta, created_at')
      .eq('cache_key', cacheKey)
      .maybeSingle()
    if (cacheErr) console.error('[bigfive/pair] 快取查詢失敗（可能是 migration 034 未套用）:', cacheErr.message)
    if (cached) {
      return NextResponse.json({
        profile: cached.profile,
        a: cached.meta?.a,
        b: cached.meta?.b,
        cached: true,
        generated_at: cached.created_at,
      })
    }
  }
  const { data: subs } = await admin
    .from('assessment_submissions')
    .select('id, respondent_name, english_name, department, bigfive_scores')
    .in('id', [a, b])

  type Sub = { id: string; respondent_name: string; english_name: string | null; department: string; bigfive_scores: BigFiveScores | null }
  const subsTyped = (subs as Sub[] | null) || []
  if (subsTyped.length !== 2) return NextResponse.json({ error: '找不到指定的兩筆紀錄' }, { status: 404 })
  for (const s of subsTyped) {
    if (!s.bigfive_scores) return NextResponse.json({ error: `「${s.respondent_name}」尚未完成 Big Five` }, { status: 400 })
  }
  const aSub = subsTyped.find((s: Sub) => s.id === a)!
  const bSub = subsTyped.find((s: Sub) => s.id === b)!

  function dimRows(name: string, scores: BigFiveScores) {
    return DIM_KEYS.map(k => {
      const d = scores.dimensions[k]
      const meta = JSON_DATA.dimensions[k]
      return `- ${meta.label}（${k}）：${d.level}（${d.pct}%）`
    }).join('\n')
  }

  const userPrompt = `# A 方：${aSub.respondent_name}${aSub.english_name ? ' (' + aSub.english_name + ')' : ''}（${aSub.department}）
${dimRows('A', aSub.bigfive_scores as BigFiveScores)}

# B 方：${bSub.respondent_name}${bSub.english_name ? ' (' + bSub.english_name + ')' : ''}（${bSub.department}）
${dimRows('B', bSub.bigfive_scores as BigFiveScores)}

請依系統提示輸出兩人配對分析報告。`

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: '伺服器未設定 ANTHROPIC_API_KEY' }, { status: 500 })
  const client = new Anthropic({ apiKey })

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      thinking: { type: 'disabled' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    })
    const final = await stream.finalMessage()
    const text = final.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text).join('\n').trim()
    if (!text) return NextResponse.json({ error: '生成內容為空' }, { status: 500 })

    const aMeta = { name: aSub.respondent_name, english: aSub.english_name, department: aSub.department }
    const bMeta = { name: bSub.respondent_name, english: bSub.english_name, department: bSub.department }

    // 永久快取：upsert by cache_key（regenerate 時會覆蓋）
    const { error: upsertErr } = await admin
      .from('bigfive_ai_artifacts')
      .upsert({
        artifact_type: 'pair',
        cache_key: cacheKey,
        submission_ids: [id1, id2],
        profile: text,
        meta: { a: aMeta, b: bMeta },
        created_by: authUser.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'cache_key' })
    if (upsertErr) console.error('[bigfive/pair] 寫入快取失敗（可能是 migration 034 未套用，本次結果不會被快取）:', upsertErr.message)

    return NextResponse.json({
      profile: text,
      a: aMeta,
      b: bMeta,
      cached: false,
      generated_at: new Date().toISOString(),
    })
  } catch (e) {
    return NextResponse.json({ error: 'AI 分析失敗：' + (e instanceof Error ? e.message : '未知錯誤') }, { status: 500 })
  }
}
