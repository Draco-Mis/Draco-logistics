import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server'
import bigfiveTestJson from '@/data/bigfive-test.json'
import type { BigFiveScores, BigFiveTestJson } from '@/types/bigfive'
import { analyzeDeterministic, formatAnalysisForAI } from '@/lib/bigfive-deterministic'

// Node runtime + streaming（Vercel 文件：streaming functions 不受 maxDuration 限制）
// 但需要：
// 1. 使用 Web Streams API（ReadableStream）—— 已做
// 2. 避免緩衝相關 header 干擾 —— 已調整
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const JSON_DATA = bigfiveTestJson as unknown as BigFiveTestJson

// 基層員工視角的系統 prompt — 將分析重點從「領導/管理他人」轉為「個人做事風格 + 與主管/
// 同事的協作 + 自我成長」，適合 OP / 業務 / 一般職員 / 主任 等非帶人職位
const SYSTEM_PROMPT_STAFF = `你是一位資深的組織心理學顧問與職涯教練，專長將 Big Five 五大
人格特質測驗結果，解讀為適合「個人貢獻者（IC / 基層員工）」自我認識與發展的專業報告。
你的對象不是帶人主管，所以分析重點是「他**自己**怎麼做事、怎麼跟主管同事互動、怎麼成長」，
**不要分析他如何當主管帶人**。

【嚴格資料邊界】
- **你只能依據 Big Five 五大維度分數做分析**。禁止依姓名、英文名、性別、部門名稱
  或員工編號推測這個人的背景、職涯經歷、家庭狀況、過往工作表現
- 即使姓名或部門透露某些線索（如「業務部」「OP助理」），**不要假設這個人實際做什麼業務、
  服務什麼客戶、家裡幾口人**
- 情境舉例請用**通用職場場景**（如「跨部門協作」「給部屬回饋」「面對突發需求」），
  不要具體化為「上次客戶 A 公司」「你之前的主管」這種對特定個人的描述
- 你不認識這個人，不知道他/她的歷史，只能從五大維度推論**性格上的傾向**

【撰寫原則】
- 引用組織心理學概念（如自我決定理論、心流、認知負荷、職人精神）但用繁體中文（台灣
  用法）自然闡述
- **每個論點都要落到具體職場情境**：日常任務、跟主管溝通、跨同事協作、面對壓力、回應
  客訴、學習新技能等
- 引用 Big Five 維度時用情境化語言（「相對偏外向」「明顯內斂」），**禁止寫具體數字**
- 語氣中立平衡、像在跟受測者本人對話的口吻

【極其重要的輸出規則】
這是一份完整的個人發展報告。**每一小節都必須寫出完整內容**，不能只列標題。每小節
按指定字數寫，不要超過。

【輸出結構】開頭一行人格原型 + 六大段，每段都要完整寫到：

【人格原型：】{6-12 字的個人化原型名稱}
※ 報告的第一行必須是上述格式，例如「【人格原型：】冷靜決斷的執行守護者」
※ 這個名稱要為這位受測者量身打造，反映其五大維度獨特組合，不要用通用標籤
※ 命名公式建議：{形容詞}+{形容詞}+{角色/類型}，例如：
  - 「熱情串聯型協調者」「沉穩務實的執行專家」「敏銳多疑的觀察分析者」
  - 「外向善感的人脈經營者」「內斂專注的品質守門員」「變通務實的問題解決者」
※ 不要照抄上述範例，依五大維度組合新創一個獨特名稱

# 一、人格輪廓
（80-100 字一段）整體個性樣貌 + 一個典型工作場景（如「下午接到突發任務時的他⋯」）

# 二、做事風格與個人決策
**1. 工作節奏與風格**：（80-90 字）細節導向 vs 大局思考、流程派 vs 變通派，含具體
情境舉例
**2. 個人做選擇的天然優勢**：（80-90 字）碰到要拍板的小事（如客戶要選方案 A 或 B）時，
這份人格如何幫他做出好決定
**3. 最容易卡住的盲點**：（80-90 字）日常工作上會踩雷的地方（如太細節走不出去、太
flex 缺紀律…）

# 三、跟主管與同事的協作
**1. 跟什麼樣的同事合作最順**：（80-90 字）用人格描述對方類型，舉一個合作場景
**2. 跟什麼樣的主管最 match**：（80-90 字）描述他比較能 thrive 的主管風格（會給細節
指引 vs 給空間發揮 / 直接 vs 鋪墊…）
**3. 同事或主管最容易誤解他的點**：（80-90 字）這份人格最常被誤讀（如冷淡、不主動、
太挑剔…），並解釋為什麼會被誤讀
**4. 主動可以調整的小行為**：（70-80 字）給 2-3 個具體可做的事（如「週會主動發言一次」
「回 mail 加一句感謝」）

# 四、自我激勵與工作節奏
**1. 激勵驅動因子**：（90-100 字）從「自主性/精熟感/目的感/被認可/安全感/連結感」挑出
2-3 個讓他在工作上「真的有動力」的因子，舉例什麼任務會讓他眼神發亮
**2. 適合接收的回饋方式**：（90-100 字）他希望主管怎麼給回饋——直接 vs 鋪墊、公開 vs
私下、即時 vs 定期、書面 vs 口頭，並附一個錯誤示範
**3. 強項過度發揮時的副作用**：（90-100 字）他的某個強項在壓力下會變成什麼弱點

# 五、個人發展建議
**1. 在現職的 3 種發揮方向**：（100-120 字）即使不升管理職，這份人格可以往哪些「個人
貢獻者方向」發展（如：技術深耕、跨領域 generalist、客戶關係、內部流程改善…），各一
句說明適合原因
**2. 6 / 12 / 24 個月個人成長目標**：（100-120 字）給三個時間點各一個可執行的具體目標
（如「半年內練成可以獨立簽核 X 案件」「一年內成為部門裡的 SOP 寫手」）

# 六、刻意練習路徑（**最重要的一段，要極具體**）
**1. 最需要刻意練習的一件事**：（70-80 字）挑一個可觀察的具體行為
**2. 為什麼這對你特別難改**：（90-100 字）從人格組合的心理機制解釋
**3. 你在什麼情境最容易退回舊模式**：（90-100 字）列 2-3 種高風險情境
**4. 明天就能開始的小練習**：（90-100 字）1-2 個 24 小時內可做、極具體的微練習動作，
要寫到時間/場合/語句。錯誤示範：「練習主動」；正確示範：「明早收信時，看到主管的
mail，5 分鐘內回一封確認收到 + 預計交期，連續一週」

總長度約 1400-1700 字。請依序完整輸出六大段，不要漏段。`

