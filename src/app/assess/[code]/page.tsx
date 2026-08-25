'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import type { LogicAnswers, LogicBenchmark, LogicScores } from '@/types/logic-test'
import { LogicTestReport } from '@/components/LogicTestReport'
import { cn } from '@/lib/utils'
import { ASSESSMENT_DEPARTMENTS } from '@/lib/departments'

const DEPARTMENTS = ASSESSMENT_DEPARTMENTS

interface EventInfo {
  id: string
  code: string
  name: string
  deadline: string | null
  is_active: boolean
  test_types?: string[]
}

interface ShuffledItem {
  id: string
  category: string
  difficulty: string
  question: string
  options: string[]
}

type Stage = 'loading' | 'ended' | 'register' | 'answering' | 'submitting' | 'done' | 'already_done'

export default function AssessPage() {
  const { code } = useParams()
  const codeStr = String(code || '')
  const storageKey = `assess:${codeStr}:submission_id`

  const [stage, setStage] = useState<Stage>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [event, setEvent] = useState<EventInfo | null>(null)

  // 填表
  const [name, setName] = useState('')
  const [englishName, setEnglishName] = useState<string | null>(null)
  const [nameMatches, setNameMatches] = useState<Array<{ chinese_name: string; english_name: string | null; title: string | null }>>([])
  // 標記使用者已經主動從清單中挑了某位，避免後續輸入被覆蓋
  const [nameLocked, setNameLocked] = useState(false)
  const [dept, setDept] = useState('')
  const [empCode, setEmpCode] = useState('')

  // 姓名 → 員工名冊查詢（中文精確 / 英文不分大小寫；debounce 400ms）
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
        // 若中文輸入精確命中，自動填英文名
        const chineseExact = matches.find(m => m.chinese_name === n)
        if (chineseExact) {
          setEnglishName(chineseExact.english_name || null)
        } else if (matches.length === 1) {
          // 唯一一筆且非中文精確（代表輸的是英文）→ 自動把欄位切成中文姓名
          setEnglishName(matches[0].english_name || null)
        } else {
          setEnglishName(null)
        }
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

  // 作答
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [items, setItems] = useState<ShuffledItem[]>([])
  const [answers, setAnswers] = useState<LogicAnswers>({})
  const [currentIdx, setCurrentIdx] = useState(0)
  const [savingHint, setSavingHint] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 完成後的分數
  const [finalScores, setFinalScores] = useState<LogicScores | null>(null)
  const [benchmark, setBenchmark] = useState<LogicBenchmark | null>(null)
  const [respondentLabel, setRespondentLabel] = useState('')

  // 1. 載入活動資訊 + 恢復進度
  useEffect(() => {
    if (!codeStr) return
    ;(async () => {
      try {
        const localId = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null
        const url = `/api/assess/${codeStr}/info${localId ? `?submission_id=${localId}` : ''}`
        const res = await fetch(url)
        const data = await res.json()
        if (!res.ok) {
          setErrorMsg(data.error || '找不到此測驗連結')
          setStage('ended')
          return
        }
        setEvent(data.event)
        // Big Five 活動 → 導向專屬作答頁
        if (data.event?.test_types?.includes('bigfive')) {
          window.location.replace(`/assess/${codeStr}/bigfive`)
          return
        }
        if (data.ended) {
          setStage('ended')
          return
        }
        const sub = data.submission
        if (sub) {
          if (sub.status === 'completed') {
            setRespondentLabel(`${sub.respondent_name}（${sub.department}）`)
            if (sub.logic_scores) setFinalScores(sub.logic_scores)
            if (data.benchmark) setBenchmark(data.benchmark as LogicBenchmark)
            setStage('done')
            return
          }
          // in_progress：需要重新從 server 取打亂後題目
          // 直接呼叫 start with original name/dept 不行——使用者沒填過了
          // 改成 prompt 提示「請輸入剛剛的姓名+部門以繼續作答」？太麻煩
          // 簡化：清掉 localStorage，回到 register 重新填
          if (typeof window !== 'undefined') localStorage.removeItem(storageKey)
        }
        setStage('register')
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : '連線錯誤')
        setStage('ended')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeStr])

  // 2. 提交基本資料 → 取得 shuffled questions
  async function handleStart(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !dept) return
    setErrorMsg('')
    try {
      const res = await fetch(`/api/assess/${codeStr}/start`, {
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
      if (!res.ok) {
        if (res.status === 409) {
          // 已 completed
          setErrorMsg(data.error)
          setRespondentLabel(`${name.trim()}（${dept}）`)
          setStage('already_done')
        } else {
          setErrorMsg(data.error || '無法開始')
        }
        return
      }
      setSubmissionId(data.submission_id)
      setItems(data.items)
      setAnswers(data.existing_answers || {})
      setCurrentIdx(0)
      setRespondentLabel(`${name.trim()}（${dept}）`)
      if (typeof window !== 'undefined') localStorage.setItem(storageKey, data.submission_id)
      setStage('answering')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '送出失敗')
    }
  }

  // 3. autosave
  const autosave = useCallback((next: LogicAnswers) => {
    if (!submissionId) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSavingHint('saving')
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`/api/assess/${codeStr}/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submission_id: submissionId, answers: next }),
        })
        setSavingHint('saved')
      } catch {
        setSavingHint('idle')
      }
    }, 600)
  }, [submissionId, codeStr])

  function pick(itemId: string, optIdx: number) {
    const next = { ...answers, [itemId]: optIdx }
    setAnswers(next)
    autosave(next)
  }

  const total = items.length
  const done = items.filter(it => answers[it.id] !== undefined).length
  const allDone = total > 0 && done === total

  async function handleSubmit() {
    if (!submissionId || !allDone) return
    setStage('submitting')
    setErrorMsg('')
    try {
      const res = await fetch(`/api/assess/${codeStr}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submission_id: submissionId, answers }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data.error || '送出失敗')
        setStage('answering')
        return
      }
      setFinalScores(data.scores)
      if (data.benchmark) setBenchmark(data.benchmark as LogicBenchmark)
      if (typeof window !== 'undefined') localStorage.removeItem(storageKey)
      setStage('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '送出失敗')
      setStage('answering')
    }
  }

  // === Render ===
  if (stage === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  if (stage === 'ended') {
    return (
      <Container>
        <div className="card text-center py-12">
          <h1 className="text-xl font-bold text-gray-900 mb-2">測驗已結束</h1>
          <p className="text-sm text-gray-500">{errorMsg || '此測驗已停用或截止。如有疑問請聯絡 HR。'}</p>
        </div>
      </Container>
    )
  }

  if (stage === 'already_done') {
    return (
      <Container>
        <div className="card text-center py-12">
          <h1 className="text-xl font-bold text-gray-900 mb-2">您已完成此測驗</h1>
          <p className="text-sm text-gray-500 mb-3">{respondentLabel}</p>
          <p className="text-sm text-gray-500">系統不允許重複作答，如有疑問請聯絡 HR。</p>
        </div>
      </Container>
    )
  }

  if (stage === 'done' && finalScores) {
    return (
      <Container>
        <LogicTestReport
          scores={finalScores}
          benchmark={benchmark}
          headerTitle="您的人才適性評估結果"
          headerSubtitle={respondentLabel}
        />
      </Container>
    )
  }

  if (stage === 'register') {
    return (
      <Container>
        <div className="card">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-1">{event?.name}</h1>
          <p className="text-sm text-gray-500 mb-4">
            登泰人才適性評估 · 共 30 題 · 約 22 分鐘 · 沒有時間限制，過程會自動暫存
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
              {/* 1. 唯一比對成功（中文輸入精確命中，或英文唯一） */}
              {nameMatches.length === 1 && englishName && (
                <p className="text-xs text-emerald-600 mt-1">
                  ✓ 已對應到員工名冊：
                  {nameMatches[0].chinese_name !== name
                    ? <button type="button" onClick={() => chooseEmployee(nameMatches[0])} className="underline font-semibold ml-1">{nameMatches[0].chinese_name}</button>
                    : <span className="font-semibold ml-1">{englishName}</span>}
                </p>
              )}
              {/* 2. 多筆同名（英文同名兩個以上） */}
              {nameMatches.length >= 2 && (
                <div className="mt-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                  <p className="text-xs text-amber-800 font-medium mb-1.5">
                    找到 {nameMatches.length} 位英文名為「{name.trim()}」的員工，請選擇您是哪一位：
                  </p>
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
  const cur = items[currentIdx]
  if (!cur) {
    return (
      <Container>
        <div className="card text-center py-12 text-gray-400">沒有題目</div>
      </Container>
    )
  }
  const chosen = answers[cur.id]

  return (
    <Container>
      {/* 進度 */}
      <div className="card mb-3">
        <div className="flex items-center justify-between mb-2 text-sm">
          <span className="font-medium">第 {currentIdx + 1} / {total} 題</span>
          <span className="text-gray-500 tabular-nums">已答 {done} / {total}</span>
        </div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-primary-500 transition-all" style={{ width: `${(done / total) * 100}%` }} />
        </div>
        <div className="text-xs text-right mt-1 text-gray-400 min-h-[1em]">
          {savingHint === 'saving' && '儲存中…'}
          {savingHint === 'saved' && '✓ 已儲存'}
        </div>
      </div>

      {/* 題目 */}
      <div className="card mb-3">
        <p className="text-xs text-gray-400 mb-1">{cur.category} · {cur.difficulty}</p>
        <p className="font-medium text-gray-900 mb-4 leading-relaxed whitespace-pre-wrap">{cur.question}</p>
        <div className="space-y-2">
          {cur.options.map((opt, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => pick(cur.id, idx)}
              className={cn(
                'w-full text-left p-3 rounded-lg border transition',
                chosen === idx
                  ? 'border-primary-600 bg-primary-50 text-gray-900'
                  : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50 text-gray-700'
              )}
            >
              <span className="font-bold mr-2">{['A', 'B', 'C', 'D'][idx]}.</span>
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* 題目導覽（小方格） */}
      <div className="card mb-3">
        <p className="text-xs text-gray-500 mb-2">點數字跳到該題</p>
        <div className="grid grid-cols-10 gap-1.5">
          {items.map((it, i) => {
            const isCurrent = i === currentIdx
            const isAnswered = answers[it.id] !== undefined
            return (
              <button
                key={it.id}
                onClick={() => setCurrentIdx(i)}
                className={cn(
                  'aspect-square rounded text-xs font-medium border transition',
                  isCurrent ? 'ring-2 ring-primary-500' : '',
                  isAnswered ? 'bg-primary-100 border-primary-300 text-primary-700' : 'bg-white border-gray-300 text-gray-400'
                )}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
      </div>

      {/* 底部按鈕 */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <button
          onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
          disabled={currentIdx === 0}
          className="btn-secondary disabled:opacity-40"
        >← 上一題</button>
        {currentIdx < total - 1 ? (
          <button
            onClick={() => setCurrentIdx(i => Math.min(total - 1, i + 1))}
            className="btn-primary"
          >下一題 →</button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!allDone || stage === 'submitting'}
            className="btn-primary disabled:opacity-40"
          >{stage === 'submitting' ? '送出中…' : '送出評估'}</button>
        )}
      </div>
      {!allDone && currentIdx === total - 1 && (
        <p className="text-xs text-orange-500 text-center">還有 {total - done} 題未答完，請回頭補答</p>
      )}
      {errorMsg && <p className="text-red-500 text-sm text-center">{errorMsg}</p>}
    </Container>
  )
}

function Container({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-2xl mx-auto p-4 md:p-6">
        {children}
      </div>
    </div>
  )
}
