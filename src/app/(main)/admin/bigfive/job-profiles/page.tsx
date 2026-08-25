'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2, Edit3, Check, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { cn } from '@/lib/utils'
import { hasHRAccess } from '@/lib/permissions'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import bigfiveTestJson from '@/data/bigfive-test.json'
import type { BigFiveTestJson, BigFiveDimension } from '@/types/bigfive'

const DATA = bigfiveTestJson as unknown as BigFiveTestJson
const DIM_KEYS: BigFiveDimension[] = ['E', 'A', 'C', 'N', 'O']

interface JobProfile {
  id: string
  name: string
  description: string | null
  ideal: Record<string, number>
  weights: Record<string, number> | null
  created_at: string
}

interface EditForm {
  id?: string
  name: string
  description: string
  ideal: Record<BigFiveDimension, number>
  weights: Record<BigFiveDimension, number>
}

function emptyForm(): EditForm {
  return {
    name: '',
    description: '',
    ideal: { E: 60, A: 60, C: 60, N: 40, O: 60 },
    weights: { E: 1, A: 1, C: 1, N: 1, O: 1 },
  }
}

export default function JobProfilesPage() {
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const canView = hasHRAccess(user) || user?.role === 'chairman'

  const [profiles, setProfiles] = useState<JobProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/bigfive/job-profiles')
      const data = await res.json()
      if (res.ok) setProfiles(data.profiles || [])
    } finally { setLoading(false) }
  }

  useEffect(() => { if (canView) load() }, [canView])

  function startEdit(p?: JobProfile) {
    if (!p) { setEditing(emptyForm()); return }
    setEditing({
      id: p.id,
      name: p.name,
      description: p.description || '',
      ideal: { ...emptyForm().ideal, ...(p.ideal as Record<BigFiveDimension, number>) },
      weights: { ...emptyForm().weights, ...((p.weights || {}) as Record<BigFiveDimension, number>) },
    })
  }

  async function save() {
    if (!editing) return
    if (!editing.name.trim()) { toast.error('請填寫名稱'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/bigfive/job-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      })
      const data = await res.json()
      if (!res.ok) { toast.error('儲存失敗：' + (data.error || res.status)); return }
      setEditing(null)
      toast.success('已儲存職位剖面')
      await load()
    } catch (e) {
      toast.error('儲存失敗：' + (e instanceof Error ? e.message : '未知錯誤'))
    } finally { setSaving(false) }
  }

  async function remove(p: JobProfile) {
    const ok = await confirm({ title: '刪除職位剖面', message: `確定刪除「${p.name}」？`, danger: true, confirmLabel: '刪除' })
    if (!ok) return
    const res = await fetch(`/api/admin/bigfive/job-profiles?id=${p.id}`, { method: 'DELETE' })
    if (!res.ok) { const d = await res.json(); toast.error('刪除失敗：' + (d.error || res.status)); return }
    load()
  }

  if (!canView) return <div className="p-4 text-center py-12 text-gray-400">您沒有權限查看此頁面</div>

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">職位人格剖面</h1>
          <p className="text-sm text-gray-500 mt-1">為每種職位定義理想 Big Five 分布，系統會依此計算每位受測者的 fit score</p>
        </div>
        <button onClick={() => startEdit()} className="btn-primary text-sm flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> 新增剖面
        </button>
      </div>

      <Link href="/admin/assessments" className="text-xs text-accent-600 hover:underline mb-4 inline-block">← 返回活動列表</Link>

      {loading ? (
        <div className="card text-center py-12">
          <div className="w-6 h-6 border-4 border-fuchsia-500 border-t-transparent rounded-full animate-spin inline-block" />
        </div>
      ) : profiles.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">尚無職位剖面</div>
      ) : (
        <div className="space-y-2">
          {profiles.map(p => (
            <div key={p.id} className="card">
              <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-900">{p.name}</h3>
                  {p.description && <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => startEdit(p)} className="p-1.5 rounded-lg text-gray-400 hover:text-accent-600 hover:bg-accent-50">
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button onClick={() => remove(p)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-2 text-xs">
                {DIM_KEYS.map(k => (
                  <div key={k} className="text-center">
                    <div className="text-gray-500">{DATA.dimensions[k].label}</div>
                    <div className="font-bold text-fuchsia-700 tabular-nums">{p.ideal?.[k] ?? '—'}</div>
                    {p.weights && (
                      <div className="text-[10px] text-gray-400">×{p.weights[k] ?? 1}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !saving && setEditing(null)}>
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[calc(100vh-2rem)] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-3 border-b border-gray-100">
              <h2 className="text-lg font-bold tracking-tight">{editing.id ? '編輯剖面' : '新增剖面'}</h2>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">名稱 *</label>
                <input type="text" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="input-field text-sm" placeholder="例如：業務 / Sales" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">描述</label>
                <textarea value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={2} className="input-field text-sm" placeholder="這個職位的人格特質側重" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">理想分數（0-100）+ 權重</label>
                <div className="space-y-2">
                  {DIM_KEYS.map(k => (
                    <div key={k} className="grid grid-cols-12 items-center gap-2">
                      <span className="col-span-2 text-xs text-gray-700">{DATA.dimensions[k].label}</span>
                      <input
                        type="range" min={0} max={100}
                        value={editing.ideal[k]}
                        onChange={e => setEditing({ ...editing, ideal: { ...editing.ideal, [k]: Number(e.target.value) } })}
                        className="col-span-6 accent-fuchsia-500"
                      />
                      <span className="col-span-1 text-xs tabular-nums font-bold text-fuchsia-700 text-right">{editing.ideal[k]}</span>
                      <span className="col-span-1 text-[10px] text-gray-400 text-center">×</span>
                      <input
                        type="number" min={0} max={3} step={0.1}
                        value={editing.weights[k]}
                        onChange={e => setEditing({ ...editing, weights: { ...editing.weights, [k]: Number(e.target.value) || 1 } })}
                        className="col-span-2 text-xs px-2 py-1 rounded-lg border border-gray-200 outline-none focus:ring-1 focus:ring-fuchsia-300 text-right tabular-nums"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-2">權重 0.5 = 此維度不重要；1 = 正常；1.5+ = 此維度特別重要</p>
              </div>
            </div>
            <div className="sticky bottom-0 px-6 py-3 bg-white border-t border-gray-100 flex justify-end gap-2 rounded-b-3xl">
              <button onClick={() => setEditing(null)} disabled={saving} className="btn-secondary text-sm">取消</button>
              <button onClick={save} disabled={saving || !editing.name.trim()} className="btn-primary text-sm disabled:opacity-50">
                {saving ? '儲存中…' : '✓ 儲存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