const SYSTEM_PROMPT = `你是一位資深的組織心理學顧問與 ICF 認證高階教練，專長將 Big Five 五大人格特質
測驗結果，解讀成可直接用於企業人才發展與團隊管理的專業分析報告。

【嚴格資料邊界】
- **你只能依據 Big Five 五大維度分數做分析**。禁止依姓名、英文名、性別、部門名稱
  或員工編號推測這個人的背景、職涯經歷、家庭狀況、過往工作表現
- 即使姓名或部門透露某些線索，**不要假設這個人實際做什麼工作、服務什麼客戶、過去成就如何**
- 情境舉例請用**通用職場場景**（如「主持週會」「給部屬回饋」「跨部門爭資源」），
  不要具體化為「你之前的某個專案」這種對特定個人的描述
- 你不認識這個人，不知道他/她的歷史，只能從五大維度推論**性格上的傾向**

【撰寫原則】
- 引用組織心理學概念（如轉型領導、心理安全感、損失規避、認知負荷、自我決定理論等）
  但用繁體中文（台灣用法）自然闡述
- **每一個論點都必須落到具體職場情境**：週會、跨部門協作、壓力下決策、給予部屬回饋、
  專案延遲應變等。不要只描述「他很外向 / 他很細膩」這種抽象標籤
- 引用 Big Five 維度時用情境化語言（「相對偏外向」「明顯內斂」「對細節很敏感」），
  **禁止寫具體數字**（如「外向性 73 分」）
- 語氣平衡、中立、有教練感；避免阿諛、避免說教

【極其重要的輸出規則】
這是一份**完整的人格分析報告**，不是模板填空。**每一個小節都必須寫出完整的分析內容**，
不能只列標題。每個小節至少 100 字，包含：1 個職場情境 + 1 個具體說明 + 1 個可操作建議。

【輸出範例】
> **1. 可能的領導風格**：偏向「支援型 + 教練型」的混合風格。在帶領新進同仁時會表現得
> 特別投入，傾向多花時間在 1-on-1 對話、了解部屬的成長卡關點，並用提問引導他們自己
> 找到答案。會議中也會傾向先聽完團隊意見再表態，避免過早收斂。但在跨部門爭資源、
> 需要快速拍板的情境下，這種「先聽再說」的風格可能會讓對方覺得他不夠果斷。

【輸出結構】六大段，每段都要完整寫到，不能省略。**每節按指定字數寫**，不要超過：

# 一、人格輪廓
（一段 80-100 字）整體樣貌 + 一個典型工作場景

# 二、領導與決策
**1. 可能的領導風格**：（80-90 字）含具體工作情境
**2. 帶人與做決策的天然優勢**：（80-90 字）配一個情境
**3. 最容易踩到的盲點**：（80-90 字）指出 1-2 個

# 三、協作與人際
**1. 合作最順暢的特質類型**：（80-90 字）
**2. 最容易產生摩擦的特質類型**：（80-90 字）解釋心理根源
**3. 下屬或同事最可能對我的誤解**：（80-90 字）
**4. 針對誤解可以主動做的調整**：（70-80 字）2-3 個具體行為

# 四、激勵與管理
**1. 激勵驅動因子**：（90-100 字）從「自主/精熟/目的/認可/安全/連結」挑 2-3 個主導
因子 + 主管怎麼用的具體例子
**2. 適合的回饋風格**：（90-100 字）四面向：直接 vs 鋪墊 / 公開 vs 私下 / 即時 vs 定期
/ 書面 vs 口頭，附錯誤示範
**3. 強項過度發揮的副作用**：（90-100 字）

# 五、職涯與發展建議
**1. 適合的 3 條職涯軌跡**：（100-120 字）每條一句說明適合原因
**2. 6 / 12 / 24 個月發展建議**：（100-120 字）三個時間點各一個具體可執行目標

# 六、刻意練習路徑（**最重要的一段，要極具體**）
**1. 最需要刻意練習的一件事**：（70-80 字）挑一個可觀察的具體行為
**2. 為什麼這對他特別難改**：（90-100 字）從人格組合的心理機制解釋
**3. 你在什麼情境最容易退回舊模式**：（90-100 字）列 2-3 種高風險情境
**4. 明天就能開始的小練習**：（90-100 字）1-2 個 24 小時內可做、極具體（時間/場合/
語句）的動作。錯誤示範：「練習表達自己」；正確示範：「明早晨會輪到你發言時，逼自己
第一個說話，持續一週」

總長度約 1400-1700 字。請依照次序完整輸出六大段，不要漏段。

【格式】
- 五大段用 # 標題（# 一、人格輪廓）
- 小節用行內 **粗體**：**1. xxxx**：接著實質內容
- 段落之間空一行
- 不要在報告結尾加總結語`

