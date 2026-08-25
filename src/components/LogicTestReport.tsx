'use client'

import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, LabelList, Legend, Tooltip,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts'
import logicTestJson from '@/data/logic-test.json'
import type { LogicBenchmark, LogicScores, LogicTestJson, LogicTestLevel } from '@/types/logic-test'
import { cn } from '@/lib/utils'

const JSON_DATA = logicTestJson as unknown as LogicTestJson

const SELF_COLOR = '#1e87f5'      // accent-600
const DEPT_COLOR = '#64748b'      // slate-500
const OVERALL_COLOR = '#cbd5e1'   // slate-300

function levelBadge(level: LogicTestLevel): string {
  return level === '優秀' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60'
    : level === '良好' ? 'bg-accent-50 text-accent-700 ring-1 ring-accent-200/60'
    : level === '中等' ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60'
    : 'bg-orange-50 text-orange-700 ring-1 ring-orange-200/60'
}

function levelBarColor(level: LogicTestLevel): string {
  return level === '優秀' ? '#10b981'  // emerald-500
    : level === '良好' ? '#1e87f5'      // accent-600
    : level === '中等' ? '#f59e0b'      // amber-500
    : '#f97316'                          // orange-500
}

function diffLabel(diff: number): { text: string; cls: string } {
  if (diff > 0) return { text: `高出 ${diff}%`, cls: 'text-emerald-600' }
  if (diff < 0) return { text: `低於 ${Math.abs(diff)}%`, cls: 'text-orange-600' }
  return { text: '與平均相同', cls: 'text-gray-500' }
}

