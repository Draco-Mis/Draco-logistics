// Email 寄送工具（使用 Resend API）
//
// 設定方式：
//   1. 在 https://resend.com 建立免費帳號
//   2. 驗證 dracolog.com 網域（或先用 onboarding@resend.dev 測試）
//   3. 取得 API key
//   4. 在 Vercel 加入環境變數：
//      - RESEND_API_KEY
//      - EMAIL_FROM  (例如：CRM 系統 <crm@dracolog.com>)

interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

export interface EmailResult {
  ok: boolean
  skipped?: boolean
  error?: string
  id?: string
}

const RESEND_URL = 'https://api.resend.com/emails'

export async function sendEmail(opts: SendEmailOptions): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM || 'CRM 系統 <onboarding@resend.dev>'

  // 沒設定 API key → 略過，不中斷流程
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY 未設定，略過寄信')
    return { ok: false, skipped: true, error: 'RESEND_API_KEY not configured' }
  }

  const body = {
    from,
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
    html: opts.html,
    ...(opts.text ? { text: opts.text } : {}),
  }

  try {
    const resp = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const json = await resp.json()

    if (!resp.ok) {
      console.error('[email] 寄送失敗:', json)
      return { ok: false, error: json.message || `HTTP ${resp.status}` }
    }
    return { ok: true, id: json.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[email] 例外:', msg)
    return { ok: false, error: msg }
  }
}

// ===================================================
// Email 模板
// ===================================================

export function emailTemplateWarning75(params: {
  salesName: string
  companyName: string
  customerId: string
  appUrl: string
}): { subject: string; html: string } {
  const { salesName, companyName, customerId, appUrl } = params
  const link = `${appUrl}/customers/${customerId}`
  return {
    subject: `【🟠 黃燈警示】「${companyName}」已進入第 75 天`,
    html: `
<!DOCTYPE html>
<html lang="zh-TW">
<body style="font-family: -apple-system, 'PingFang TC', 'Microsoft JhengHei', sans-serif; background: #f5f7fa; margin: 0; padding: 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
    <div style="background: #f97316; padding: 20px 24px;">
      <h1 style="color: white; margin: 0; font-size: 18px;">🟠 黃燈警示（第 75 天）</h1>
    </div>
    <div style="padding: 24px;">
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">${salesName} 您好：</p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">
        您負責的客戶 <strong style="color: #f97316;">「${companyName}」</strong> 已進入開發第 75 天，
        距離自動鎖檔只剩 <strong>15 天</strong>，請加速跟進。
      </p>
      <div style="background: #fff7ed; border-left: 4px solid #f97316; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0; color: #9a3412; font-size: 14px;">
          ⚠️ 若未在 90 天內將客戶狀態改為「洽談中」、「已成交」或「未成交」，系統將自動鎖檔，屆時其他業務可申請認領。
        </p>
      </div>
      <div style="text-align: center; margin: 28px 0 12px;">
        <a href="${link}" style="display: inline-block; background: #1e3a5f; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">
          前往客戶頁面
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 28px; text-align: center;">
        登泰國際物流營運管理平台 (Draco LOP) 系統自動發送
      </p>
    </div>
  </div>
</body>
</html>`,
  }
}

export function emailTemplateLocked90(params: {
  recipientName: string
  salesName: string
  companyName: string
  customerId: string
  appUrl: string
}): { subject: string; html: string } {
  const { recipientName, salesName, companyName, customerId, appUrl } = params
  const link = `${appUrl}/customers/${customerId}`
  return {
    subject: `【🔴 鎖檔通知】「${companyName}」已逾 90 天自動鎖檔`,
    html: `
<!DOCTYPE html>
<html lang="zh-TW">
<body style="font-family: -apple-system, 'PingFang TC', 'Microsoft JhengHei', sans-serif; background: #f5f7fa; margin: 0; padding: 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
    <div style="background: #dc2626; padding: 20px 24px;">
      <h1 style="color: white; margin: 0; font-size: 18px;">🔴 客戶鎖檔通知（第 90 天）</h1>
    </div>
    <div style="padding: 24px;">
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">${recipientName} 您好：</p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">
        客戶 <strong style="color: #dc2626;">「${companyName}」</strong>
        （負責業務：${salesName}）已逾 90 天，
        系統已自動鎖檔。
      </p>
      <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0; color: #991b1b; font-size: 14px;">
          📋 後續處理：原負責業務無法繼續編輯此客戶；其他業務可申請認領，由 Hans 或課長審核後重新計時 90 天。
        </p>
      </div>
      <div style="text-align: center; margin: 28px 0 12px;">
        <a href="${link}" style="display: inline-block; background: #1e3a5f; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">
          前往客戶頁面
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 28px; text-align: center;">
        登泰國際物流營運管理平台 (Draco LOP) 系統自動發送
      </p>
    </div>
  </div>
</body>
</html>`,
  }
}
