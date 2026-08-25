import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase-server'

// GET /api/assess/lookup?name=…
// 公開 endpoint：受測者填姓名時用來查名冊，支援中文姓名精確比對 / 英文名（大小寫不分）比對
// 為避免 SQL injection、特殊字元造成 PostgREST .or() 解析錯誤，前後分別查再合併
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('name') || '').trim()
  if (!q || q.length < 2) return NextResponse.json({ matches: [] })

  const admin = createServiceRoleClient()
  const [{ data: byChinese }, { data: byEnglish }] = await Promise.all([
    admin.from('employees')
      .select('chinese_name, english_name, title')
      .eq('chinese_name', q)
      .order('sort_order'),
    admin.from('employees')
      .select('chinese_name, english_name, title')
      .ilike('english_name', q)
      .order('sort_order'),
  ])

  // 去重（同一人可能兩邊都中）並保持順序
  const seen = new Set<string>()
  const matches: Array<{ chinese_name: string; english_name: string | null; title: string | null }> = []
  for (const r of [...(byChinese || []), ...(byEnglish || [])]) {
    const key = r.chinese_name
    if (seen.has(key)) continue
    seen.add(key)
    matches.push(r)
  }

  return NextResponse.json({ matches })
}
