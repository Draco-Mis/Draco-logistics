import { NextResponse } from 'next/server'

// 高雄即時天氣，改用 Open-Meteo（免費、無需 API key、Vercel 友善）
// 之前 wttr.in 在 Vercel serverless 環境常出現 timeout/rate limit/HTML 回應問題
export const revalidate = 1800  // 30 分鐘快取

interface OpenMeteoResp {
  current?: {
    temperature_2m?: number
    relative_humidity_2m?: number
    apparent_temperature?: number
    weather_code?: number
  }
}

// WMO weather code → 中文描述 + emoji
// https://open-meteo.com/en/docs#weathervariables
function codeToInfo(code?: number): { desc: string; emoji: string } {
  if (code == null) return { desc: '—', emoji: '🌤' }
  if (code === 0) return { desc: '晴朗', emoji: '☀️' }
  if (code === 1) return { desc: '大致晴朗', emoji: '🌤' }
  if (code === 2) return { desc: '局部多雲', emoji: '⛅' }
  if (code === 3) return { desc: '陰天', emoji: '☁️' }
  if (code === 45 || code === 48) return { desc: '霧', emoji: '🌫' }
  if (code >= 51 && code <= 55) return { desc: '毛毛雨', emoji: '🌦' }
  if (code >= 56 && code <= 57) return { desc: '凍雨', emoji: '🌧' }
  if (code >= 61 && code <= 65) return { desc: '降雨', emoji: '🌧' }
  if (code >= 66 && code <= 67) return { desc: '凍雨', emoji: '🌧' }
  if (code >= 71 && code <= 77) return { desc: '降雪', emoji: '❄️' }
  if (code >= 80 && code <= 82) return { desc: '陣雨', emoji: '🌧' }
  if (code >= 85 && code <= 86) return { desc: '陣雪', emoji: '❄️' }
  if (code === 95) return { desc: '雷雨', emoji: '⛈' }
  if (code === 96 || code === 99) return { desc: '雷雨夾雹', emoji: '⛈' }
  return { desc: '—', emoji: '🌤' }
}

export async function GET() {
  try {
    // 高雄市 (22.6273, 120.3014)
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=22.6273&longitude=120.3014&current=temperature_2m,relative_humidity_2m,weather_code,apparent_temperature&timezone=Asia%2FTaipei'
    const res = await fetch(url, {
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(5000),  // 5 秒超時，避免拖累首頁
    })
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `open-meteo ${res.status}` }, { status: 200 })
    }
    const data = (await res.json()) as OpenMeteoResp
    const cur = data.current
    if (!cur || cur.temperature_2m == null) {
      return NextResponse.json({ ok: false, error: 'no current data' }, { status: 200 })
    }
    const info = codeToInfo(cur.weather_code)
    return NextResponse.json({
      ok: true,
      tempC: Math.round(cur.temperature_2m),
      feelsLikeC: Math.round(cur.apparent_temperature ?? cur.temperature_2m),
      humidity: Math.round(cur.relative_humidity_2m ?? 0),
      desc: info.desc,
      emoji: info.emoji,
      city: '高雄',
    })
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : 'unknown',
    }, { status: 200 })
  }
}
