'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ArrowRight, Users, ClipboardList, Contact, BarChart3, Target, ShieldCheck, Bell, Settings, UserPlus, ArrowLeftRight, Upload, Download, Tag, Sparkles, UserMinus, Building2, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase-client'
import { cn } from '@/lib/utils'
import { useShortcutKey } from '@/lib/use-platform'
import { isAdmin as checkAdmin, isChairman as checkChairman, isDirectorOrManager as checkDirMgr, hasHRAccess as checkHR, canViewEmployees, canViewTeamReports } from '@/lib/permissions'

interface CommandItem {
  id: string
  label: string
  href: string
  icon: LucideIcon
  group: string
  keywords?: string  // 額外的搜尋關鍵字
  show: boolean
}

export function CommandPalette() {
  const router = useRouter()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const shortcutKey = useShortcutKey()

  const isAdmin = checkAdmin(user)
  const isChairman = checkChairman(user)
  const isDirectorOrManager = checkDirMgr(user)
  const hasHRAccess = checkHR(user)
  const hasRosterAccess = canViewEmployees(user)
  const canReports = canViewTeamReports(user)

  const items: CommandItem[] = useMemo(() => [
    // 主要功能
    { id: 'customers', label: '客戶列表', href: '/customers', icon: Users, group: '主要', keywords: 'customers list', show: true },
    { id: 'new-customer', label: '新增客戶', href: '/customers/new', icon: UserPlus, group: '主要', keywords: 'add new', show: true },
    { id: 'my-customers', label: '我的客戶', href: '/my-customers', icon: Users, group: '主要', keywords: 'my mine', show: true },
    { id: 'notifications', label: '通知中心', href: '/notifications', icon: Bell, group: '主要', show: true },
    { id: 'more', label: '帳號設定', href: '/more', icon: Settings, group: '主要', keywords: 'account settings', show: true },
    // 管理功能
    { id: 'transfers', label: '審核中心', href: '/transfers', icon: ArrowLeftRight, group: '管理', keywords: '轉移 刪除 審核', show: isAdmin || isChairman || isDirectorOrManager },
    { id: 'users', label: '使用者管理', href: '/admin/users', icon: ShieldCheck, group: '管理', show: isAdmin || isChairman },
    { id: 'reports', label: '每週報表', href: '/admin/reports', icon: BarChart3, group: '管理', show: canReports },
    { id: 'performance', label: '業務績效', href: '/admin/performance', icon: Target, group: '管理', show: canReports },
    { id: 'import', label: '客戶匯入', href: '/admin/import', icon: Upload, group: '管理', show: isAdmin },
    { id: 'export', label: '匯出資料', href: '/admin/export', icon: Download, group: '管理', show: isAdmin },
    { id: 'batch-grade', label: '批次調整', href: '/admin/batch-grade', icon: Tag, group: '管理', keywords: '等級 負責人 狀態 批次', show: isAdmin || isChairman || isDirectorOrManager },
    { id: 'duplicates', label: '重複客戶清理', href: '/admin/duplicates', icon: Sparkles, group: '管理', show: isAdmin },
    { id: 'departed', label: '離職員工', href: '/admin/departed', icon: UserMinus, group: '管理', show: isAdmin || isChairman || isDirectorOrManager },
    { id: 'assessments', label: '人才適性評估', href: '/admin/assessments', icon: ClipboardList, group: '人才', keywords: '測驗 big five 邏輯', show: hasHRAccess },
    { id: 'employees', label: '員工名冊', href: '/admin/employees', icon: Contact, group: '人才', keywords: 'roster', show: hasRosterAccess },
    { id: 'job-profiles', label: '職位人格剖面', href: '/admin/bigfive/job-profiles', icon: Sparkles, group: '人才', keywords: 'fit profile', show: hasRosterAccess },
  ], [isAdmin, isChairman, isDirectorOrManager, hasHRAccess, hasRosterAccess, canReports])

  // 客戶即時搜尋（輸入 >= 2 字才查資料庫，debounce 250ms）
  const [customerHits, setCustomerHits] = useState<{ id: string; company_name: string }[]>([])
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) { setCustomerHits([]); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('customers')
        .select('id, company_name')
        .ilike('company_name', `%${term}%`)
        .limit(6)
      if (!cancelled) setCustomerHits((data as { id: string; company_name: string }[]) || [])
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  // 測驗活動即時搜尋（僅具人才權限者）
  const [eventHits, setEventHits] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2 || !hasHRAccess) { setEventHits([]); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('assessment_events')
        .select('id, name')
        .ilike('name', `%${term}%`)
        .limit(5)
      if (!cancelled) setEventHits((data as { id: string; name: string }[]) || [])
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, hasHRAccess])

  // ⌘K / Ctrl+K 開啟
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const visible = items.filter(i => i.show)
    const navMatches = !q ? visible : visible.filter(i =>
      i.label.toLowerCase().includes(q) ||
      (i.keywords && i.keywords.toLowerCase().includes(q)) ||
      i.group.toLowerCase().includes(q),
    )
    // 客戶搜尋結果排在最前面（最常用）
    const customerMatches: CommandItem[] = customerHits.map(c => ({
      id: `customer-${c.id}`,
      label: c.company_name,
      href: `/customers/${c.id}`,
      icon: Building2,
      group: '客戶',
      show: true,
    }))
    const eventMatches: CommandItem[] = eventHits.map(ev => ({
      id: `event-${ev.id}`,
      label: ev.name,
      href: `/admin/assessments/${ev.id}`,
      icon: ClipboardList,
      group: '測驗活動',
      show: true,
    }))
    return [...customerMatches, ...eventMatches, ...navMatches]
  }, [items, query, customerHits, eventHits])

  // 鍵盤導覽
  useEffect(() => {
    if (!open) { setQuery(''); setActiveIdx(0); return }
    function handler(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(i => (i + 1) % filtered.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(i => (i - 1 + filtered.length) % filtered.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = filtered[activeIdx]
        if (item) {
          router.push(item.href)
          setOpen(false)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, filtered, activeIdx, router])

  useEffect(() => { setActiveIdx(0) }, [query])

  if (!open) return null

  // 依 group 分組
  const grouped = filtered.reduce<Record<string, CommandItem[]>>((acc, it) => {
    if (!acc[it.group]) acc[it.group] = []
    acc[it.group].push(it)
    return acc
  }, {})

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-start justify-center px-4 pt-[15vh] animate-fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center px-4 py-3 border-b border-gray-100">
          <Search className="w-5 h-5 text-gray-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`搜尋客戶、功能、頁面… (${shortcutKey} 開關)`}
            className="flex-1 mx-3 outline-none text-sm bg-transparent text-gray-900 placeholder:text-gray-400"
          />
          <kbd className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">Esc</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">沒有符合的結果</div>
          ) : (
            Object.entries(grouped).map(([group, list]) => (
              <div key={group} className="mb-2 last:mb-0">
                <div className="text-[10px] text-gray-400 uppercase tracking-widest px-2 mb-1 font-semibold">{group}</div>
                {list.map((it) => {
                  const Icon = it.icon
                  const globalIdx = filtered.indexOf(it)
                  const isActive = globalIdx === activeIdx
                  return (
                    <button
                      key={it.id}
                      onClick={() => { router.push(it.href); setOpen(false) }}
                      onMouseEnter={() => setActiveIdx(globalIdx)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all text-left',
                        isActive ? 'bg-accent-50 text-accent-900' : 'text-gray-700 hover:bg-gray-50',
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0 text-gray-500" />
                      <span className="flex-1 font-medium">{it.label}</span>
                      {isActive && <ArrowRight className="w-4 h-4 text-accent-600" />}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
          <div className="flex items-center gap-3">
            <span><kbd className="bg-gray-100 px-1 rounded">↑↓</kbd> 選擇</span>
            <span><kbd className="bg-gray-100 px-1 rounded">↵</kbd> 開啟</span>
          </div>
          <span>{filtered.length} 個結果</span>
        </div>
      </div>
    </div>
  )
}
