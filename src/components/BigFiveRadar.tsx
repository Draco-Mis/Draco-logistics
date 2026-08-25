'use client'

import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import bigfiveTestJson from '@/data/bigfive-test.json'
import type { BigFiveScores, BigFiveTestJson, BigFiveDimension } from '@/types/bigfive'

const DATA = bigfiveTestJson as unknown as BigFiveTestJson
const DIM_KEYS = Object.keys(DATA.dimensions) as BigFiveDimension[]

// 個人五大維度雷達圖
export function BigFiveRadar({
  scores,
  benchmark,        // 可選：群組平均對照
  height = 260,
}: {
  scores: BigFiveScores
  benchmark?: BigFiveScores['dimensions']
  height?: number
}) {
  const data = DIM_KEYS.map(k => ({
    dim: DATA.dimensions[k].label,
    個人: scores.dimensions[k].pct,
    群組平均: benchmark?.[k]?.pct ?? null,
  }))

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="75%">
          <PolarGrid stroke="#e5e7eb" />
          <PolarAngleAxis dataKey="dim" tick={{ fontSize: 12, fill: '#374151' }} />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
          {benchmark && (
            <Radar name="群組平均" dataKey="群組平均" stroke="#9ca3af" fill="#9ca3af" fillOpacity={0.18} strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false} />
          )}
          <Radar name="個人" dataKey="個人" stroke="#a21caf" fill="#a21caf" fillOpacity={0.45} strokeWidth={2} isAnimationActive={false} />
          {benchmark && <Legend wrapperStyle={{ fontSize: 11 }} />}
          <Tooltip formatter={(v: unknown) => (v == null ? ['—', ''] : [`${v}%`, ''])} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

// 多人雷達圖（疊圖比較）
export function BigFiveRadarMulti({
  people,
  height = 280,
}: {
  people: Array<{ name: string; dimensions: BigFiveScores['dimensions']; color?: string }>
  height?: number
}) {
  const DEFAULT_COLORS = ['#a21caf', '#0891b2', '#ea580c', '#16a34a', '#dc2626']
  const data = DIM_KEYS.map(k => {
    const row: Record<string, string | number> = { dim: DATA.dimensions[k].label }
    for (const p of people) row[p.name] = p.dimensions[k].pct
    return row
  })

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="#e5e7eb" />
          <PolarAngleAxis dataKey="dim" tick={{ fontSize: 12, fill: '#374151' }} />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
          {people.map((p, i) => (
            <Radar
              key={p.name}
              name={p.name}
              dataKey={p.name}
              stroke={p.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              fill={p.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              fillOpacity={0.25}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Tooltip formatter={(v: unknown) => [`${v}%`, '']} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