export function LogicTestReport({ scores, benchmark, headerTitle, headerSubtitle }: {
  scores: LogicScores
  benchmark?: LogicBenchmark | null
  headerTitle?: string
  headerSubtitle?: string
}) {
  const total = scores.total
  const chartData = Object.entries(scores.categories).map(([key, c]) => {
    const pct = Math.round((c.score / c.max) * 100)
    const deptPct = benchmark?.dept?.avgPctByCategory[key]
    const overallPct = benchmark?.overall?.avgPctByCategory[key]
    return {
      key,
      label: JSON_DATA.categories[key]?.label || key,
      pct,
      level: c.level,
      score: c.score,
      max: c.max,
      deptPct: deptPct != null ? Math.round(deptPct) : null,
      overallPct: overallPct != null ? Math.round(overallPct) : null,
    }
  })

  const showBenchmark = !!benchmark
  const showDept = !!benchmark?.dept
  const showOverall = !!benchmark?.overall

  const chartHeight = showBenchmark ? 'h-80' : 'h-64'

  return (
    <div className="space-y-5">
      {/* 標題 + 總分卡 */}
      <div className="card">
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-1 tracking-tight">
          {headerTitle ?? '人才適性評估結果'}
        </h2>
        {headerSubtitle && (
          <p className="text-sm text-gray-500 mb-5">{headerSubtitle}</p>
        )}

        <div className="flex items-end justify-between gap-4 flex-wrap mt-3">
          <div>
            <div className="text-xs text-gray-500 mb-1 tracking-tight uppercase font-medium">總分</div>
            <div className="flex items-baseline gap-2">
              <span className="text-6xl font-bold tabular-nums bg-gradient-to-br from-gray-900 to-gray-600 bg-clip-text text-transparent tracking-tight">
                {total.score}
              </span>
              <span className="text-gray-400 text-xl tabular-nums">/ {total.max}</span>
              <span className="text-2xl text-accent-600 ml-2 font-semibold tabular-nums">{total.pct}%</span>
            </div>
          </div>
          <span className={cn('px-3.5 py-1.5 rounded-full text-sm font-bold', levelBadge(total.level))}>
            {total.level}
          </span>
        </div>
      </div>

      {/* 雷達圖：能力輪廓 */}
      <div className="card">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-bold text-gray-900 text-base tracking-tight">
            能力輪廓
            {showBenchmark && <span className="text-xs text-gray-400 font-normal ml-2">與平均對照</span>}
          </h3>
        </div>
        <div className="w-full h-72">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={chartData} outerRadius="75%">
              <PolarGrid stroke="#e5e7eb" />
              <PolarAngleAxis dataKey="label" tick={{ fontSize: 12, fill: '#374151' }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} tickCount={6} />
              {showOverall && (
                <Radar
                  name="整體平均"
                  dataKey="overallPct"
                  stroke={OVERALL_COLOR}
                  fill={OVERALL_COLOR}
                  fillOpacity={0.2}
                />
              )}
              {showDept && (
                <Radar
                  name={`${benchmark!.dept!.name}平均`}
                  dataKey="deptPct"
                  stroke={DEPT_COLOR}
                  fill={DEPT_COLOR}
                  fillOpacity={0.2}
                />
              )}
              <Radar
                name="您"
                dataKey="pct"
                stroke={SELF_COLOR}
                fill={SELF_COLOR}
                fillOpacity={0.4}
              />
              <Tooltip formatter={(v, name) => v == null ? ['—', name ?? ''] : [`${v}%`, name ?? '']} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 長條圖：各類別得分 */}
      <div className="card">
        <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
          <h3 className="font-bold text-gray-900 text-base tracking-tight">
            各類別得分
            {showBenchmark && <span className="text-xs text-gray-400 font-normal ml-2">與平均對照</span>}
          </h3>
          {showBenchmark && (
            <div className="text-xs text-gray-500 tabular-nums">
              {showDept && <span>{benchmark!.dept!.name} {benchmark!.dept!.n} 人</span>}
              {showDept && showOverall && <span className="mx-1.5 text-gray-300">·</span>}
              {showOverall && <span>整體 {benchmark!.overall.n} 人</span>}
            </div>
          )}
        </div>
        <div className={cn('w-full', chartHeight)}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ left: 0, right: 30, top: 8, bottom: 8 }}
              barCategoryGap={showBenchmark ? 12 : 4}
            >
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 12 }} />
              {showBenchmark && (
                <>
                  <Tooltip
                    formatter={(v, name) => {
                      if (v == null) return ['—', name ?? '']
                      return [`${v}%`, name ?? '']
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" />
                </>
              )}
              <Bar dataKey="pct" name="您" radius={[0, 6, 6, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={levelBarColor(d.level)} />
                ))}
                {!showBenchmark && (
                  <LabelList dataKey="pct" position="right" formatter={(v: unknown) => `${v}%`} fontSize={11} />
                )}
              </Bar>
              {showDept && (
                <Bar
                  dataKey="deptPct"
                  name={`${benchmark!.dept!.name}平均`}
                  fill={DEPT_COLOR}
                  radius={[0, 6, 6, 0]}
                />
              )}
              {showOverall && (
                <Bar
                  dataKey="overallPct"
                  name="整體平均"
                  fill={OVERALL_COLOR}
                  radius={[0, 6, 6, 0]}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 各類別解讀 */}
      <div className="space-y-3">
        {chartData.map(d => {
          const interp = JSON_DATA.scoring.category_interpretations[d.key]?.[d.level]
          const deptDiff = d.deptPct != null ? d.pct - d.deptPct : null
          const overallDiff = d.overallPct != null ? d.pct - d.overallPct : null
          return (
            <div key={d.key} className="card">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <h3 className="font-bold text-gray-900 tracking-tight">
                  {d.label}
                  <span className="text-xs text-gray-400 font-normal ml-2 tracking-normal">{d.key}</span>
                </h3>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums font-bold text-gray-700">{d.score} / {d.max}</span>
                  <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-semibold', levelBadge(d.level))}>
                    {d.level}
                  </span>
                </div>
              </div>
              {(deptDiff != null || overallDiff != null) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-1.5">
                  {deptDiff != null && benchmark?.dept && (
                    <span className="text-gray-500">
                      vs {benchmark.dept.name}平均 {d.deptPct}%：
                      <span className={cn('ml-1 font-semibold tabular-nums', diffLabel(deptDiff).cls)}>
                        {diffLabel(deptDiff).text}
                      </span>
                    </span>
                  )}
                  {overallDiff != null && (
                    <span className="text-gray-500">
                      vs 整體平均 {d.overallPct}%：
                      <span className={cn('ml-1 font-semibold tabular-nums', diffLabel(overallDiff).cls)}>
                        {diffLabel(overallDiff).text}
                      </span>
                    </span>
                  )}
                </div>
              )}
              {interp && (
                <p className="text-sm text-gray-700 leading-relaxed mt-3">{interp}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* 免責聲明 */}
      <div className="rounded-2xl bg-gray-50/70 px-5 py-4">
        <p className="text-xs text-gray-500 text-center leading-relaxed">
          本評估結果僅供員工自我了解與內部溝通參考，題庫為登泰內部原創，非標準化認知測驗。
        </p>
      </div>
    </div>
  )
}
