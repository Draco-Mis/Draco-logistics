'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ASSESSMENT_DEPARTMENTS } from '@/lib/departments'
import bigfiveTestJson from '@/data/bigfive-test.json'
import type { BigFiveAnswers, BigFiveScores, BigFiveTestJson } from '@/types/bigfive'
import { BigFiveRadar } from '@/components/BigFiveRadar'
import { BigFiveDerivedPanel } from '@/components/BigFiveDerivedPanel'

const JSON_DATA = bigfiveTestJson as unknown as BigFiveTestJson
const DEPARTMENTS = ASSESSMENT_DEPARTMENTS

type Stage = 'loading' | 'intro' | 'answering' | 'submitting' | 'done' | 'ended'

interface EventInfo {
  id: string
  code: string
  name: string
  deadline: string | null
  is_active: boolean
  test_types?: string[]
}

const STORAGE_PREFIX = 'bigfive-sub:'

export default function BigFiveAssessPage() {
  const params = useParams()
  const codeStr = (params?.code as string) || ''
  const storageKey = STORAGE_PREFIX + codeStr

  const [stage, setStage] = useState<Stage>('loading')
  const [event, setEvent] = useState<EventInfo | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  // 表單欄位
  const [name, setName] = useState('')
  const [englishName, setEnglishName] = useState<string | null>(null)
  const [nameMatches, setNameMatches] = useState<Array<{ chinese_name: string; english_name: string | null; title: string | null }>>([])
  const [nameLocked, setNameLocked] = useState(false)
  const [dept, setDept] = useState('')
  const [empCode, setEmpCode] = useState('')

  // 作答
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<BigFiveAnswers>({})
  const [savingHint, setSavingHint] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [scores, setScores] = useState<BigFiveScores | null>(null)
  const [respondentLabel, setRespondentLabel] = useState('')

  // 載入活動 / 沿用既有 submission
  useEffect(() => {
    if (!codeStr) return
    ;(async () => {
      try {
        const localId = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null
        const res = await fetch(`/api/assess/${codeStr}/info${localId ? `?submission_id=${localId}` : ''}`)
        const data = await res.json()
        if (!res.ok) { setErrorMsg(data.error || '找不到此測驗連結'); setStage('ended'); return }
        if (!data.event?.test_types?.includes('bigfive')) {
          // 不是 bigfive，導回主頁
          window.location.replace(`/assess/${codeStr}`)
          return
        }
        setEvent(data.event)
        if (data.ended) { setStage('ended'); return }
        const sub = data.submission
        if (sub) {
          if (sub.status === 'completed') {
            setRespondentLabel(`${sub.respondent_name}（${sub.department}）`)
            if (sub.bigfive_scores) setScores(sub.bigfive_scores as BigFiveScores)
            setStage('done')
            return
          }
          if (sub.status === 'in_progress') {
            setSubmissionId(sub.id)
            setAnswers((sub.bigfive_answers || {}) as BigFiveAnswers)
            setName(sub.respondent_name || '')
            setEnglishName(sub.english_name || null)
            setDept(sub.department || '')
            setEmpCode(sub.employee_code || '')
            setStage('answering')
            return
          }
        }
        setStage('intro')
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : '載入失敗')
        setStage('ended')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeStr])

  // 姓名 lookup（debounce 400ms，沿用 logic 測驗的邏輯）
  useEffect(() => {
    if (nameLocked) return
    const n = name.trim()
    if (n.length < 2) { setEnglishName(null); setNameMatches([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/assess/lookup?name=${encodeURIComponent(n)}`)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const matches = (data?.matches || []) as typeof nameMatches
        setNameMatches(matches)
        const exact = matches.find(m => m.chinese_name === n)
        if (exact) setEnglishName(exact.english_name || null)
        else if (matches.length === 1) setEnglishName(matches[0].english_name || null)
        else setEnglishName(null)
      } catch {/* ignore */}
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [name, nameLocked])

  function chooseEmployee(m: { chinese_name: string; english_name: string | null }) {
    setName(m.chinese_name)
    setEnglishName(m.english_name || null)
    setNameMatches([])
    setNameLocked(true)
  }

  // 自動暫存
  useEffect(() => {
    if (!submissionId || stage !== 'answering') return
    const t = setTimeout(async () => {
      setSavingHint('saving')
      try {
        await fetch(`/api/assess/${codeStr}/bigfive/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submission_id: submissionId, answers }),
        })
        setSavingHint('saved')
        setTimeout(() => setSavingHint('idle'), 1500)
      } catch {
        setSavingHint('idle')
      }
    }, 1000)
    return () => clearTimeout(t)
  }, [answers, submissionId, codeStr, stage])

  async function handleStart(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg('')
    try {
      const res = await fetch(`/api/assess/${codeStr}/bigfive/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          respondent_name: name.trim(),
          english_name: englishName || undefined,
          department: dept,
          employee_code: empCode.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setErrorMsg(data.error || '無法開始作答'); return }
      setSubmissionId(data.submission_id)
      setAnswers(data.existing_answers || {})
      if (typeof window !== 'undefined') localStorage.setItem(storageKey, data.submission_id)
      setStage('answering')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '無法開始作答')
    }
  }

  async function handleSubmit() {
    if (!submissionId) return
    const unanswered = JSON_DATA.items.filter(it => answers[it.id] == null)
    if (unanswered.length > 0) {
      alert(`還有 ${unanswered.length} 題沒作答，請完成後再交卷`)
      // 滾到第一題未答的位置
      const el = document.getElementById('q-' + unanswered[0].id)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setStage('submitting')
    try {
      const res = await fetch(`/api/assess/${codeStr}/bigfive/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submission_id: submissionId, answers }),
      })
      const data = await res.json()
      if (!res.ok) { setErrorMsg(data.error || '交卷失敗'); setStage('answering'); return }
      setScores(data.scores as BigFiveScores)
      setRespondentLabel(`${name.trim()}（${dept}）`)
      setStage('done')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '交卷失敗')
      setStage('answering')
    }
  }

  const answeredCount = useMemo(() => Object.keys(answers).length, [answers])
  const progressPct = Math.round((answeredCount / JSON_DATA.items.length) * 100)

  // ====== Render ======
  if (stage === 'loading') return <Container><div className="card text-center py-16 text-gray-400">載入中…</div></Container>

  if (stage === 'ended') {
    return (
      <Container>
        <div className="card text-center py-12">
          <p className="text-lg text-gray-700 mb-2">無法開始作答</p>
          <p className="text-sm text-gray-500">{errorMsg || '此測驗已結束或不存在'}</p>
        </div>
      </Container>
    )
  }

  if (stage === 'done' && scores) {
    return (
      <Container>
        <div className="card text-center mb-4">
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">✓ 測驗已完成</h2>
          <p className="text-sm text-gray-500 mt-1">{respondentLabel}</p>
        </div>
        <BigFiveResult scores={scores} />
      </Container>
    )
  }

  if (stage === 'intro') {
    return (
      <Container>
        <div className="card">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{event?.name}</h1>
          <p className="text-sm text-gray-500 mb-1 mt-1">
            🌈 Big Five 人格特質評估 · 共 {JSON_DATA.items.length} 題 · 約 {JSON_DATA.meta.estimated_minutes} 分鐘
          </p>
          <p className="text-xs text-gray-400 mb-4">
            這份問卷沒有對錯之分，請依您「平時最直覺的反應」誠實作答。系統會自動暫存。
          </p>
          <form onSubmit={handleStart} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">姓名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setNameLocked(false) }}
                className="input-field"
                placeholder="中文姓名或英文名都可"
                required
              />
              {nameMatches.length === 1 && englishName && (
                <p className="text-xs text-emerald-600 mt-1">
                  ✓ 已對應到員工名冊：
                  {nameMatches[0].chinese_name !== name
                    ? <button type="button" onClick={() => chooseEmployee(nameMatches[0])} className="underline font-semibold ml-1">{nameMatches[0].chinese_name}</button>
                    : <span className="font-semibold ml-1">{englishName}</span>}
                </p>
              )}
              {nameMatches.length >= 2 && (
                <div className="mt-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                  <p className="text-xs text-amber-800 font-medium mb-1.5">找到 {nameMatches.length} 位英文名為「{name.trim()}」的員工，請選擇您是哪一位：</p>
                  <div className="flex flex-wrap gap-1.5">
                    {nameMatches.map(m => (
                      <button
                        key={m.chinese_name}
                        type="button"
                        onClick={() => chooseEmployee(m)}
                        className="px-2.5 py-1 bg-white rounded-lg ring-1 ring-amber-300 text-xs hover:bg-amber-100 hover:ring-amber-400 transition"
                      >
                        <span className="font-semibold text-gray-900">{m.chinese_name}</span>
                        {m.title && <span className="text-gray-500 ml-1">· {m.title}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">部門 <span className="text-red-500">*</span></label>
              <select value={dept} onChange={(e) => setDept(e.target.value)} className="input-field" required>
                <option value="">請選擇</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">員工編號（選填）</label>
              <input
                type="text"
                value={empCode}
                onChange={(e) => setEmpCode(e.target.value)}
                className="input-field"
                placeholder="例如 EMP-001"
              />
            </div>
            {errorMsg && <p className="text-red-500 text-sm">{errorMsg}</p>}
            <button type="submit" className="btn-primary w-full py-3">開始作答</button>
          </form>
        </div>
      </Container>
    )
  }

  // === stage === 'answering' or 'submitting'
  const submitting = stage === 'submitting'
  return (
    <Container>
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2.5 bg-white/85 backdrop-blur-md border-b border-gray-100">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <div className="text-xs text-gray-500 mb-1">
              已作答 <span className="font-bold tabular-nums text-gray-900">{answeredCount}</span> / {JSON_DATA.items.length}
              {savingHint === 'saving' && <span className="ml-2 text-amber-600">儲存中…</span>}
              {savingHint === 'saved' && <span className="ml-2 text-emerald-600">已儲存</span>}
            </div>
            <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-fuchsia-500 transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {JSON_DATA.items.map((item, idx) => (
          <div key={item.id} id={'q-' + item.id} className="card">
            <p className="text-xs text-gray-400 mb-1">{idx + 1} / {JSON_DATA.items.length}</p>
            <p className="text-sm md:text-base text-gray-900 mb-3">{item.statement}</p>
            <div className="grid grid-cols-5 gap-1.5">
              {JSON_DATA.meta.likert_labels.map((label, i) => {
                const value = i + 1
                const selected = answers[item.id] === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAnswers(a => ({ ...a, [item.id]: value }))}
                    className={cn(
                      'px-2 py-2.5 rounded-xl text-xs md:text-sm border transition-all',
                      selected
                        ? 'bg-fuchsia-600 text-white border-fuchsia-600 shadow-sm'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-fuchsia-300 hover:bg-fuchsia-50/30',
                    )}
                  >
                    <div className="text-base font-bold tabular-nums">{value}</div>
                    <div className="text-[10px] mt-0.5 opacity-90 leading-tight">{label}</div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-white/85 backdrop-blur-md border-t border-gray-100 mt-4">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="btn-primary w-full py-3 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-50"
        >
          {submitting ? '送出中…' : `送出問卷（${answeredCount}/${JSON_DATA.items.length}）`}
        </button>
      </div>
    </Container>
  )
}

function Container({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto p-4">{children}</div>
    </div>
  )
}

function BigFiveResult({ scores }: { scores: BigFiveScores }) {
  const dimKeys = Object.keys(scores.dimensions) as Array<keyof typeof scores.dimensions>
  return (
    <div className="space-y-3">
      {/* 1. 五大人格分數（雷達 + 條形） */}
      <div className="card">
        <h3 className="text-lg font-bold text-gray-900 tracking-tight mb-1">您的五大人格特質</h3>
        <p className="text-xs text-gray-500 mb-3">Big Five 是心理學界廣泛採用的人格量表，沒有好壞之分</p>
        <BigFiveRadar scores={scores} />
        <div className="space-y-3 mt-4">
          {dimKeys.map(k => {
            const d = scores.dimensions[k]
            const meta = JSON_DATA.dimensions[k]
            return (
              <div key={k} className="rounded-xl p-3 bg-gray-50">
                <div className="flex items-baseline justify-between mb-1">
                  <div className="font-semibold text-gray-900">{meta.label} <span className="text-xs text-gray-400 font-normal">{meta.short_desc}</span></div>
                  <div className="text-sm font-bold text-fuchsia-700 tabular-nums">{d.pct}% <span className="text-xs text-gray-500 ml-1">（{d.level}）</span></div>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-fuchsia-500" style={{ width: `${d.pct}%` }} />
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">
                  {d.pct >= 50 ? meta.high_desc : meta.low_desc}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* 2. 衍生分析（人格原型 + 壓力反應 + 決策風格 + 風險 + 學習偏好） */}
      <div className="card">
        <h3 className="text-lg font-bold text-gray-900 tracking-tight mb-1">深度洞察</h3>
        <p className="text-xs text-gray-500 mb-3">以下分析由系統依您的五大維度推算，讓您更認識自己</p>
        <BigFiveDerivedPanel scores={scores} />
      </div>

      {/* 3. 使用建議 */}
      <div className="card bg-blue-50/50 border border-blue-200/60">
        <h3 className="text-sm font-bold text-blue-900 mb-2">💡 如何運用這份報告</h3>
        <ul className="text-xs text-gray-700 space-y-1.5 leading-relaxed list-disc list-inside">
          <li><strong>找出工作上的天然優勢</strong>：你的「強項」可以怎麼在每天的工作中發揮？</li>
          <li><strong>留意可能的盲點</strong>：「弱項」並非缺陷，而是你需要刻意提醒自己的部分</li>
          <li><strong>了解自己怎麼接收回饋</strong>：知道自己適合哪種回饋方式，可以主動跟主管溝通</li>
          <li><strong>找適合的合作對象</strong>：人格互補的同事能讓你工作更順暢</li>
          <li><strong>規劃職涯</strong>：依你的「決策風格」與「風險偏好」，思考下一步發展</li>
        </ul>
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed px-2">
        ℹ️ Big Five 量表為人格特質的描述，並非能力評估或職位適配判定。每種人格組合都有
        其優勢與適合的工作型態，不存在「正確」答案。
      </p>
    </div>
  )
}
