'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Copy, Check, Trash2, Power, Eye, Users, Pencil } from 'lucide-react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import type { AssessmentEvent } from '@/types/logic-test'
import type { EmployeeCategory } from '@/types/employee'
import { useEmployees, computeCategoryCounts, getAllCategoryKeys, getAllCategoriesMeta } from '@/lib/employees'
import { formatDateTime, cn } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'

interface EventRow extends AssessmentEvent {
  completed_count?: number
  in_progress_count?: number
}

export default function AdminAssessmentsPage() {
  const { user } = useAuth()
  const supabase = createClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDeadline, setCreateDeadline] = useState('')
  const [createCategories, setCreateCategories] = useState<EmployeeCategory[]>([])
  const [createKind, setCreateKind] = useState<'employee' | 'interview'>('employee')
  const [createTestType, setCreateTestType] = useState<'logic' | 'bigfive'>('logic')
  const [createCategoriesOpen, setCreateCategoriesOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createdLink, setCreatedLink] = useState<{ name: string; url: string } | null>(null)
  const [copyHint, setCopyHint] = useState(false)

  const { employees: roster } = useEmployees()
  const categoriesMeta = getAllCategoriesMeta()
  const allCategoryKeys = getAllCategoryKeys()
  const categoryCounts = computeCategoryCounts(roster.filter(e => !e.resigned_at))

  const canView = !!user && (user.role === 'admin' || user.role === 'director' || user.role === 'hr' || user.team === '財管部')

  async function loadAll() {
    setLoading(true)
    const { data: ev } = await supabase
      .from('assessment_events')
      .select('*')
      .order('created_at', { ascending: false })

    if (!ev) { setEvents([]); setLoading(false); return }

    // 統計每個活動的完成 / 進行中筆數
    const ids = ev.map(e => e.id)
    const counts: Record<string, { completed: number; in_progress: number }> = {}
    for (const id of ids) counts[id] = { completed: 0, in_progress: 0 }

    if (ids.length > 0) {
      const { data: subs } = await supabase
        .from('assessment_submissions')
        .select('event_id, status')
        .in('event_id', ids)
      for (const s of (subs || []) as { event_id: string; status: string }[]) {
        if (s.status === 'completed') counts[s.event_id].completed++
        else if (s.status === 'in_progress') counts[s.event_id].in_progress++
      }
    }

    setEvents(ev.map(e => ({
      ...e,
      completed_count: counts[e.id]?.completed ?? 0,
      in_progress_count: counts[e.id]?.in_progress ?? 0,
    })))
    setLoading(false)
  }

  useEffect(() => {
    if (canView) loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!createName.trim()) return
    setCreating(true)
    setCreateError('')
    try {
      const res = await fetch('/api/admin/assessments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          deadline: createDeadline ? new Date(createDeadline).toISOString() : null,
          target_categories: createCategories.length > 0 ? createCategories : null,
          kind: createKind,
          test_type: createTestType,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateError(data.error || `建立失敗 (${res.status})`)
        setCreating(false)
        return
      }
      const url = `${window.location.origin}/assess/${data.event.code}`
      setCreatedLink({ name: data.event.name, url })
      setCreateName('')
      setCreateDeadline('')
      setCreateCategories([])
      setCreateKind('employee')
      setCreateTestType('logic')
      setCreateCategoriesOpen(false)
      setShowCreate(false)
      loadAll()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '建立失敗')
    } finally {
      setCreating(false)
    }
  }

  async function handleRename(ev: EventRow) {
    const next = prompt(`重新命名活動：\n（目前：${ev.name}）`, ev.name)
    if (next === null) return
    const name = next.trim()
    if (!name) { toast.error('活動名稱不可空白'); return }
    if (name === ev.name) return
    try {
      const res = await fetch('/api/admin/assessments/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ev.id, name }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error('更新失敗：' + (data.error || res.status)); return }
      loadAll()
    } catch (e) {
      toast.error('更新失敗：' + (e instanceof Error ? e.message : '未知錯誤'))
    }
  }

  async function toggleActive(ev: EventRow) {
    const next = !ev.is_active
    const ok = await confirm({
      title: next ? '重新啟用活動' : '停用活動',
      message: next ? `重新啟用「${ev.name}」？` : `確定停用「${ev.name}」？停用後員工無法再進入連結。`,
      danger: !next,
      confirmLabel: next ? '啟用' : '停用',
    })
    if (!ok) return
    const { error } = await supabase.from('assessment_events').update({ is_active: next }).eq('id', ev.id)
    if (error) { toast.error('操作失敗：' + error.message); return }
    loadAll()
  }

  async function handleDelete(ev: EventRow) {
    const completed = ev.completed_count ?? 0
    const inProgress = ev.in_progress_count ?? 0
    const detail = (completed > 0 || inProgress > 0)
      ? `\n\n⚠️ 此活動已有 ${completed} 筆完成紀錄${inProgress > 0 ? ` + ${inProgress} 筆作答中` : ''}，刪除後一併移除，無法復原。`
      : ''
    const ok = await confirm({ title: `刪除活動「${ev.name}」`, message: detail.trim() || '刪除後將無法復原。', danger: true, confirmLabel: '刪除' })
    if (!ok) return
    // 二次確認：有資料時要再 prompt 一次輸入名稱
    if (completed > 0 || inProgress > 0) {
      const typed = prompt(`為避免誤刪，請輸入活動名稱以確認：\n${ev.name}`)
      if (typed !== ev.name) {
        if (typed !== null) toast.error('名稱不符，已取消刪除')
        return
      }
    }
    try {
      const res = await fetch('/api/admin/assessments/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ev.id }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error('刪除失敗：' + (data.error || res.status)); return }
      loadAll()
    } catch (e) {
      toast.error('刪除失敗：' + (e instanceof Error ? e.message : '未知錯誤'))
    }
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopyHint(true)
      setTimeout(() => setCopyHint(false), 1500)
    })
  }

  if (!canView) {
    return <div className="p-4 text-center py-12 text-gray-400">您沒有權限查看此頁面（限 admin / director / hr / 財管部同仁）</div>
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">人才適性評估</h1>
          <p className="text-sm text-gray-500 mt-1">公開連結作答 · HR 查看結果與 AI 性向分析</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm flex items-center gap-1.5">
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          建立新活動
        </button>
      </div>

      {/* 剛建立的連結展示 */}
      {createdLink && (
        <div className="card mb-5 ring-2 ring-emerald-200 bg-emerald-50/60 animate-scale-in">
          <h3 className="font-bold text-emerald-800 mb-2 flex items-center gap-1.5 tracking-tight">
            <Check className="w-4 h-4" strokeWidth={2.5} />
            活動建立成功：{createdLink.name}
          </h3>
          <p className="text-sm text-emerald-700 mb-3">把下方連結傳給要作答的員工：</p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="flex-1 min-w-0 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm break-all font-mono">{createdLink.url}</code>
            <button onClick={() => copyLink(createdLink.url)} className="btn-secondary text-sm shrink-0 flex items-center gap-1.5">
              {copyHint ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copyHint ? '已複製' : '複製'}
            </button>
          </div>
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="card text-center py-16"><div className="w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full animate-spin inline-block" /></div>
      ) : events.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">尚未建立任何活動</div>
      ) : (
        <div className="space-y-3">
          {events.map(ev => {
            const expired = ev.deadline && new Date(ev.deadline) < new Date()
            const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/assess/${ev.code}`
            return (
              <div key={ev.id} className={cn('card card-hover', !ev.is_active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-gray-900 tracking-tight">{ev.name}</h3>
                      {ev.test_types?.includes('bigfive') ? (
                        <span className="badge bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200">🌈 Big Five</span>
                      ) : (
                        <span className="badge bg-accent-50 text-accent-700 ring-1 ring-accent-200">🧠 邏輯</span>
                      )}
                      {ev.kind === 'interview' && (
                        <span className="badge bg-purple-50 text-purple-700 ring-1 ring-purple-200">🎯 面試</span>
                      )}
                      <button
                        onClick={() => handleRename(ev)}
                        className="p-1 rounded-lg text-gray-400 hover:text-accent-600 hover:bg-accent-50 transition"
                        title="修改活動名稱"
                        aria-label="修改活動名稱"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {!ev.is_active && <span className="badge bg-gray-100 text-gray-600 ring-1 ring-gray-200">已停用</span>}
                      {ev.is_active && expired && <span className="badge bg-orange-50 text-orange-700 ring-1 ring-orange-200">已截止</span>}
                      {ev.is_active && !expired && <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">進行中</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-2 flex flex-wrap gap-x-3">
                      <span>建立：{formatDateTime(ev.created_at)}</span>
                      {ev.deadline && <span>截止：{formatDateTime(ev.deadline)}</span>}
                      <span>code：<code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[11px]">{ev.code}</code></span>
                    </div>
                    <div className="text-sm text-gray-700 mt-2.5">
                      已完成 <span className="font-bold text-accent-700 tabular-nums">{ev.completed_count ?? 0}</span> 人
                      {(ev.in_progress_count ?? 0) > 0 && <span className="text-gray-500 ml-3 tabular-nums">作答中 {ev.in_progress_count}</span>}
                    </div>
                    <div className="text-xs text-gray-400 mt-1.5 break-all font-mono">{url}</div>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <button onClick={() => copyLink(url)} className="btn-secondary text-xs flex items-center justify-center gap-1.5">
                      <Copy className="w-3.5 h-3.5" />
                      複製連結
                    </button>
                    <Link href={`/admin/assessments/${ev.id}`} className="btn-primary text-xs text-center flex items-center justify-center gap-1.5">
                      <Eye className="w-3.5 h-3.5" />
                      查看結果
                    </Link>
                    <button onClick={() => toggleActive(ev)} className="btn-secondary text-xs flex items-center justify-center gap-1.5">
                      <Power className="w-3.5 h-3.5" />
                      {ev.is_active ? '停用' : '啟用'}
                    </button>
                    <button
                      onClick={() => handleDelete(ev)}
                      className="text-xs px-3 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 transition-all duration-200 ease-apple flex items-center justify-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      刪除
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 建立 modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={() => !creating && setShowCreate(false)}>
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full max-h-[calc(100vh-2rem)] flex flex-col animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-3 border-b border-gray-100">
              <h2 className="font-bold text-gray-900 text-lg tracking-tight">建立新人才適性評估</h2>
              <p className="text-sm text-gray-500 mt-0.5">系統會自動產生公開連結。</p>
            </div>
            <form id="create-assessment-form" onSubmit={handleCreate} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5 tracking-tight">
                  測驗類型
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCreateTestType('logic')}
                    className={cn(
                      'px-3 py-2 rounded-xl text-sm text-center transition-all border',
                      createTestType === 'logic'
                        ? 'border-accent-500 bg-accent-50 ring-1 ring-accent-500/30 text-accent-900 font-semibold'
                        : 'border-gray-200 hover:border-gray-300 text-gray-600',
                    )}
                    title="30 題情境邏輯，約 22 分鐘"
                  >
                    🧠 邏輯思維
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateTestType('bigfive')}
                    className={cn(
                      'px-3 py-2 rounded-xl text-sm text-center transition-all border',
                      createTestType === 'bigfive'
                        ? 'border-fuchsia-500 bg-fuchsia-50 ring-1 ring-fuchsia-500/30 text-fuchsia-900 font-semibold'
                        : 'border-gray-200 hover:border-gray-300 text-gray-600',
                    )}
                    title="44 題五大人格量表，約 10 分鐘"
                  >
                    🌈 Big Five 人格
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5 tracking-tight">
                  活動類型
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCreateKind('employee')}
                    className={cn(
                      'px-3 py-2 rounded-xl text-sm text-center transition-all border',
                      createKind === 'employee'
                        ? 'border-accent-500 bg-accent-50 ring-1 ring-accent-500/30 text-accent-900 font-semibold'
                        : 'border-gray-200 hover:border-gray-300 text-gray-600',
                    )}
                    title="在職員工填寫"
                  >
                    👥 員工測驗
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateKind('interview')}
                    className={cn(
                      'px-3 py-2 rounded-xl text-sm text-center transition-all border',
                      createKind === 'interview'
                        ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500/30 text-purple-900 font-semibold'
                        : 'border-gray-200 hover:border-gray-300 text-gray-600',
                    )}
                    title="外部應徵者測驗，錄取後可歸檔"
                  >
                    🎯 面試人員測驗
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5 tracking-tight">
                  活動名稱 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="input-field"
                  placeholder="例如：2026 Q3 業務部評估"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5 tracking-tight">
                  截止日期 <span className="text-gray-400 font-normal text-xs">(選填)</span>
                </label>
                <input
                  type="datetime-local"
                  value={createDeadline}
                  onChange={(e) => setCreateDeadline(e.target.value)}
                  className="input-field"
                />
              </div>
              {createKind === 'employee' && (
              <div>
                <button
                  type="button"
                  onClick={() => setCreateCategoriesOpen(o => !o)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all text-left"
                >
                  <div>
                    <div className="text-sm font-semibold text-gray-700">
                      目標受測者分類
                      <span className="text-gray-400 font-normal text-xs ml-1.5">(可複選；不選 = 不限分類)</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {createCategories.length === 0
                        ? '尚未指定（不限）'
                        : <>已選 <span className="font-semibold text-accent-700">{createCategories.length}</span> 類 / <span className="font-semibold text-accent-700 tabular-nums">{createCategories.reduce((sum, c) => sum + categoryCounts[c], 0)}</span> 人</>}
                    </div>
                  </div>
                  <span className={cn('text-gray-400 transition-transform', createCategoriesOpen && 'rotate-180')}>▾</span>
                </button>
                {createCategoriesOpen && (
                <div className="space-y-1.5 mt-2">
                  {allCategoryKeys.map(key => {
                    const meta = categoriesMeta[key]
                    const checked = createCategories.includes(key)
                    return (
                      <label
                        key={key}
                        className={cn(
                          'flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all duration-150 ease-apple',
                          checked
                            ? 'border-accent-500 bg-accent-50 ring-1 ring-accent-500/30'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) setCreateCategories(prev => [...prev, key])
                            else setCreateCategories(prev => prev.filter(c => c !== key))
                          }}
                          className="mt-0.5 w-4 h-4 accent-accent-600"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold text-sm text-gray-900">{meta.label}</span>
                            <span className="text-xs text-gray-500 tabular-nums shrink-0">{categoryCounts[key]} 人</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{meta.description}</p>
                        </div>
                      </label>
                    )
                  })}
                </div>
                )}
              </div>
              )}
              {createKind === 'interview' && (
                <div className="px-3 py-2 bg-purple-50 rounded-lg text-xs text-purple-700 flex items-start gap-1.5">
                  <span>🎯</span>
                  <span>面試人員測驗：應徵者不在員工名冊內，作答後可在詳情頁標記錄取並一鍵加入名冊。</span>
                </div>
              )}
              {createError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-red-700 text-sm">
                  {createError}
                </div>
              )}
            </form>
            <div className="sticky bottom-0 px-6 py-3 bg-white border-t border-gray-100 flex justify-end gap-2 rounded-b-3xl">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                disabled={creating}
                className="btn-secondary text-sm"
              >
                取消
              </button>
              <button
                type="submit"
                form="create-assessment-form"
                disabled={!createName.trim() || creating}
                className="btn-primary text-sm disabled:opacity-40"
              >
                {creating ? '建立中…' : '建立活動'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
