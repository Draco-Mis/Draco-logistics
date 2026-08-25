'use client'

import {
  deriveArchetype, deriveStressResponse, deriveDecisionStyle,
  deriveRiskProfile, deriveLearningStyle,
} from '@/lib/bigfive-derived'
import type { BigFiveScores } from '@/types/bigfive'
import { cn } from '@/lib/utils'

export function BigFiveDerivedPanel({ scores }: { scores: BigFiveScores }) {
  const d = scores.dimensions
  const archetype = deriveArchetype(d)
  const stress = deriveStressResponse(d)
  const decision = deriveDecisionStyle(d)
  const risk = deriveRiskProfile(d)
  const learning = deriveLearningStyle(d)

  function scoreColor(s: number) {
    if (s >= 75) return 'bg-emerald-500'
    if (s >= 55) return 'bg-lime-500'
    if (s >= 35) return 'bg-amber-500'
    return 'bg-orange-500'
  }

  return (
    <div className="space-y-3">
      {/* 1. 人格類型（粗分類）— 個人化原型由 AI 報告開頭呈現，這裡是 12 類粗分類用於統計/篩選 */}
      <div className="rounded-2xl bg-gray-50 px-4 py-3 flex items-center gap-3">
        <div className="text-3xl">{archetype.emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-gray-500 mb-0.5">📊 同類型族群（12 類粗分類）</div>
          <div className="text-sm font-bold text-gray-900 mb-1">{archetype.name}</div>
          <p className="text-xs text-gray-600 leading-relaxed">{archetype.short}</p>
        </div>
      </div>

      {/* 2. 壓力反應預測 */}
      <div className="rounded-2xl bg-gray-50 px-4 py-3">
        <h4 className="font-bold text-sm text-gray-900 mb-2">⚡ 壓力反應預測</h4>
        <p className="text-[11px] text-gray-500 mb-2">★ = 你在四項壓力中最強的一項；⚠ = 相對最需留意的一項</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {stress.map(s => (
            <div
              key={s.type}
              className={cn(
                'rounded-xl p-2.5 border',
                s.rank === 'best'
                  ? 'bg-emerald-50 border-emerald-200 ring-1 ring-emerald-100'
                  : s.rank === 'worst'
                    ? 'bg-orange-50 border-orange-200 ring-1 ring-orange-100'
                    : 'bg-white border-gray-100',
              )}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold text-gray-800">
                  {s.rank === 'best' && '★ '}
                  {s.rank === 'worst' && '⚠ '}
                  {s.emoji} {s.type}
                </span>
                <span className={cn(
                  'text-xs font-semibold tabular-nums',
                  s.score >= 60 ? 'text-emerald-700'
                    : s.score >= 45 ? 'text-amber-700'
                      : 'text-orange-700',
                )}>{s.score} · {s.label}</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1">
                <div className={cn('h-full', scoreColor(s.score))} style={{ width: `${s.score}%` }} />
              </div>
              <p className="text-[11px] text-gray-600 leading-relaxed">{s.note}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 3. 決策風格雷達 */}
      <div className="rounded-2xl bg-gray-50 px-4 py-3">
        <h4 className="font-bold text-sm text-gray-900 mb-2">🎯 決策風格</h4>
        <div className="space-y-2">
          {decision.axes.map(a => (
            <div key={a.name}>
              <div className="flex justify-between text-[11px] text-gray-500 mb-0.5">
                <span>{a.left}</span>
                <span className="text-gray-700 font-medium">{a.name}</span>
                <span>{a.right}</span>
              </div>
              <div className="relative h-2 bg-gray-200 rounded-full">
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-fuchsia-600 border-2 border-white shadow"
                  style={{ left: `calc(${a.position}% - 7px)` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4 + 5. 風險偏好 + 學習偏好 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-2xl bg-gray-50 px-4 py-3">
          <h4 className="font-bold text-sm text-gray-900 mb-2">🎲 風險偏好</h4>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold tabular-nums text-fuchsia-700">{risk.score}</span>
            <span className="text-xs text-gray-500">/ 100</span>
            <span className="ml-auto text-xs font-semibold text-gray-700">{risk.label}</span>
          </div>
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-1">
            <div className="h-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500" style={{ width: `${risk.score}%` }} />
          </div>
          <p className="text-[11px] text-gray-600 leading-relaxed mt-1">{risk.note}</p>
        </div>

        <div className="rounded-2xl bg-gray-50 px-4 py-3">
          <h4 className="font-bold text-sm text-gray-900 mb-2">📚 學習偏好</h4>
          <div className="space-y-2">
            {([
              ['結構', learning.structure],
              ['社交', learning.social],
              ['模式', learning.modality],
            ] as const).map(([label, axis]) => (
              <div key={label}>
                <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                  <span>{axis.left}</span>
                  <span>{axis.right}</span>
                </div>
                <div className="relative h-1.5 bg-gray-200 rounded-full">
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-fuchsia-600 border-2 border-white shadow"
                    style={{ left: `calc(${axis.position}% - 6px)` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