interface RequestBody {
  submission_id?: string
  regenerate?: boolean
  // 2-call 分段生成：part 1 = 第一到三段；part 2 = 第四到六段
  part?: 1 | 2
  // part 2 必須附上 part 1 已生成的內容，讓 AI 不重複也能銜接
  previous_text?: string
  // 分析視角：manager（管理職）/ staff（基層員工）。預設 manager（向後相容）
  viewpoint?: 'manager' | 'staff'
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
  const submissionId = (body.submission_id || '').trim()
  if (!submissionId) return NextResponse.json({ error: '缺少 submission_id' }, { status: 400 })
  const regenerate = !!body.regenerate
  const part = body.part === 2 ? 2 : 1
  const previousText = (body.previous_text || '').trim()
  const viewpoint: 'manager' | 'staff' = body.viewpoint === 'staff' ? 'staff' : 'manager'

  const admin = createServiceRoleClient()
  const { data: sub } = await admin
    .from('assessment_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle()
  if (!sub) return NextResponse.json({ error: '找不到作答紀錄' }, { status: 404 })
  if (sub.status !== 'completed' || !sub.bigfive_scores) {
    return NextResponse.json({ error: '此筆尚未完成計分，無法生成分析' }, { status: 400 })
  }

  // 只有 part 1 才檢查快取；依照當前 viewpoint 讀對應欄位
  const cachedProfile = viewpoint === 'staff' ? sub.bigfive_ai_profile_staff : sub.bigfive_ai_profile_manager
  const cachedAt = viewpoint === 'staff' ? sub.bigfive_ai_profile_staff_at : sub.bigfive_ai_profile_manager_at
  if (part === 1 && cachedProfile && !regenerate) {
    return new Response(cachedProfile, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Generated-At': cachedAt || '',
        'X-Viewpoint': viewpoint,
        'X-Cached': 'true',
      },
    })
  }

  const scores = sub.bigfive_scores as BigFiveScores
  const dimRows = (Object.keys(scores.dimensions) as Array<keyof typeof scores.dimensions>).map(k => {
    const d = scores.dimensions[k]
    const meta = JSON_DATA.dimensions[k]
    return `- ${meta.label}（${k}）：${d.level}（${d.pct}%）— ${meta.short_desc}`
  }).join('\n')

  // 把規則演算的「分析參考」作為輔助線索給 AI，但不強制採用
  // 平衡：AI 仍可深度分析（保留準確度）；同時有規則作 anchor 降低變異
  const detAnalysis = analyzeDeterministic(scores, viewpoint)
  const referenceHint = `

【系統輔助分析線索（僅供參考，可以採用、調整、或基於更細膩的觀察推翻）】
- 推算的強項方向：${detAnalysis.strengths.map(s => s.label).join('、')}
- 推算的弱點方向：${detAnalysis.weaknesses.map(w => w.label).join('、')}
- 推算的職涯方向：${detAnalysis.careers.map(c => c.title).join('、')}
- 推算的激勵因子：${detAnalysis.motivations.map(m => m.label).join('、')}
請以你對五大維度的整體判斷為主，這些只是 baseline。`

  // 故意不送員工編號（無分析價值），避免 AI 猜測背景
  // 姓名與部門僅供報告稱呼，已在系統 prompt 中明示禁止依此推測歷史
  const profileHeader = `# 受測者基本資料（僅供稱呼，禁止從中推測歷史）
受測者：${sub.respondent_name}${sub.english_name ? ' (' + sub.english_name + ')' : ''}
部門：${sub.department}（僅作為情境例子的方向性參考，不要假設具體職務內容）

# Big Five 五大人格特質分數
${dimRows}${referenceHint}`

  const userPrompt = part === 1
    ? `${profileHeader}

【本次任務】請依系統提示輸出報告的**前半段：第一段（人格輪廓）+ 第二段（領導與決策）+
第三段（協作與人際）**。三段都要完整寫到，不要超過或省略任何小節，**不要寫第四段以後**。
報告第一行必須是「【人格原型：】{6-12 字個人化名稱}」，反映其五大維度獨特組合。`
    : `${profileHeader}

【已經完成的前半段】
${previousText || '（前半段已生成，請直接接續）'}

【本次任務】接續上面的內容，輸出報告的**後半段：第四段（激勵與管理）+ 第五段（職涯與
發展建議）+ 第六段（刻意練習路徑）**。三段都要完整寫到，每個小節都要展開。
**請勿重複前半段已寫的內容**，直接從「# 四、激勵與管理」開頭。`

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: '伺服器未設定 ANTHROPIC_API_KEY 環境變數' }, { status: 500 })
  }
  const client = new Anthropic({ apiKey })

  try {
    // 改回 Sonnet 4.6 + 2-call 分段生成：
    // 升級到 Opus 4.7 + adaptive thinking — 取得最深的多維度互動推理
    // - 2-call 分段確保每段 ~25-40 秒內完成，符合 Vercel 60s 限制
    // - 不再傳 temperature（Opus 4.7 已移除 sampling 參數，傳了會 400）
    // - thinking adaptive 讓模型自行決定何時 / 多少思考
    // - 不傳 effort 避免 SDK / API 版本不一致導致拒收
    // - 單次成本 ~$0.10 (NT$ 3.2)，比 Sonnet 多 NT$ 1.2 換來更深洞察
    const stream = client.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 5000,
      thinking: { type: 'adaptive' },
      system: [
        { type: 'text', text: viewpoint === 'staff' ? SYSTEM_PROMPT_STAFF : SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    })

    const encoder = new TextEncoder()
    let fullText = ''
    let stopReason: string | null = null

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // 逐個 chunk 推到 client；同時捕捉 message_delta 取得 stop_reason
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              const piece = event.delta.text
              fullText += piece
              controller.enqueue(encoder.encode(piece))
            } else if (event.type === 'message_delta' && event.delta.stop_reason) {
              stopReason = event.delta.stop_reason
            }
          }

          // 若是 max_tokens 截斷，附上提醒讓 client 知道
          if (stopReason === 'max_tokens') {
            const note = '\n\n[NOTE] 內容因達到 token 上限被截斷'
            fullText += note
            controller.enqueue(encoder.encode(note))
          }

          // 先寫 DB 才關 stream — 否則 Vercel 可能在 client 收到完整內容後
          // 就把 function 砍掉，導致 DB 寫入沒完成、之後重開 modal 內容只剩一半
          if (fullText.trim()) {
            const toSave = part === 2 && previousText
              ? previousText + '\n\n' + fullText.trim()
              : fullText.trim()
            const generatedAt = new Date().toISOString()
            const patch: Record<string, unknown> = viewpoint === 'staff'
              ? { bigfive_ai_profile_staff: toSave, bigfive_ai_profile_staff_at: generatedAt }
              : { bigfive_ai_profile_manager: toSave, bigfive_ai_profile_manager_at: generatedAt }
            await admin.from('assessment_submissions').update(patch).eq('id', submissionId)
          }
          // 寫完才關閉串流，確保整個請求生命週期都還活著
          controller.close()
        } catch (e) {
          // 串流中途失敗 → 把錯誤訊息推進去結尾，並關閉
          const msg = e instanceof Error ? e.message : '未知錯誤'
          try { controller.enqueue(encoder.encode(`\n\n[ERROR] AI 生成中斷：${msg}`)) } catch {}
          try { controller.close() } catch {}
          // 即使中斷也試著把已產生的部分存進對應視角欄位
          if (fullText.trim()) {
            try {
              const toSave = part === 2 && previousText
                ? previousText + '\n\n' + fullText.trim() + `\n\n[ERROR] 生成中斷：${msg}`
                : fullText.trim() + `\n\n[ERROR] 生成中斷：${msg}`
              const generatedAt = new Date().toISOString()
              const patch: Record<string, unknown> = viewpoint === 'staff'
                ? { bigfive_ai_profile_staff: toSave, bigfive_ai_profile_staff_at: generatedAt }
                : { bigfive_ai_profile_manager: toSave, bigfive_ai_profile_manager_at: generatedAt }
              await admin.from('assessment_submissions').update(patch).eq('id', submissionId)
            } catch {}
          }
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    })
  } catch (e) {
    // 詳細記錄錯誤協助診斷
    console.error('[bigfive/profile] Error:', e)
    const errInfo: { name?: string; message?: string; status?: number; type?: string } = {}
    if (e instanceof Error) {
      errInfo.name = e.name
      errInfo.message = e.message
    }
    // Anthropic SDK APIError 會有額外欄位
    const anthropicErr = e as { status?: number; error?: { type?: string; message?: string } }
    if (anthropicErr.status) errInfo.status = anthropicErr.status
    if (anthropicErr.error?.type) errInfo.type = anthropicErr.error.type
    if (anthropicErr.error?.message) errInfo.message = anthropicErr.error.message

    return NextResponse.json({
      error: 'AI 分析失敗：' + (errInfo.message || '未知錯誤'),
      debug: errInfo,
    }, { status: 500 })
  }
}
