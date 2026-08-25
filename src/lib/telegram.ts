// Telegram Bot 推播工具
//
// 設定：
//   1. 用 @BotFather 建立 Bot，取得 Bot Token
//   2. Vercel 加環境變數 TELEGRAM_BOT_TOKEN
//   3. 每位使用者在 CRM「更多」頁綁定自己的 Telegram ID
//
// 使用：
//   await sendTelegram(chatId, '你的通知內容')

export interface TelegramResult {
  ok: boolean
  skipped?: boolean
  error?: string
}

export async function sendTelegram(
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'Markdown' = 'HTML'
): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return { ok: false, skipped: true, error: 'TELEGRAM_BOT_TOKEN not set' }
  }
  if (!chatId) {
    return { ok: false, skipped: true, error: 'no chat_id' }
  }

  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    })
    const json = await resp.json()
    if (!json.ok) {
      return { ok: false, error: json.description || 'Telegram API error' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// 批次推播：自動查 users 表的 telegram_id，有設的才寄
export async function sendTelegramToUsers(
  supabase: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  userIds: string[],
  text: string
): Promise<{ sent: number; skipped: number }> {
  if (!process.env.TELEGRAM_BOT_TOKEN || userIds.length === 0) {
    return { sent: 0, skipped: userIds.length }
  }

  const { data: users } = await supabase
    .from('users')
    .select('id, telegram_id')
    .in('id', userIds)

  let sent = 0
  let skipped = 0
  for (const u of (users || [])) {
    if (u.telegram_id) {
      const r = await sendTelegram(u.telegram_id, text)
      if (r.ok) sent++; else skipped++
    } else {
      skipped++
    }
  }
  return { sent, skipped }
}
