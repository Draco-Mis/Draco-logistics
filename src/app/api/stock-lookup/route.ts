import { NextResponse } from 'next/server'

// 台灣上市/上櫃公司代號查詢 API
// 資料來源：證券交易所 & 櫃檯買賣中心公開 API
// 快取 24 小時，避免每次都打外部 API

interface StockCompany {
  code: string        // 股票代號
  name: string        // 公司全名
  shortName: string   // 公司簡稱
  type: '上市' | '上櫃'
}

let cache: StockCompany[] = []
let cacheTime = 0
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 小時

async function fetchAll(): Promise<StockCompany[]> {
  const now = Date.now()
  if (cache.length > 0 && now - cacheTime < CACHE_TTL) return cache

  const results: StockCompany[] = []

  try {
    // 上市公司
    const twseResp = await fetch('https://openapi.twse.com.tw/v1/opendata/t187ap03_L', {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 86400 },
    })
    if (twseResp.ok) {
      const data = await twseResp.json()
      for (const item of data) {
        if (item['公司代號'] && item['公司名稱']) {
          results.push({
            code: String(item['公司代號']).trim(),
            name: String(item['公司名稱']).trim(),
            shortName: String(item['公司簡稱'] || '').trim(),
            type: '上市',
          })
        }
      }
    }
  } catch (e) {
    console.warn('[stock-lookup] TWSE fetch failed:', e)
  }

  try {
    // 上櫃公司
    const tpexResp = await fetch('https://openapi.twse.com.tw/v1/opendata/t187ap03_O', {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 86400 },
    })
    if (tpexResp.ok) {
      const data = await tpexResp.json()
      for (const item of data) {
        if (item['公司代號'] && item['公司名稱']) {
          results.push({
            code: String(item['公司代號']).trim(),
            name: String(item['公司名稱']).trim(),
            shortName: String(item['公司簡稱'] || '').trim(),
            type: '上櫃',
          })
        }
      }
    }
  } catch (e) {
    console.warn('[stock-lookup] TPEx fetch failed:', e)
  }

  if (results.length > 0) {
    cache = results
    cacheTime = now
  }

  return results
}

// 正規化比對用
function normalize(s: string): string {
  return s
    .replace(/股份有限公司|有限公司|公司/g, '')
    .replace(/[\s\-·・]/g, '')
    .trim()
    .toLowerCase()
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim()
  if (q.length < 2) {
    return NextResponse.json([])
  }

  const all = await fetchAll()
  const qNorm = normalize(q)

  // 找匹配：名稱包含、簡稱包含、或代號開頭
  const matches = all
    .filter(c => {
      const nameNorm = normalize(c.name)
      const shortNorm = normalize(c.shortName)
      return nameNorm.includes(qNorm) ||
             shortNorm.includes(qNorm) ||
             qNorm.includes(nameNorm) ||
             qNorm.includes(shortNorm) ||
             c.code.startsWith(q)
    })
    .slice(0, 10)

  return NextResponse.json(matches)
}
