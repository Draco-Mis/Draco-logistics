'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip, LabelList,
  CartesianGrid,
} from 'recharts'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import type { AssessmentEvent, AssessmentSubmission, LogicTestJson, LogicTestVersion, LogicAnswers, LogicTestLevel } from '@/types/logic-test'
import type { EmployeeCategory } from '@/types/employee'
import logicTestJson from '@/data/logic-test.json'
import { LogicTestReport } from '@/components/LogicTestReport'
import { shuffleForVersion } from '@/lib/logic-test-shuffle'
import { computeBenchmarkForAdmin } from '@/lib/logic-test-benchmark'
import { useEmployees, filterByCategories, getCategoryMeta, getAllCategoryKeys, getAllCategoriesMeta } from '@/lib/employees'
import type { Employee } from '@/types/employee'
import { formatDateTime, cn } from '@/lib/utils'
import { Pencil } from 'lucide-react'
import { ASSESSMENT_DEPARTMENTS } from '@/lib/departments'
import bigfiveTestJson from '@/data/bigfive-test.json'
import type { BigFiveTestJson, BigFiveScores, BigFiveDimension, BigFiveAnswers } from '@/types/bigfive'
import { BigFiveRadar } from '@/components/BigFiveRadar'
import { BigFiveDerivedPanel } from '@/components/BigFiveDerivedPanel'
import { detectBigFiveQuality } from '@/lib/bigfive-quality'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'

const BIGFIVE_DATA = bigfiveTestJson as unknown as BigFiveTestJson
const BIGFIVE_DIM_KEYS = Object.keys(BIGFIVE_DATA.dimensions) as BigFiveDimension[]

const JSON_DATA = logicTestJson as unknown as LogicTestJson
const CATEGORY_KEYS = Object.keys(JSON_DATA.categories)

function levelBadge(level: string): string {
  return level === '優秀' ? 'bg-green-100 text-green-700'
    : level === '良好' ? 'bg-blue-100 text-blue-700'
    : level === '中等' ? 'bg-yellow-100 text-yellow-700'
    : 'bg-orange-100 text-orange-700'
}

// 在文字段中解析 **粗體** Markdown 語法
function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={`${keyPrefix}-${i}`} className="text-gray-900 font-semibold">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>
  })
}

export default function AdminAssessmentDetailPage() {
  const { id } = useParams()
  const idStr = String(id || '')
  const { user } = useAuth()
  const supabase = createClient()
  const toast = useToast()
  const confirm = useConfirm()

  const { employees: roster, reload: reloadRoster } = useEmployees()
  const [event, setEvent] = useState<AssessmentEvent | null>(null)
  const [subs, setSubs] = useState<AssessmentSubmission[]>([])
  const [inProgressSubs, setInProgressSubs] = useState<AssessmentSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [deptFilter, setDeptFilter] = useState('')
  const [catFilter, setCatFilter] = useState<EmployeeCategory[]>([])
  const [sortKey, setSortKey] = useState<string>('completed_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [viewing, setViewing] = useState<AssessmentSubmission | null>(null)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [downloadingGroupPdf, setDownloadingGroupPdf] = useState(false)
  const [editingAnswers, setEditingAnswers] = useState<LogicAnswers | null>(null)
  const [savingAnswers, setSavingAnswers] = useState(false)
  const [editingInfo, setEditingInfo] = useState<AssessmentSubmission | null>(null)
  const [savingInfo, setSavingInfo] = useState(false)
  // 面試錄取 → 加入員工名冊用
  const [addToRoster, setAddToRoster] = useState<AssessmentSubmission | null>(null)
  const [rosterForm, setRosterForm] = useState({ chinese_name: '', english_name: '', title: '', category: 'staff' as EmployeeCategory })
  const [addingToRoster, setAddingToRoster] = useState(false)
  const reportRef = useRef<HTMLDivElement | null>(null)
  const groupReportRef = useRef<HTMLDivElement | null>(null)

  // 把 modal 內的報告（不含逐題解析）截圖、轉成 A4 多頁 PDF 下載
  // 動態 import 套件，沒按下載按鈕的人不會載入這 ~600KB
  //
  // 分頁策略：以「卡片」為原子單位
  // - 找出 reportRef 內所有 .card 元素，逐張獨立截圖
  // - 依序貼到 PDF，若當前頁裝不下整張卡，就先換頁再貼
  // - 萬一單張卡片本身就比一頁還高（極長的 AI 性向分析），才退而求其次切片
  // 這樣避免雷達圖、長條圖、解讀卡片在頁面中間被切斷
  async function downloadReportPdf() {
    if (!viewing || !reportRef.current) return
    setDownloadingPdf(true)
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])

      const cards = Array.from(
        reportRef.current.querySelectorAll<HTMLElement>('.card'),
      )
      if (cards.length === 0) throw new Error('找不到可匯出的卡片內容')

      const cardCanvases = await Promise.all(
        cards.map(card =>
          html2canvas(card, {
            scale: 2,
            backgroundColor: '#ffffff',
            useCORS: true,
            logging: false,
          }),
        ),
      )

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      const pageW = pdf.internal.pageSize.getWidth()   // 210
      const pageH = pdf.internal.pageSize.getHeight()  // 297
      const margin = 10
      const cardGap = 4
      const usableW = pageW - margin * 2
      const usableH = pageH - margin * 2

      let currentY = margin
      let isFirstOnPage = true

      for (const canvas of cardCanvases) {
        const cardH = (canvas.height * usableW) / canvas.width

        // 卡片本身就比一整頁還高 → 換新一頁開始切片
        if (cardH > usableH) {
          if (!isFirstOnPage) pdf.addPage()
          const pxPerMm = canvas.width / usableW
          const sliceMaxPx = Math.floor(usableH * 0.9 * pxPerMm)
          // 找最佳切點：往上掃 240px 找深色像素最少的橫列
          const srcCtx2 = canvas.getContext('2d')
          const safeCut2 = (targetY: number): number => {
            if (!srcCtx2 || targetY >= canvas.height) return targetY
            const upBound = Math.max(targetY - 480, 0)
            let bestY = targetY
            let bestDarkness = Infinity
            for (let y = targetY; y > upBound; y -= 2) {
              const data = srcCtx2.getImageData(0, y, canvas.width, 1).data
              let darkness = 0
              for (let x = 0; x < canvas.width; x += 4) {
                const i = x * 4
                const luma = (data[i] + data[i + 1] + data[i + 2]) / 3
                if (luma < 230) darkness++
              }
              if (darkness === 0) return y
              if (darkness < bestDarkness) { bestDarkness = darkness; bestY = y }
            }
            return bestY
          }
          let yOffset = 0
          let isFirstSlice = true
          let lastSliceMm = 0
          while (yOffset < canvas.height) {
            if (!isFirstSlice) pdf.addPage()
            const rawEnd = Math.min(yOffset + sliceMaxPx, canvas.height)
            const safeEnd = rawEnd < canvas.height ? safeCut2(rawEnd) : rawEnd
            const sliceH = safeEnd - yOffset
            const sliceCanvas = document.createElement('canvas')
            sliceCanvas.width = canvas.width
            sliceCanvas.height = sliceH
            const ctx = sliceCanvas.getContext('2d')
            if (!ctx) throw new Error('無法建立 canvas context')
            ctx.drawImage(canvas, 0, -yOffset)
            const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.92)
            pdf.addImage(sliceData, 'JPEG', margin, margin, usableW, sliceH / pxPerMm)
            yOffset = safeEnd
            lastSliceMm = sliceH / pxPerMm
            isFirstSlice = false
          }
          currentY = margin + lastSliceMm + cardGap
          isFirstOnPage = false
          continue
        }

        // 一般情況：當前頁裝不下這張卡 → 換頁
        if (!isFirstOnPage && currentY + cardH > pageH - margin) {
          pdf.addPage()
          currentY = margin
          isFirstOnPage = true
        }

        const imgData = canvas.toDataURL('image/jpeg', 0.92)
        pdf.addImage(imgData, 'JPEG', margin, currentY, usableW, cardH)
        currentY += cardH + cardGap
        isFirstOnPage = false
      }

      const safeName = viewing.respondent_name.replace(/[\\/:*?"<>|]/g, '_')
      const dateStr = viewing.completed_at ? viewing.completed_at.slice(0, 10) : 'unknown'
      pdf.save(`人才適性評估_${safeName}_${dateStr}.pdf`)
    } catch (e) {
      toast.error('PDF 下載失敗：' + (e instanceof Error ? e.message : '未知錯誤'))
    } finally {
      setDownloadingPdf(false)
    }
  }

  // 匯出分類報告 PDF — 把目前篩選結果的「封面 + 圖表 + 表格」整份打包
  async function downloadGroupReportPdf() {
    if (!groupReportRef.current || !event) return
    setDownloadingGroupPdf(true)

    // 暫時顯示「PDF 專用」內容、暫時隱藏「PDF 略過」內容
    const root = groupReportRef.current
    const pdfOnly = Array.from(root.querySelectorAll<HTMLElement>('[data-pdf-only="true"]'))
    const pdfSkip = Array.from(root.querySelectorAll<HTMLElement>('[data-pdf-skip="true"]'))
    const restorePdfOnly = pdfOnly.map(el => {
      const prev = el.style.display
      el.style.display = 'block'
      el.classList.remove('hidden')
      return { el, prev }
    })
    const restorePdfSkip = pdfSkip.map(el => {
      const prev = el.style.display
      el.style.display = 'none'
      return { el, prev }
    })

    // 把所有 overflow-x-auto / overflow-y-auto / truncate 暫時關掉，
    // 讓 html2canvas 可以看到並截到「視覺被裁掉」的內容
    const scrollContainers = Array.from(root.querySelectorAll<HTMLElement>(
      '.overflow-x-auto, .overflow-y-auto, .overflow-auto, .overflow-hidden',
    ))
    const restoreScroll = scrollContainers.map(el => {
      const prevOverflow = el.style.overflow
      const prevOverflowX = el.style.overflowX
      const prevOverflowY = el.style.overflowY
      el.style.overflow = 'visible'
      el.style.overflowX = 'visible'
      el.style.overflowY = 'visible'
      return { el, prevOverflow, prevOverflowX, prevOverflowY }
    })

    // 把 truncate 暫時關掉（避免長字串被「...」截斷）
    const truncated = Array.from(root.querySelectorAll<HTMLElement>('.truncate'))
    const restoreTruncate = truncated.map(el => {
      el.classList.remove('truncate')
      return el
    })

    // 強制把容器設為桌機寬度（1024px），確保不管手機/平板/桌機匯出
    // 都產出一致的 PDF 佈局，避免窄螢幕導致每張卡縱向過高被切片
    const restoreRootStyle = {
      width: root.style.width,
      maxWidth: root.style.maxWidth,
      minWidth: root.style.minWidth,
      position: root.style.position,
    }
    root.style.width = '1024px'
    root.style.maxWidth = '1024px'
    root.style.minWidth = '1024px'

    // 把 recharts ResponsiveContainer 的尺寸寫死避免 SVG 跑位
    const responsiveContainers = Array.from(root.querySelectorAll<HTMLElement>('.recharts-responsive-container'))
    const restoreContainers = responsiveContainers.map(el => ({
      el, width: el.style.width, height: el.style.height,
    }))
    await new Promise(r => requestAnimationFrame(() => r(null)))
    await new Promise(r => requestAnimationFrame(() => r(null)))
    await new Promise(r => setTimeout(r, 500))
    for (const el of responsiveContainers) {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        el.style.width = rect.width + 'px'
        el.style.height = rect.height + 'px'
      }
    }
    await new Promise(r => setTimeout(r, 300))

    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])

      const cards = Array.from(
        root.querySelectorAll<HTMLElement>('.card'),
      ).filter(c => c.style.display !== 'none')
      if (cards.length === 0) throw new Error('沒有可匯出的內容')

      const cardCanvases = await Promise.all(
        cards.map(card =>
          html2canvas(card, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false }),
        ),
      )

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const margin = 10
      const cardGap = 4
      const usableW = pageW - margin * 2
      const usableH = pageH - margin * 2

      let currentY = margin
      let isFirstOnPage = true

      for (const canvas of cardCanvases) {
        const cardH = (canvas.height * usableW) / canvas.width
        if (cardH > usableH) {
          if (!isFirstOnPage) pdf.addPage()
          const pxPerMm = canvas.width / usableW
          const sliceMaxPx = Math.floor(usableH * 0.9 * pxPerMm)
          // 切片時找「深色像素最少」的橫列當切點，避免從字行中間切
          // 中文字行間沒有純白橫列（字密集 + 抗鋸齒），改用最少深色計分
          const srcCtx = canvas.getContext('2d')
          const safeCut = (targetY: number): number => {
            if (!srcCtx || targetY >= canvas.height) return targetY
            const upBound = Math.max(targetY - 480, 0)
            let bestY = targetY
            let bestDarkness = Infinity
            const sampleStep = 4
            for (let y = targetY; y > upBound; y -= 2) {
              const data = srcCtx.getImageData(0, y, canvas.width, 1).data
              let darkness = 0
              for (let x = 0; x < canvas.width; x += sampleStep) {
                const i = x * 4
                const luma = (data[i] + data[i + 1] + data[i + 2]) / 3
                if (luma < 230) darkness++
              }
              if (darkness === 0) return y
              if (darkness < bestDarkness) {
                bestDarkness = darkness
                bestY = y
              }
            }
            return bestY
          }
          let yOffset = 0
          let isFirstSlice = true
          let lastSliceMm = 0  // 紀錄最後一塊切片高度，避免下一張卡覆蓋
          while (yOffset < canvas.height) {
            if (!isFirstSlice) pdf.addPage()
            const rawEnd = Math.min(yOffset + sliceMaxPx, canvas.height)
            const safeEnd = rawEnd < canvas.height ? safeCut(rawEnd) : rawEnd
            const sliceH = safeEnd - yOffset
            const sliceCanvas = document.createElement('canvas')
            sliceCanvas.width = canvas.width
            sliceCanvas.height = sliceH
            const ctx = sliceCanvas.getContext('2d')
            if (!ctx) throw new Error('無法建立 canvas context')
            ctx.drawImage(canvas, 0, -yOffset)
            pdf.addImage(sliceCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, usableW, sliceH / pxPerMm)
            yOffset = safeEnd
            lastSliceMm = sliceH / pxPerMm
            isFirstSlice = false
          }
          // 切片結束 → currentY 必須指向最後切片的下緣，不能歸零
          currentY = margin + lastSliceMm + cardGap
          isFirstOnPage = false
          continue
        }
        if (!isFirstOnPage && currentY + cardH > pageH - margin) {
          pdf.addPage()
          currentY = margin
          isFirstOnPage = true
        }
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, currentY, usableW, cardH)
        currentY += cardH + cardGap
        isFirstOnPage = false
      }

      const catTag = catFilter.length === 0
        ? '全部分類'
        : catFilter.map(c => categoriesMeta[c as EmployeeCategory]?.label || c).join('_')
      const deptTag = deptFilter || '全部'
      const safeName = event.name.replace(/[\\/:*?"<>|]/g, '_')
      const today = new Date().toISOString().slice(0, 10)
      pdf.save(`分類報告_${safeName}_${catTag}_${deptTag}_${today}.pdf`)
    } catch (e) {
      toast.error('PDF 下載失敗：' + (e instanceof Error ? e.message : '未知錯誤'))
    } finally {
      // 還原顯示狀態
      for (const r of restorePdfOnly) {
        r.el.style.display = r.prev
        if (!r.prev) r.el.classList.add('hidden')
      }
      for (const r of restorePdfSkip) r.el.style.display = r.prev
      for (const r of restoreScroll) {
        r.el.style.overflow = r.prevOverflow
        r.el.style.overflowX = r.prevOverflowX
        r.el.style.overflowY = r.prevOverflowY
      }
      for (const el of restoreTruncate) el.classList.add('truncate')
      for (const r of restoreContainers) {
        r.el.style.width = r.width
        r.el.style.height = r.height
      }
      root.style.width = restoreRootStyle.width
      root.style.maxWidth = restoreRootStyle.maxWidth
      root.style.minWidth = restoreRootStyle.minWidth
      root.style.position = restoreRootStyle.position
      setDownloadingGroupPdf(false)
    }
  }

  async function saveEditedAnswers() {
    if (!viewing || !editingAnswers) return
    setSavingAnswers(true)
    try {
      const res = await fetch('/api/admin/assessments/submission/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: viewing.id, logic_answers: editingAnswers }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error('儲存失敗：' + (data.error || res.status)); return }
      // 同步更新 viewing + subs
      const updated: AssessmentSubmission = {
        ...viewing,
        logic_answers: editingAnswers,
        logic_scores: data.logic_scores,
      }
      setViewing(updated)
      setSubs(prev => prev.map(x => x.id === viewing.id ? updated : x))
      setEditingAnswers(null)
      toast.success('已儲存並重新計分')
    } catch (e) {
      toast.error('儲存失敗：' + (e instanceof Error ? e.message : '未知錯誤'))
    } finally {
      setSavingAnswers(false)
    }
  }

  const canView = !!user && (user.role === 'admin' || user.role === 'director' || user.role === 'hr' || user.team === '財管部')

  useEffect(() => {
    if (!canView || !idStr) return
    ;(async () => {
      const [evRes, subRes, inProgressRes] = await Promise.all([
        supabase.from('assessment_events').select('*').eq('id', idStr).maybeSingle(),
        supabase
          .from('assessment_submissions')
          .select('*')
          .eq('event_id', idStr)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false }),
        supabase
          .from('assessment_submissions')
          .select('*')
          .eq('event_id', idStr)
          .eq('status', 'in_progress')
          .order('started_at', { ascending: false }),
      ])
      setEvent(evRes.data as AssessmentEvent | null)
      setSubs((subRes.data as AssessmentSubmission[] | null) ?? [])
      setInProgressSubs((inProgressRes.data as AssessmentSubmission[] | null) ?? [])
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, idStr])

  async function handleDeleteSubmission(s: AssessmentSubmission) {
    const ok = await confirm({
      title: '刪除作答紀錄',
      message: `確定刪除「${s.respondent_name}${s.english_name ? ' (' + s.english_name + ')' : ''}」這筆作答紀錄？\n\n刪除後此人的分數與答案會永久消失，無法復原。`,
      danger: true,
      confirmLabel: '刪除',
    })
    if (!ok) return
    try {
      const res = await fetch('/api/admin/assessments/submission/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error('刪除失敗：' + (data.error || res.status)); return }
      setSubs(prev => prev.filter(x => x.id !== s.id))
      if (viewing?.id === s.id) setViewing(null)
    } catch (e) {
      toast.error('刪除失敗：' + (e instanceof Error ? e.message : '未知錯誤'))
    }
  }

  async function toggleHired(s: AssessmentSubmission) {
    const next = !s.hired_at
    try {
      const res = await fetch('/api/admin/assessments/submission/hire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, hired: next }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error('更新失敗：' + (data.error || res.status)); return }
      const newSub: AssessmentSubmission = {
        ...s,
        hired_at: next ? (data.hired_at || new Date().toISOString()) : null,
        hired_employee_id: next ? s.hired_employee_id : null,
      }
      setSubs(prev => prev.map(x => x.id === s.id ? newSub : x))
      if (viewing?.id === s.id) setViewing(newSub)
    } catch (e) {
      toast.error('更新失敗：' + (e instanceof Error ? e.message : '未知錯誤'))
    }
  }

  function openAddToRoster(s: AssessmentSubmission) {
    setRosterForm({
      chinese_name: s.respondent_name,
      english_name: '',
      title: '',
      category: 'staff',
    })
    setAddToRoster(s)
  }

  async function submitAddToRoster() {
    if (!addToRoster) return
    if (!rosterForm.chinese_name.trim()) { toast.error('姓名不可空白'); return }
    setAddingToRoster(true)
    try {
      const res = await fetch('/api/admin/assessments/submission/to-roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: addToRoster.id,
          chinese_name: rosterForm.chinese_name.trim(),
          english_name: rosterForm.english_name.trim() || undefined,
          title: rosterForm.title.trim() || undefined,
          category: rosterForm.category,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error('加入名冊失敗：' + (data.error || res.status)); return }
      const newSub: AssessmentSubmission = {
        ...addToRoster,
        hired_at: addToRoster.hired_at || new Date().toISOString(),
        hired_employee_id: data.employee?.id || addToRoster.hired_employee_id,
      }
      setSubs(prev => prev.map(x => x.id === addToRoster.id ? newSub : x))
      setAddToRoster(null)
      // 重新載入名冊，剛加入的人下次比對就會被歸類到正確的 category
      await reloadRoster()
      toast.success(`已將「${data.employee?.chinese_name}」加入員工名冊`)
    } catch (e) {
      toast.error('加入名冊失敗：' + (e instanceof Error ? e.message : '未知錯誤'))
    } finally {
      setAddingToRoster(false)
    }
  }

  async function saveInfoEdit() {
    if (!editingInfo) return
    const name = editingInfo.respondent_name.trim()
    if (!name) { toast.error('姓名不可空白'); return }
    setSavingInfo(true)
    try {
      const res = await fetch('/api/admin/assessments/submission/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingInfo.id,
          respondent_name: name,
          english_name: editingInfo.english_name || '',
          department: editingInfo.department,
          employee_code: editingInfo.employee_code || '',
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error('更新失敗：' + (data.error || res.status)); return }
      const updated: AssessmentSubmission = {
        ...editingInfo,
        respondent_name: name,
        english_name: editingInfo.english_name?.trim() || null,
        department: editingInfo.department,
        employee_code: editingInfo.employee_code?.trim() || null,
      }
      setSubs(prev => prev.map(x => x.id === updated.id ? updated : x))
      if (viewing?.id === updated.id) setViewing(updated)
      setEditingInfo(null)
    } catch (e) {
      toast.error('更新失敗：' + (e instanceof Error ? e.message : '未知錯誤'))
    } finally {
      setSavingInfo(false)
    }
  }

  const departments = useMemo(() => {
    const set = new Set<string>()
    for (const s of subs) set.add(s.department)
    return Array.from(set).sort()
  }, [subs])

  // 用名冊把受測者姓名對應到分類（找不到者標 unknown）
  const nameToCategory = useMemo(() => {
    const map = new Map<string, EmployeeCategory | 'unknown'>()
    for (const e of roster) map.set(e.name, e.category)
    return map
  }, [roster])

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of subs) {
      const c = nameToCategory.get(s.respondent_name.trim()) || 'unknown'
      counts[c] = (counts[c] || 0) + 1
    }
    return counts
  }, [subs, nameToCategory])

  const filtered = useMemo(() => {
    let list = subs
    if (deptFilter) list = list.filter(s => s.department === deptFilter)
    if (catFilter.length > 0) {
      const set = new Set<string>(catFilter)
      list = list.filter(s => set.has(nameToCategory.get(s.respondent_name.trim()) || 'unknown'))
    }
    return list
  }, [subs, deptFilter, catFilter, nameToCategory])

  const categoriesMeta = getAllCategoriesMeta()
  const allCategoryKeys = getAllCategoryKeys()

  // 表格排序
  const LEVEL_RANK: Record<string, number> = { '優秀': 4, '良好': 3, '中等': 2, '待加強': 1 }
  function valueForSort(s: AssessmentSubmission, key: string): number | string {
    if (key === 'name') return s.respondent_name
    if (key === 'department') return s.department || ''
    if (key === 'version') return s.version
    if (key === 'total') return s.logic_scores?.total.score ?? -1
    if (key === 'level') return LEVEL_RANK[s.logic_scores?.total.level || ''] ?? 0
    if (key === 'completed_at') return s.completed_at ? new Date(s.completed_at).getTime() : 0
    if (key.startsWith('cat:')) {
      const catKey = key.slice(4)
      return s.logic_scores?.categories[catKey]?.score ?? -1
    }
    return 0
  }
  const sortedFiltered = useMemo(() => {
    const list = [...filtered]
    list.sort((a, b) => {
      const va = valueForSort(a, sortKey)
      const vb = valueForSort(b, sortKey)
      if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va
      return sortDir === 'asc'
        ? String(va).localeCompare(String(vb), 'zh-Hant')
        : String(vb).localeCompare(String(va), 'zh-Hant')
    })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir])

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }
  function SortIcon({ k }: { k: string }) {
    if (sortKey !== k) return <span className="text-gray-300 ml-0.5">↕</span>
    return <span className="text-accent-600 ml-0.5">{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  if (!canView) {
    return <div className="p-4 text-center py-12 text-gray-400">您沒有權限查看此頁面</div>
  }

  if (loading) {
    return (
      <div className="p-4 flex justify-center items-center min-h-[50vh]">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <div className="card text-center py-12">
          <p className="text-gray-500 mb-3">找不到此活動</p>
          <Link href="/admin/assessments" className="btn-primary text-sm">返回列表</Link>
        </div>
      </div>
    )
  }

  // 計算「目標受測者」與「未完成名單」（離職員工不列入派發）
  const targetCategories = (event.target_categories || []) as EmployeeCategory[]
  const activeRoster = roster.filter(e => !e.resigned_at)
  const targetEmployees: Employee[] = targetCategories.length > 0
    ? filterByCategories(activeRoster, targetCategories)
    : activeRoster
  const completedNames = new Set(subs.map(s => s.respondent_name.trim()))
  const pendingEmployees = targetEmployees.filter((e: Employee) => !completedNames.has(e.name))
  const completedTargetCount = targetEmployees.length - pendingEmployees.length

  function downloadPendingCsv() {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
    const link = `${baseUrl}/assess/${event!.code}`
    const header = ['姓名', '英文名', '職稱', '分類', '測驗連結', '完成狀態']
    const rows = targetEmployees.map((e: Employee) => [
      e.name,
      e.english,
      e.title,
      getCategoryMeta(e.category)?.label || e.category,
      link,
      completedNames.has(e.name) ? '已完成' : '未完成',
    ])
    // 加 UTF-8 BOM 讓 Excel 中文不亂碼
    const csv = '﻿' + [header, ...rows]
      .map(row => row.map((cell: string) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${event!.name}_目標名單.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const isBigFive = !!event.test_types?.includes('bigfive')

  // Big Five 活動走專屬頁面，與邏輯測驗的詳情頁完全分流
  if (isBigFive) {
    return <BigFiveDetailPage event={event} subs={subs} inProgressSubs={inProgressSubs} setSubs={setSubs} />
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <Link href="/admin/assessments" className="text-sm text-accent-600 hover:text-accent-700 transition-colors">← 返回列表</Link>
      <div className="flex items-start justify-between mt-3 mb-4 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">{event.name}</h1>
            <span className="badge bg-accent-50 text-accent-700 ring-1 ring-accent-200">🧠 邏輯思維</span>
            {event.kind === 'interview' && (
              <span className="badge bg-purple-50 text-purple-700 ring-1 ring-purple-200">🎯 面試人員測驗</span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            code <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[11px]">{event.code}</code> ·
            已完成 <span className="tabular-nums font-semibold text-gray-700">{subs.length}</span> 人
            {event.deadline && <span className="ml-2">· 截止 {formatDateTime(event.deadline)}</span>}
          </p>
        </div>
      </div>

      {/* 目標受測者進度（僅員工測驗活動才顯示） */}
      {event.kind !== 'interview' && targetCategories.length > 0 && (
        <div className="card mb-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-900 mb-1 tracking-tight text-sm">🎯 目標受測者</h3>
              <div className="text-xs text-gray-500 flex flex-wrap gap-1.5 mb-2">
                {targetCategories.map(c => (
                  <span key={c} className="px-2 py-0.5 bg-accent-50 text-accent-700 rounded-full ring-1 ring-accent-200 font-medium">
                    {getCategoryMeta(c)?.label || c}
                  </span>
                ))}
              </div>
              <div className="text-sm text-gray-700">
                應測 <span className="font-bold tabular-nums text-gray-900">{targetEmployees.length}</span> 人 ·
                已完成 <span className="font-bold tabular-nums text-emerald-600">{completedTargetCount}</span> 人 ·
                未完成 <span className="font-bold tabular-nums text-orange-600">{pendingEmployees.length}</span> 人
              </div>
              {/* 進度條 */}
              <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent-400 to-accent-600 transition-all duration-500"
                  style={{ width: `${targetEmployees.length > 0 ? (completedTargetCount / targetEmployees.length) * 100 : 0}%` }}
                />
              </div>
            </div>
            <button
              onClick={downloadPendingCsv}
              className="btn-secondary text-xs shrink-0 flex items-center gap-1.5"
              title="匯出含完成狀態的目標名單，HR 可分發給各部門主管追蹤"
            >
              📥 匯出名單 CSV
            </button>
          </div>
        </div>
      )}

      {/* 作答中名單 */}
      {inProgressSubs.length > 0 && (
        <div className="card mb-4 bg-amber-50/50 border border-amber-200/60">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <h3 className="font-bold text-amber-900 text-sm tracking-tight">作答中</h3>
            <span className="text-xs text-amber-700">{inProgressSubs.length} 人</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {inProgressSubs.map(s => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-full text-xs ring-1 ring-amber-200"
                title={`${s.department}${s.employee_code ? ' · ' + s.employee_code : ''} · 開始於 ${formatDateTime(s.started_at)}`}
              >
                <span className="font-medium text-gray-900">{s.respondent_name}</span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-500">{formatDateTime(s.started_at)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 分類篩選 */}
      {subs.length > 0 && (
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-gray-900 tracking-tight">依分類篩選</h3>
            {catFilter.length > 0 && (
              <button onClick={() => setCatFilter([])} className="text-xs text-accent-600 hover:underline">清除</button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allCategoryKeys.map(key => {
              const count = catCounts[key] || 0
              const selected = catFilter.includes(key)
              const disabled = count === 0
              return (
                <button
                  key={key}
                  disabled={disabled}
                  onClick={() => setCatFilter(prev => selected ? prev.filter(c => c !== key) : [...prev, key])}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs ring-1 transition-all',
                    disabled && 'opacity-40 cursor-not-allowed bg-gray-50 text-gray-400 ring-gray-200',
                    !disabled && selected && 'bg-accent-600 text-white ring-accent-600 shadow-sm',
                    !disabled && !selected && 'bg-white text-gray-700 ring-gray-200 hover:ring-accent-300 hover:text-accent-700',
                  )}
                >
                  {categoriesMeta[key].label}
                  <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
                </button>
              )
            })}
            {(catCounts['unknown'] || 0) > 0 && (
              <button
                onClick={() => setCatFilter(prev => prev.includes('unknown' as EmployeeCategory)
                  ? prev.filter(c => c !== ('unknown' as EmployeeCategory))
                  : [...prev, 'unknown' as EmployeeCategory])}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs ring-1 transition-all',
                  catFilter.includes('unknown' as EmployeeCategory)
                    ? 'bg-gray-700 text-white ring-gray-700'
                    : 'bg-white text-gray-500 ring-gray-200 hover:ring-gray-400',
                )}
                title="姓名不在員工名冊中（外部或打錯字）"
              >
                未分類
                <span className="ml-1.5 tabular-nums opacity-70">{catCounts['unknown']}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 部門篩選 */}
      <div className="card mb-4 flex items-center gap-3 flex-wrap">
        <label className="text-sm text-gray-700">部門：</label>
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="input-field text-sm py-1.5 max-w-xs">
          <option value="">全部（{subs.length}）</option>
          {departments.map(d => (
            <option key={d} value={d}>{d}（{subs.filter(s => s.department === d).length}）</option>
          ))}
        </select>
        <span className="text-sm text-gray-500 ml-auto">顯示 {filtered.length} 筆（共 {subs.length} 筆）</span>
        {filtered.length > 0 && (
          <button
            onClick={downloadGroupReportPdf}
            disabled={downloadingGroupPdf}
            className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
            title="把目前篩選條件下的圖表與名單匯出為 PDF"
          >
            📄 {downloadingGroupPdf ? '生成中…' : '匯出分類報告 PDF'}
          </button>
        )}
      </div>

      {/* 分類報告區（PDF 匯出範圍） */}
      <div ref={groupReportRef}>
        {/* 封面 */}
        {filtered.length > 0 && (
          <div className="card mb-3 bg-gradient-to-br from-accent-50 via-white to-accent-50/40 border border-accent-100">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-xs text-accent-700 font-semibold tracking-wider uppercase mb-1">分類分析報告</p>
                <h2 className="text-xl md:text-2xl font-bold text-gray-900 tracking-tight">{event?.name}</h2>
                <div className="mt-2 text-sm text-gray-600 space-y-0.5">
                  <div>
                    <span className="text-gray-500">分類：</span>
                    {catFilter.length === 0
                      ? <span className="text-gray-900">全部分類</span>
                      : catFilter.map(c => (
                        <span key={c} className="inline-block mr-1.5 px-1.5 py-0.5 bg-white rounded ring-1 ring-accent-200 text-accent-800 text-xs font-medium">
                          {categoriesMeta[c as EmployeeCategory]?.label || c}
                        </span>
                      ))}
                  </div>
                  <div><span className="text-gray-500">部門：</span><span className="text-gray-900">{deptFilter || '全部'}</span></div>
                  <div>
                    <span className="text-gray-500">樣本數：</span>
                    <span className="text-gray-900 font-bold tabular-nums">{filtered.length}</span>
                    <span className="text-gray-500"> / {subs.length} 人</span>
                  </div>
                </div>
              </div>
              <div className="text-xs text-gray-400 text-right shrink-0">
                <div>產生時間</div>
                <div className="tabular-nums">{new Date().toLocaleString('zh-TW')}</div>
              </div>
            </div>
          </div>
        )}

        {/* 統整圖表 */}
        {filtered.length > 0 && <AggregateCharts subs={filtered} />}

        {/* PDF 專用精簡名單（瀏覽器隱藏；分塊渲染避免單卡過長被切到字行中間） */}
        {filtered.length > 0 && (() => {
          const ROWS_PER_CARD = 25
          const chunks: typeof sortedFiltered[] = []
          for (let i = 0; i < sortedFiltered.length; i += ROWS_PER_CARD) {
            chunks.push(sortedFiltered.slice(i, i + ROWS_PER_CARD))
          }
          return chunks.map((chunk, ci) => (
            <div key={ci} className="card mt-3 hidden print:block" data-pdf-only="true">
              <h3 className="font-bold text-gray-900 mb-2 tracking-tight">
                受測者名單
                {chunks.length > 1 && (
                  <span className="text-xs text-gray-400 font-normal ml-2">
                    {ci + 1} / {chunks.length}（{ci * ROWS_PER_CARD + 1}–{ci * ROWS_PER_CARD + chunk.length} 人）
                  </span>
                )}
              </h3>
              <table className="w-full text-xs">
                <thead className="text-left text-gray-500 border-b border-gray-200">
                  <tr>
                    <th className="py-1.5 pr-2">姓名</th>
                    <th className="py-1.5 px-2">部門</th>
                    <th className="py-1.5 px-2">分類</th>
                    <th className="py-1.5 px-2 text-center">總分 %</th>
                    <th className="py-1.5 px-2 text-center">等級</th>
                  </tr>
                </thead>
                <tbody>
                  {chunk.map((s) => {
                    const cat = nameToCategory.get(s.respondent_name.trim())
                    const catLabel = cat && cat !== 'unknown'
                      ? categoriesMeta[cat as EmployeeCategory]?.label || cat
                      : '—'
                    return (
                      <tr key={s.id} className="border-b border-gray-100">
                        <td className="py-1.5 pr-2 font-medium text-gray-900">{s.respondent_name}</td>
                        <td className="py-1.5 px-2 text-gray-700">{s.department}</td>
                        <td className="py-1.5 px-2 text-gray-700">{catLabel}</td>
                        <td className="py-1.5 px-2 text-center tabular-nums font-semibold">{s.logic_scores?.total.pct ?? '—'}</td>
                        <td className="py-1.5 px-2 text-center">{s.logic_scores?.total.level ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))
        })()}

        {/* 列表 */}
        <div className="card p-0 overflow-x-auto" data-pdf-skip="true">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-xs">
            <tr>
              <th className="text-left p-3">
                <button onClick={() => toggleSort('name')} className="hover:text-accent-700 font-semibold">
                  姓名 / 部門<SortIcon k="name" />
                </button>
              </th>
              <th className="text-center p-3">
                <button onClick={() => toggleSort('version')} className="hover:text-accent-700 font-semibold">
                  版本<SortIcon k="version" />
                </button>
              </th>
              <th className="text-center p-3">
                <button onClick={() => toggleSort('total')} className="hover:text-accent-700 font-semibold">
                  總分<SortIcon k="total" />
                </button>
              </th>
              <th className="text-center p-3">
                <button onClick={() => toggleSort('level')} className="hover:text-accent-700 font-semibold">
                  等級<SortIcon k="level" />
                </button>
              </th>
              {CATEGORY_KEYS.map(k => (
                <th key={k} className="text-center p-3" title={JSON_DATA.categories[k].label}>
                  <button onClick={() => toggleSort('cat:' + k)} className="hover:text-accent-700 font-semibold">
                    {JSON_DATA.categories[k].label}<SortIcon k={'cat:' + k} />
                  </button>
                </th>
              ))}
              <th className="text-left p-3">
                <button onClick={() => toggleSort('completed_at')} className="hover:text-accent-700 font-semibold">
                  完成時間<SortIcon k="completed_at" />
                </button>
              </th>
              <th className="text-right p-3"></th>
            </tr>
          </thead>
          <tbody>
            {sortedFiltered.map(s => (
              <tr key={s.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="p-3">
                  <div className="font-medium flex items-center gap-1.5">
                    <span>{s.respondent_name}</span>
                    {s.english_name && (
                      <span className="text-xs text-gray-500 font-normal">({s.english_name})</span>
                    )}
                    <button
                      onClick={() => setEditingInfo({ ...s })}
                      className="p-0.5 rounded text-gray-300 hover:text-accent-600 hover:bg-accent-50 transition"
                      title="修正資料：姓名、英文名、部門、員工編號"
                      aria-label="修正資料"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="text-xs text-gray-400">{s.department}{s.employee_code ? ` · ${s.employee_code}` : ''}</div>
                </td>
                <td className="p-3 text-center text-gray-500">{s.version}</td>
                <td className="p-3 text-center tabular-nums font-bold">
                  {s.logic_scores?.total.score}/{s.logic_scores?.total.max}
                  <div className="text-xs text-gray-400 font-normal">{s.logic_scores?.total.pct}%</div>
                </td>
                <td className="p-3 text-center">
                  {s.logic_scores && (
                    <span className={cn('px-2 py-0.5 rounded text-xs font-medium', levelBadge(s.logic_scores.total.level))}>
                      {s.logic_scores.total.level}
                    </span>
                  )}
                </td>
                {CATEGORY_KEYS.map(k => {
                  const c = s.logic_scores?.categories[k]
                  return (
                    <td key={k} className="p-3 text-center">
                      {c ? (
                        <div className="flex flex-col items-center">
                          <span className="tabular-nums font-medium">{c.score}/{c.max}</span>
                          <span className={cn('text-[10px] mt-0.5', levelBadge(c.level), 'px-1 rounded')}>{c.level}</span>
                        </div>
                      ) : '—'}
                    </td>
                  )
                })}
                <td className="p-3 text-xs text-gray-500">{s.completed_at ? formatDateTime(s.completed_at) : '—'}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  {event.kind === 'interview' && (
                    <div className="flex flex-col items-end gap-0.5 mb-1">
                      <button
                        onClick={() => toggleHired(s)}
                        className={cn(
                          'text-[11px] px-2 py-0.5 rounded-full ring-1 transition',
                          s.hired_at
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100'
                            : 'bg-white text-gray-500 ring-gray-200 hover:ring-emerald-300 hover:text-emerald-600',
                        )}
                        title={s.hired_at ? `已錄取 ${formatDateTime(s.hired_at)}（點擊取消）` : '標記為已錄取'}
                      >
                        {s.hired_at ? '✓ 已錄取' : '○ 標記錄取'}
                      </button>
                      {s.hired_at && !s.hired_employee_id && (
                        <button
                          onClick={() => openAddToRoster(s)}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-accent-50 text-accent-700 ring-1 ring-accent-200 hover:bg-accent-100 transition"
                          title="把此候選人加入員工名冊"
                        >
                          📋 加入名冊
                        </button>
                      )}
                      {s.hired_employee_id && (
                        <span className="text-[10px] text-gray-400" title="已加入員工名冊">📋 已歸檔</span>
                      )}
                    </div>
                  )}
                  {/* 員工活動：未分類的人提供「分類」按鈕（直接加入員工名冊） */}
                  {event.kind !== 'interview' && !nameToCategory.has(s.respondent_name.trim()) && (
                    <div className="mb-1">
                      <button
                        onClick={() => openAddToRoster(s)}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-accent-50 text-accent-700 ring-1 ring-accent-200 hover:bg-accent-100 transition"
                        title="把這個人加入員工名冊並指定分類"
                      >
                        📋 分類
                      </button>
                    </div>
                  )}
                  <div className="whitespace-nowrap">
                    <button onClick={() => setViewing(s)} className="text-primary-600 text-xs hover:underline mr-2">查看 →</button>
                    <button
                      onClick={() => handleDeleteSubmission(s)}
                      className="text-red-500 text-xs hover:underline"
                      title="永久刪除此筆作答紀錄"
                    >
                      刪除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5 + CATEGORY_KEYS.length + 2} className="text-center py-12 text-gray-400">沒有資料</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* 修正資料 modal */}
      {editingInfo && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
          onClick={() => !savingInfo && setEditingInfo(null)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl p-6 max-w-md w-full animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 mb-1 tracking-tight">修正受測者資料</h3>
            <p className="text-xs text-gray-500 mb-4">修正後會即時更新統計與篩選</p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">中文姓名 *</label>
                <input
                  type="text"
                  value={editingInfo.respondent_name}
                  onChange={(e) => setEditingInfo({ ...editingInfo, respondent_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">英文名 / 暱稱</label>
                <input
                  type="text"
                  value={editingInfo.english_name || ''}
                  onChange={(e) => setEditingInfo({ ...editingInfo, english_name: e.target.value })}
                  placeholder="例如：Alice"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">部門</label>
                <select
                  value={editingInfo.department}
                  onChange={(e) => setEditingInfo({ ...editingInfo, department: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none text-sm bg-white"
                >
                  {/* 若舊資料部門不在新清單中（如「電商部」），多顯示一個選項以免下拉看不到 */}
                  {!ASSESSMENT_DEPARTMENTS.includes(editingInfo.department as typeof ASSESSMENT_DEPARTMENTS[number]) && editingInfo.department && (
                    <option value={editingInfo.department}>{editingInfo.department}（舊值）</option>
                  )}
                  {ASSESSMENT_DEPARTMENTS.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">員工編號</label>
                <input
                  type="text"
                  value={editingInfo.employee_code || ''}
                  onChange={(e) => setEditingInfo({ ...editingInfo, employee_code: e.target.value })}
                  placeholder="（可留空）"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setEditingInfo(null)}
                disabled={savingInfo}
                className="btn-secondary text-sm"
              >
                取消
              </button>
              <button
                onClick={saveInfoEdit}
                disabled={savingInfo}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {savingInfo ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 加入員工名冊 modal */}
      {addToRoster && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
          onClick={() => !addingToRoster && setAddToRoster(null)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl p-6 max-w-md w-full animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 tracking-tight">📋 加入員工名冊</h3>
            <p className="text-xs text-gray-500 mb-4 mt-1">
              把錄取的候選人新增到 employees 名冊，未來可在分類篩選 / 統計報告中使用。
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">中文姓名 *</label>
                <input
                  type="text"
                  value={rosterForm.chinese_name}
                  onChange={(e) => setRosterForm(f => ({ ...f, chinese_name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">英文名 / 暱稱</label>
                <input
                  type="text"
                  value={rosterForm.english_name}
                  onChange={(e) => setRosterForm(f => ({ ...f, english_name: e.target.value }))}
                  placeholder="例如：Alice"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">職稱</label>
                <input
                  type="text"
                  value={rosterForm.title}
                  onChange={(e) => setRosterForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="例如：OP助理"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">分類 *</label>
                <select
                  value={rosterForm.category}
                  onChange={(e) => setRosterForm(f => ({ ...f, category: e.target.value as EmployeeCategory }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-none text-sm bg-white"
                >
                  {allCategoryKeys.map(k => (
                    <option key={k} value={k}>{categoriesMeta[k].label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setAddToRoster(null)}
                disabled={addingToRoster}
                className="btn-secondary text-sm"
              >
                取消
              </button>
              <button
                onClick={submitAddToRoster}
                disabled={addingToRoster}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {addingToRoster ? '加入中…' : '✓ 加入名冊'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 單筆檢視 modal */}
      {viewing && viewing.logic_scores && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setViewing(null)}>
          <div className="max-w-3xl w-full my-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end gap-2 mb-2 flex-wrap">
              {editingAnswers ? (
                <>
                  <button
                    onClick={saveEditedAnswers}
                    disabled={savingAnswers}
                    className="btn-primary text-sm disabled:opacity-50"
                  >
                    {savingAnswers ? '儲存中…' : '✓ 儲存並重新計分'}
                  </button>
                  <button
                    onClick={() => setEditingAnswers(null)}
                    disabled={savingAnswers}
                    className="btn-secondary text-sm"
                  >
                    取消編輯
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setEditingAnswers({ ...(viewing.logic_answers || {}) })}
                    className="text-sm px-3 py-2 rounded-xl border border-orange-200 text-orange-600 hover:bg-orange-50 transition-all duration-200 ease-apple flex items-center gap-1.5"
                    title="HR 可修正員工手滑點錯的答案，儲存後自動重新計分"
                  >
                    📝 修正答案
                  </button>
                  <button
                    onClick={downloadReportPdf}
                    disabled={downloadingPdf}
                    className="btn-primary text-sm disabled:opacity-50"
                    title="下載評估報告 PDF（不含逐題解析，保護題庫）"
                  >
                    📄 {downloadingPdf ? '生成中…' : '下載 PDF'}
                  </button>
                  <button onClick={() => setViewing(null)} className="btn-secondary text-sm">✕ 關閉</button>
                </>
              )}
            </div>
            {editingAnswers && (
              <AnswerEditor
                event={event!}
                version={viewing.version}
                originalAnswers={viewing.logic_answers || {}}
                edited={editingAnswers}
                setEdited={setEditingAnswers}
              />
            )}
            {!editingAnswers && (
            <>
            <div ref={reportRef}>
              <LogicTestReport
                scores={viewing.logic_scores}
                benchmark={computeBenchmarkForAdmin(subs, viewing.department)}
                headerTitle={`${viewing.respondent_name} 的評估結果`}
                headerSubtitle={`${viewing.department}${viewing.employee_code ? ` · ${viewing.employee_code}` : ''} · 版本 ${viewing.version} · 完成 ${viewing.completed_at ? formatDateTime(viewing.completed_at) : '—'}`}
              />
            </div>
            {/* HR 專用：逐題解析 */}
            {event && (
              <div className="mt-4">
                <PerQuestionReview
                  eventCode={event.code}
                  version={viewing.version as LogicTestVersion}
                  answers={viewing.logic_answers || {}}
                />
              </div>
            )}
            </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ===================================================
// HR 專用：逐題解析（不引入到 /assess/[code]，避免題庫答案外洩）
// 依 (eventCode, version) 還原使用者當時看到的題目順序 + 選項順序，
// 顯示員工選擇、正解、對錯、解析。
// ===================================================
function PerQuestionReview({
  eventCode,
  version,
  answers,
}: {
  eventCode: string
  version: LogicTestVersion
  answers: LogicAnswers
}) {
  const { shuffledItems, optionPerms } = useMemo(
    () => shuffleForVersion(eventCode, version, JSON_DATA.items),
    [eventCode, version]
  )

  // 統計對錯
  const stats = useMemo(() => {
    let correct = 0
    let wrong = 0
    let unanswered = 0
    for (const s of shuffledItems) {
      const original = JSON_DATA.items.find(it => it.id === s.id)
      if (!original) continue
      const userShuffled = answers[s.id]
      if (userShuffled == null) { unanswered++; continue }
      const userOriginal = optionPerms[s.id].perm[userShuffled]
      if (userOriginal === original.answer) correct++
      else wrong++
    }
    return { correct, wrong, unanswered }
  }, [shuffledItems, optionPerms, answers])

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-lg font-bold text-gray-900">逐題解析</h2>
        <div className="text-xs text-gray-500 flex gap-3">
          <span>✓ 正確 <span className="font-bold text-green-700">{stats.correct}</span></span>
          <span>✗ 錯誤 <span className="font-bold text-red-700">{stats.wrong}</span></span>
          {stats.unanswered > 0 && <span>未答 <span className="font-bold text-gray-700">{stats.unanswered}</span></span>}
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-4">⚠️ 此區僅 HR（admin / director / hr / 財管部同仁）可見，請勿外洩給員工以保護題庫。</p>

      <div className="space-y-3">
        {shuffledItems.map((shuf, idx) => {
          const original = JSON_DATA.items.find(it => it.id === shuf.id)
          if (!original) return null
          const perm = optionPerms[shuf.id]
          const userShuffledIdx = answers[shuf.id]
          const userOriginalIdx = userShuffledIdx != null ? perm.perm[userShuffledIdx] : null
          const correctOriginalIdx = original.answer
          const correctShuffledIdx = perm.perm.indexOf(correctOriginalIdx)
          const isCorrect = userOriginalIdx === correctOriginalIdx
          const isUnanswered = userShuffledIdx == null

          const cardBg = isUnanswered
            ? 'bg-gray-50 border-gray-200'
            : isCorrect
              ? 'bg-green-50 border-green-300'
              : 'bg-red-50 border-red-300'

          return (
            <div key={shuf.id} className={cn('rounded-lg border p-3', cardBg)}>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="text-sm text-gray-500">
                  第 {idx + 1} 題 · {shuf.category} · {shuf.difficulty}
                  <span className="ml-2 text-gray-400">[{shuf.id}]</span>
                </div>
                {isUnanswered
                  ? <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-700">未作答</span>
                  : isCorrect
                    ? <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-600 text-white">✓ 答對</span>
                    : <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-600 text-white">✗ 答錯</span>
                }
              </div>
              <p className="font-medium text-gray-900 mb-3 leading-relaxed whitespace-pre-wrap">{shuf.question}</p>

              <div className="space-y-1.5">
                {shuf.options.map((optText, sIdx) => {
                  const isUserPick = sIdx === userShuffledIdx
                  const isCorrectOpt = sIdx === correctShuffledIdx
                  let cls = 'border-gray-200 bg-white text-gray-700'
                  let mark: React.ReactNode = null
                  if (isCorrectOpt && isUserPick) {
                    cls = 'border-green-500 bg-green-100 text-green-900'
                    mark = <span className="text-green-700 font-bold text-sm">✓ 員工選擇（正解）</span>
                  } else if (isCorrectOpt) {
                    cls = 'border-green-400 bg-green-50 text-green-900'
                    mark = <span className="text-green-700 font-bold text-sm">✓ 正解</span>
                  } else if (isUserPick) {
                    cls = 'border-red-400 bg-red-50 text-red-900'
                    mark = <span className="text-red-600 font-bold text-sm">✗ 員工選擇</span>
                  }
                  return (
                    <div key={sIdx} className={cn('rounded border px-3 py-2 text-sm flex items-center justify-between gap-2', cls)}>
                      <span>
                        <span className="font-bold mr-2">{['A', 'B', 'C', 'D'][sIdx]}.</span>
                        {optText}
                      </span>
                      {mark}
                    </div>
                  )
                })}
              </div>

              {original.explanation && (
                <div className="mt-3 pt-2 border-t border-gray-200/50">
                  <div className="text-xs text-gray-500 mb-1 font-medium">📖 解析</div>
                  <p className="text-sm text-gray-700 leading-relaxed">{original.explanation}</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ===================================================
// 統整圖表：等級分布 / 各類別平均 / 部門比較 / 提交趨勢
// 純前端計算，所有資料來自已 fetch 的 subs。
// ===================================================
const LEVELS_ORDER: LogicTestLevel[] = ['優秀', '良好', '中等', '待加強']
const LEVEL_COLORS: Record<LogicTestLevel, string> = {
  '優秀': '#16a34a',
  '良好': '#2563eb',
  '中等': '#ca8a04',
  '待加強': '#ea580c',
}

function AggregateCharts({ subs }: { subs: AssessmentSubmission[] }) {
  // 1. 等級分布
  const levelDist = useMemo(() => {
    const counts: Record<LogicTestLevel, number> = { '優秀': 0, '良好': 0, '中等': 0, '待加強': 0 }
    for (const s of subs) {
      const lv = s.logic_scores?.total.level
      if (lv && lv in counts) counts[lv as LogicTestLevel]++
    }
    return LEVELS_ORDER.map(l => ({ level: l, count: counts[l], color: LEVEL_COLORS[l] }))
  }, [subs])

  // 2. 各類別平均（百分比）
  const categoryAvgs = useMemo(() => {
    const sums: Record<string, { sum: number; n: number }> = {}
    for (const key of CATEGORY_KEYS) sums[key] = { sum: 0, n: 0 }
    for (const s of subs) {
      const cats = s.logic_scores?.categories
      if (!cats) continue
      for (const [k, v] of Object.entries(cats)) {
        if (sums[k]) {
          const pct = (v.score / v.max) * 100
          sums[k].sum += pct
          sums[k].n++
        }
      }
    }
    return CATEGORY_KEYS.map(k => ({
      key: k,
      label: JSON_DATA.categories[k]?.label || k,
      avgPct: sums[k].n > 0 ? Math.round(sums[k].sum / sums[k].n) : 0,
    }))
  }, [subs])

  // 3. 部門比較
  const deptStats = useMemo(() => {
    const m: Record<string, { sum: number; n: number }> = {}
    for (const s of subs) {
      if (!s.logic_scores) continue
      const d = s.department
      if (!m[d]) m[d] = { sum: 0, n: 0 }
      m[d].sum += s.logic_scores.total.pct
      m[d].n++
    }
    return Object.entries(m)
      .map(([d, v]) => ({ dept: d, count: v.n, avgPct: Math.round(v.sum / v.n) }))
      .sort((a, b) => b.avgPct - a.avgPct)
  }, [subs])

  // 4. 部門 × 能力類別 熱力圖
  const deptCategoryHeatmap = useMemo(() => {
    // 依部門 → 類別 → { sum, n }
    const m: Record<string, Record<string, { sum: number; n: number }>> = {}
    for (const s of subs) {
      if (!s.logic_scores) continue
      const d = s.department
      if (!m[d]) m[d] = {}
      for (const k of CATEGORY_KEYS) {
        const c = s.logic_scores.categories[k]
        if (!c) continue
        const pct = Math.round((c.score / c.max) * 100)
        if (!m[d][k]) m[d][k] = { sum: 0, n: 0 }
        m[d][k].sum += pct
        m[d][k].n += 1
      }
    }
    // 把部門按整體平均排序（與 deptStats 一致），方便閱讀
    const rows = Object.entries(m).map(([dept, cells]) => {
      const cellArr = CATEGORY_KEYS.map(k => ({
        key: k,
        pct: cells[k] ? Math.round(cells[k].sum / cells[k].n) : null,
      }))
      const overallAvg = (() => {
        const valid = cellArr.filter(c => c.pct != null) as { pct: number }[]
        if (valid.length === 0) return -1
        return valid.reduce((a, b) => a + b.pct, 0) / valid.length
      })()
      const n = subs.filter(s => s.department === dept).length
      return { dept, cells: cellArr, overallAvg, n }
    })
    rows.sort((a, b) => b.overallAvg - a.overallAvg)
    return rows
  }, [subs])

  // 熱力圖顏色：分數越高越綠，越低越紅
  function heatColor(pct: number | null): string {
    if (pct == null) return '#f3f4f6' // gray-100
    const hue = Math.max(0, Math.min(120, pct * 1.2)) // 0=紅, 120=綠
    const sat = 70
    const light = 92 - (pct * 0.25) // 高分淺色 → 低分稍深
    return `hsl(${hue}, ${sat}%, ${light}%)`
  }
  function heatTextColor(pct: number | null): string {
    if (pct == null) return '#9ca3af'
    return pct >= 35 ? '#1f2937' : '#7f1d1d' // 低分用深紅字以強調
  }

  const total = subs.length
  const overallAvg = useMemo(() => {
    if (total === 0) return 0
    let sum = 0
    for (const s of subs) sum += s.logic_scores?.total.pct ?? 0
    return Math.round(sum / total)
  }, [subs, total])

  return (
    <div className="space-y-3 mb-4">
      {/* 概覽指標 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="card text-center py-3">
          <div className="text-2xl font-bold tabular-nums">{total}</div>
          <div className="text-xs text-gray-500">總完成人數</div>
        </div>
        <div className="card text-center py-3">
          <div className="text-2xl font-bold tabular-nums text-primary-600">{overallAvg}<span className="text-base">%</span></div>
          <div className="text-xs text-gray-500">整體平均分</div>
        </div>
        <div className="card text-center py-3">
          <div className="text-2xl font-bold tabular-nums text-green-600">{levelDist[0].count + levelDist[1].count}</div>
          <div className="text-xs text-gray-500">優秀 + 良好</div>
        </div>
        <div className="card text-center py-3">
          <div className="text-2xl font-bold tabular-nums text-orange-600">{levelDist[3].count}</div>
          <div className="text-xs text-gray-500">待加強人數</div>
        </div>
      </div>

      {/* 兩欄圖表 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 1. 等級分布 */}
        <div className="card">
          <h3 className="font-bold text-gray-900 mb-2">等級分布</h3>
          <div className="w-full h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={levelDist} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="level" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: unknown) => [`${v} 人`, '人數']} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {levelDist.map((d, i) => <Cell key={i} fill={d.color} />)}
                  <LabelList dataKey="count" position="top" fontSize={11} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 2. 各類別平均 */}
        <div className="card">
          <h3 className="font-bold text-gray-900 mb-2">各類別平均得分（%）</h3>
          <div className="w-full h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryAvgs} layout="vertical" margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: unknown) => [`${v}%`, '平均']} />
                <Bar dataKey="avgPct" fill="#1e3a5f" radius={[0, 6, 6, 0]}>
                  <LabelList dataKey="avgPct" position="right" formatter={(v: unknown) => `${v}%`} fontSize={11} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 3. 部門比較 */}
        <div className="card">
          <h3 className="font-bold text-gray-900 mb-2">
            各部門平均
            <span className="text-xs text-gray-400 font-normal ml-2">（依平均分排序）</span>
          </h3>
          <div className="w-full" style={{ height: Math.max(180, deptStats.length * 36 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deptStats} layout="vertical" margin={{ top: 5, right: 60, left: 0, bottom: 5 }}>
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="dept" width={70} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v, name) => name === 'avgPct' ? [`${v}%`, '平均'] : [v ?? '', name ?? '']} />
                <Bar dataKey="avgPct" fill="#2563eb" radius={[0, 6, 6, 0]}>
                  <LabelList
                    dataKey="avgPct"
                    position="right"
                    formatter={(v: unknown) => `${v}%`}
                    fontSize={11}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-2 text-xs text-gray-500">
            {deptStats.map(d => (
              <div key={d.dept}>{d.dept}：{d.count} 人</div>
            ))}
          </div>
        </div>

        {/* 4. 部門 × 能力 熱力圖 */}
        <div className="card">
          <h3 className="font-bold text-gray-900 mb-1">
            部門 × 能力熱力圖
            <span className="text-xs text-gray-400 font-normal ml-2">（數字 = 該部門平均得分 %）</span>
          </h3>
          <p className="text-xs text-gray-500 mb-3">看哪個部門在哪個能力強弱，方便調整培訓重點或安排職務輪調</p>
          {deptCategoryHeatmap.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">尚無資料</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr>
                    <th className="text-left p-1.5 font-semibold text-gray-600 sticky left-0 bg-white">部門</th>
                    {CATEGORY_KEYS.map(k => (
                      <th key={k} className="p-1.5 font-semibold text-gray-600 text-center" title={JSON_DATA.categories[k].label}>
                        {JSON_DATA.categories[k].label}
                      </th>
                    ))}
                    <th className="p-1.5 font-semibold text-gray-500 text-center">人數</th>
                  </tr>
                </thead>
                <tbody>
                  {deptCategoryHeatmap.map(row => (
                    <tr key={row.dept}>
                      <td className="p-1.5 font-medium text-gray-800 whitespace-nowrap sticky left-0 bg-white">{row.dept}</td>
                      {row.cells.map(c => (
                        <td
                          key={c.key}
                          className="p-1 text-center tabular-nums font-semibold"
                          style={{ backgroundColor: heatColor(c.pct), color: heatTextColor(c.pct) }}
                          title={`${row.dept} · ${JSON_DATA.categories[c.key].label}：${c.pct ?? '—'}%`}
                        >
                          {c.pct != null ? `${c.pct}` : '—'}
                        </td>
                      ))}
                      <td className="p-1.5 text-center text-gray-500 tabular-nums">{row.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center gap-2 mt-3 text-[10px] text-gray-500">
                <span>低</span>
                <div className="flex-1 h-2 rounded-full" style={{ background: 'linear-gradient(90deg, hsl(0,70%,75%), hsl(60,70%,85%), hsl(120,70%,80%))' }} />
                <span>高</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// HR 修正答案編輯器 — 列出所有題目，標註原本答案 + 可改的選項
function AnswerEditor({
  event, version, originalAnswers, edited, setEdited,
}: {
  event: AssessmentEvent
  version: LogicTestVersion
  originalAnswers: LogicAnswers
  edited: LogicAnswers
  setEdited: (next: LogicAnswers) => void
}) {
  const { shuffledItems } = useMemo(
    () => shuffleForVersion(event.code, version, JSON_DATA.items),
    [event.code, version],
  )

  const changedCount = useMemo(() => {
    let n = 0
    for (const id of Object.keys(edited)) {
      if (edited[id] !== originalAnswers[id]) n++
    }
    return n
  }, [edited, originalAnswers])

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-bold text-gray-900 tracking-tight">📝 修正答案</h3>
          <p className="text-xs text-gray-500 mt-0.5">點選任一選項即可修改。儲存後系統會自動重新計分。</p>
        </div>
        {changedCount > 0 && (
          <span className="badge bg-orange-50 text-orange-700 ring-1 ring-orange-200 text-xs">
            已修改 {changedCount} 題
          </span>
        )}
      </div>
      <div className="space-y-3">
        {shuffledItems.map((item, idx) => {
          const userPick = edited[item.id]
          const origPick = originalAnswers[item.id]
          const cat = JSON_DATA.categories[item.category]?.label || item.category
          return (
            <div key={item.id} className="rounded-xl border border-gray-200 p-3">
              <div className="text-xs text-gray-500 mb-1 flex items-center justify-between">
                <span>{idx + 1}. <span className="text-gray-400">[{cat}]</span></span>
                {userPick !== origPick && (
                  <span className="text-orange-600 font-medium">已修改</span>
                )}
              </div>
              <p className="text-sm text-gray-900 whitespace-pre-wrap mb-2">{item.question}</p>
              <div className="space-y-1">
                {item.options.map((opt, optIdx) => {
                  const selected = userPick === optIdx
                  const wasOriginal = origPick === optIdx
                  return (
                    <button
                      key={optIdx}
                      type="button"
                      onClick={() => setEdited({ ...edited, [item.id]: optIdx })}
                      className={cn(
                        'w-full text-left px-3 py-2 rounded-lg text-sm border transition-all',
                        selected
                          ? 'bg-accent-600 text-white border-accent-600'
                          : 'bg-white text-gray-700 border-gray-200 hover:border-accent-300 hover:bg-accent-50/40',
                      )}
                    >
                      <span className="inline-block w-5 font-bold tabular-nums">{String.fromCharCode(65 + optIdx)}.</span>
                      <span>{opt}</span>
                      {wasOriginal && !selected && (
                        <span className="ml-2 text-[11px] text-gray-400">（原本選的）</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// =============================================
// Big Five 活動詳情頁：簡潔的列表 + 個別查看 + AI 分析
// 不沿用邏輯測驗的複雜 UI（雷達/長條/熱力圖）；MVP 階段先以表格為主
// =============================================
function BigFiveDetailPage({
  event, subs, inProgressSubs, setSubs,
}: {
  event: AssessmentEvent
  subs: AssessmentSubmission[]
  inProgressSubs: AssessmentSubmission[]
  setSubs: React.Dispatch<React.SetStateAction<AssessmentSubmission[]>>
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [viewing, setViewing] = useState<AssessmentSubmission | null>(null)
  const [aiProfile, setAiProfile] = useState<string | null>(null)
  const [aiProfileAt, setAiProfileAt] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const personReportRef = useRef<HTMLDivElement | null>(null)
  // HR 修正 Big Five 答案
  const [editingBigfive, setEditingBigfive] = useState<BigFiveAnswers | null>(null)
  const [savingBigfive, setSavingBigfive] = useState(false)
  // 2-call 分段進度
  const [genStage, setGenStage] = useState<'idle' | 'part1' | 'part2'>('idle')
  // AI 分析視角
  const [viewpoint, setViewpoint] = useState<'manager' | 'staff'>('manager')

  async function handleDeleteSubmission(s: AssessmentSubmission) {
    const ok = await confirm({
      title: '刪除作答紀錄',
      message: `確定刪除「${s.respondent_name}${s.english_name ? ' (' + s.english_name + ')' : ''}」這筆作答紀錄？\n\n刪除後此人的 Big Five 分數、答案、AI 分析全部會永久消失，無法復原。`,
      danger: true,
      confirmLabel: '刪除',
    })
    if (!ok) return
    try {
      const res = await fetch('/api/admin/assessments/submission/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error('刪除失敗：' + (data.error || res.status)); return }
      setSubs(prev => prev.filter(x => x.id !== s.id))
      if (viewing?.id === s.id) setViewing(null)
    } catch (e) {
      toast.error('刪除失敗：' + (e instanceof Error ? e.message : '未知錯誤'))
    }
  }

  async function saveBigfiveAnswers() {
    if (!viewing || !editingBigfive) return
    setSavingBigfive(true)
    try {
      const res = await fetch('/api/admin/assessments/bigfive/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: viewing.id, bigfive_answers: editingBigfive }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error('儲存失敗：' + (data.error || res.status)); return }
      const updated: AssessmentSubmission = {
        ...viewing,
        bigfive_answers: editingBigfive,
        bigfive_scores: data.bigfive_scores,
      }
      setViewing(updated)
      setEditingBigfive(null)
      toast.success('已儲存並重新計分')
    } catch (e) {
      toast.error('儲存失敗：' + (e instanceof Error ? e.message : '未知錯誤'))
    } finally {
      setSavingBigfive(false)
    }
  }

  function downloadCsv() {
    const header = ['姓名', '英文名', '部門', '員工編號', ...BIGFIVE_DIM_KEYS.flatMap(k => [BIGFIVE_DATA.dimensions[k].label + '(%)', BIGFIVE_DATA.dimensions[k].label + '等級']), '完成時間']
    const rows = subs.map(s => {
      const d = s.bigfive_scores?.dimensions
      const dimCols = BIGFIVE_DIM_KEYS.flatMap(k => [d?.[k]?.pct ?? '', d?.[k]?.level ?? ''])
      return [s.respondent_name, s.english_name || '', s.department, s.employee_code || '', ...dimCols, s.completed_at || '']
    })
    const csv = '﻿' + [header, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `BigFive_${event.name.replace(/[\\/:*?"<>|]/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function downloadPersonalPdf() {
    if (!viewing || !personReportRef.current) return
    setDownloadingPdf(true)
    const root = personReportRef.current
    // 個人報告本身就是 portrait 排版，把根容器鎖在 modal 原本寬度（max-w-2xl ≈ 672px）
    // 不再強制改 1024px，避免雷達圖被拉成很扁的寬高比
    const restore = { width: root.style.width, maxWidth: root.style.maxWidth, minWidth: root.style.minWidth }
    const targetWidth = 672  // 與 modal max-w-2xl 對齊
    root.style.width = targetWidth + 'px'
    root.style.maxWidth = targetWidth + 'px'
    root.style.minWidth = targetWidth + 'px'

    // 等兩個 frame + 500ms 讓 ResponsiveContainer 重排
    await new Promise(r => requestAnimationFrame(() => r(null)))
    await new Promise(r => requestAnimationFrame(() => r(null)))
    await new Promise(r => setTimeout(r, 600))

    // 觸發 resize event 讓 recharts 內部 ResizeObserver 重算
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'))
    await new Promise(r => setTimeout(r, 200))

    // 把所有 recharts ResponsiveContainer + 內部的 wrapper 與 SVG 都寫死成當前尺寸
    const responsiveContainers = Array.from(root.querySelectorAll<HTMLElement>('.recharts-responsive-container'))
    const restoreContainers = responsiveContainers.map(el => ({ el, width: el.style.width, height: el.style.height }))
    const restoreSvgs: Array<{ el: SVGSVGElement; width: string | null; height: string | null }> = []
    for (const el of responsiveContainers) {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        el.style.width = rect.width + 'px'
        el.style.height = rect.height + 'px'
      }
      // 內部 SVG 也明確寫死寬高
      const svg = el.querySelector('svg') as SVGSVGElement | null
      if (svg) {
        restoreSvgs.push({ el: svg, width: svg.getAttribute('width'), height: svg.getAttribute('height') })
        const svgRect = svg.getBoundingClientRect()
        if (svgRect.width > 0) svg.setAttribute('width', String(Math.round(svgRect.width)))
        if (svgRect.height > 0) svg.setAttribute('height', String(Math.round(svgRect.height)))
      }
    }
    await new Promise(r => setTimeout(r, 200))

    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])
      const allCards = Array.from(root.querySelectorAll<HTMLElement>('.card'))
      if (allCards.length === 0) throw new Error('找不到報告內容')
      // 第一張卡（姓名標頭 + 雷達圖）會放到封面頁，不參與一般卡片流
      const headerCard = allCards[0]
      const cards = allCards.slice(1)
      const headerCardCanvas = await html2canvas(headerCard, {
        scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
        width: headerCard.offsetWidth,
        height: headerCard.offsetHeight,
      })
      const canvases = await Promise.all(cards.map(c => html2canvas(c, {
        scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
        width: c.offsetWidth,
        height: c.offsetHeight,
      })))
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight()
      const margin = 10, usableW = pageW - margin * 2, usableH = pageH - margin * 2
      let curY = margin
      let pageHasContent = false  // 當前頁是否已經畫過內容（用來決定是否要先 addPage）

      // 改良版 safeCut：找「行間距」最寬的位置切，避免切到中文字
      // 老演算法找「darkness 最小」的單列 → 字密集區還是可能切到
      // 新演算法找「連續低暗度區段」（=行與行之間的空隙），切在區段中央最安全
      const safeCut = (canvas: HTMLCanvasElement, targetY: number): number => {
        const srcCtx = canvas.getContext('2d')
        if (!srcCtx || targetY >= canvas.height) return targetY
        const upBound = Math.max(targetY - 600, 0)
        const sampleStep = 4
        const threshold = 3  // darkness 低於此值視為「空白列」
        const darknessOf = (y: number): number => {
          const data = srcCtx.getImageData(0, y, canvas.width, 1).data
          let d = 0
          for (let x = 0; x < canvas.width; x += sampleStep) {
            const i = x * 4
            const luma = (data[i] + data[i + 1] + data[i + 2]) / 3
            if (luma < 230) d++
          }
          return d
        }
        // 從 targetY 往上找連續低暗度區段（行間隙）
        let y = targetY
        while (y > upBound) {
          // 找到一個低暗度列
          if (darknessOf(y) <= threshold) {
            // 確認區段範圍
            let top = y, bottom = y
            while (top > upBound && darknessOf(top - 1) <= threshold) top--
            while (bottom < targetY && darknessOf(bottom + 1) <= threshold) bottom++
            // 區段中央就是最安全的切點
            return Math.floor((top + bottom) / 2)
          }
          y -= 2
        }
        // 都找不到空白區段 → fallback 到 darkness 最小的列
        let bestY = targetY, bestD = Infinity
        for (let yy = targetY; yy > upBound; yy -= 2) {
          const d = darknessOf(yy)
          if (d < bestD) { bestD = d; bestY = yy }
        }
        return bestY
      }

      for (const c of canvases) {
        const cardH = (c.height * usableW) / c.width

        // 卡片本身就比一整頁還高 → 切片避開字行
        if (cardH > usableH) {
          if (pageHasContent) pdf.addPage()
          const pxPerMm = c.width / usableW
          const sliceMaxPx = Math.floor(usableH * 0.92 * pxPerMm)
          let yOffset = 0
          let isFirstSlice = true
          let lastSliceMm = 0
          while (yOffset < c.height) {
            if (!isFirstSlice) pdf.addPage()
            const rawEnd = Math.min(yOffset + sliceMaxPx, c.height)
            const safeEnd = rawEnd < c.height ? safeCut(c, rawEnd) : rawEnd
            const sliceH = safeEnd - yOffset
            const sliceCanvas = document.createElement('canvas')
            sliceCanvas.width = c.width
            sliceCanvas.height = sliceH
            const ctx = sliceCanvas.getContext('2d')
            if (!ctx) throw new Error('無法建立 canvas context')
            ctx.drawImage(c, 0, -yOffset)
            pdf.addImage(sliceCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, usableW, sliceH / pxPerMm)
            yOffset = safeEnd
            lastSliceMm = sliceH / pxPerMm
            isFirstSlice = false
          }
          curY = margin + lastSliceMm + 4
          pageHasContent = true
          continue
        }

        // 一般情況：當前頁裝不下 → 換新頁
        if (pageHasContent && curY + cardH > pageH - margin) {
          pdf.addPage()
          curY = margin
          pageHasContent = false
        }
        pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', margin, curY, usableW, cardH)
        curY += cardH + 4
        pageHasContent = true
      }

      // === 加封面頁（插到最前面）+ 把第一張卡（姓名+雷達）放在封面內 ===
      await addCoverAndChrome(pdf, html2canvas, viewing, headerCardCanvas)

      const safeName = viewing.respondent_name.replace(/[\\/:*?"<>|]/g, '_')
      pdf.save(`BigFive_${safeName}_${(viewing.completed_at || '').slice(0, 10)}.pdf`)
    } catch (e) {
      toast.error('PDF 下載失敗：' + (e instanceof Error ? e.message : '未知錯誤'))
    } finally {
      root.style.width = restore.width
      root.style.maxWidth = restore.maxWidth
      root.style.minWidth = restore.minWidth
      // 還原 ResponsiveContainer 與 SVG 尺寸
      for (const r of restoreContainers) {
        r.el.style.width = r.width
        r.el.style.height = r.height
      }
      for (const r of restoreSvgs) {
        if (r.width != null) r.el.setAttribute('width', r.width); else r.el.removeAttribute('width')
        if (r.height != null) r.el.setAttribute('height', r.height); else r.el.removeAttribute('height')
      }
      setDownloadingPdf(false)
    }
  }

  // 依 viewpoint 切換顯示對應視角的快取報告（不互相覆蓋）
  useEffect(() => {
    if (!viewing) { setAiProfile(null); setAiProfileAt(null); setProfileError(null); return }
    const profileForView = viewpoint === 'staff'
      ? (viewing.bigfive_ai_profile_staff ?? null)
      : (viewing.bigfive_ai_profile_manager ?? viewing.bigfive_ai_profile ?? null)  // 舊資料 fallback
    const atForView = viewpoint === 'staff'
      ? (viewing.bigfive_ai_profile_staff_at ?? null)
      : (viewing.bigfive_ai_profile_manager_at ?? viewing.bigfive_ai_profile_generated_at ?? null)
    setAiProfile(profileForView)
    setAiProfileAt(atForView)
    setProfileError(null)
  }, [viewing, viewpoint])

  async function generateProfile(regenerate: boolean) {
    if (!viewing) return
    setGenerating(true)
    setProfileError(null)
    setAiProfile(null)
    setAiProfileAt(null)

    // 2-call 分段生成：part 1 為一~三段、part 2 為四~六段
    // 每段都各自 stream，每次 fetch 都有完整 60s Vercel timeout
    async function fetchPart(part: 1 | 2, previousText?: string): Promise<{ text: string; cachedAt: string | null; aborted: boolean }> {
      const res = await fetch('/api/admin/assessments/bigfive/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submission_id: viewing!.id, regenerate, part, previous_text: previousText, viewpoint }),
      })

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '')
        let errMsg = `第 ${part} 段生成失敗 (${res.status})`
        try {
          const j = errText ? JSON.parse(errText) : null
          if (j?.error) errMsg = j.error
        } catch {
          if (errText) errMsg += ' — ' + errText.slice(0, 120).replace(/<[^>]+>/g, ' ').trim()
        }
        throw new Error(errMsg)
      }

      const cachedAt = res.headers.get('X-Generated-At')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let text = ''
      // 串流：邊讀邊更新 UI（part 1 顯示自己；part 2 顯示前段 + 自己）
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        const combined = part === 2 && previousText ? previousText + '\n\n' + text : text
        setAiProfile(combined)
      }
      text += decoder.decode()  // flush

      // 檢查錯誤標記
      const errIdx = text.indexOf('\n\n[ERROR] ')
      let aborted = false
      if (errIdx >= 0) {
        const errPart = text.slice(errIdx + 10).trim()
        setProfileError(errPart)
        text = text.slice(0, errIdx).trim()
        aborted = true
      }
      return { text, cachedAt, aborted }
    }

    try {
      // === Part 1 ===
      setGenStage('part1')
      console.log('[bigfive] Starting Part 1...')
      const p1 = await fetchPart(1)
      console.log('[bigfive] Part 1 done. cached=', !!p1.cachedAt, 'aborted=', p1.aborted, 'text length=', p1.text.length)
      if (p1.cachedAt) {
        setAiProfile(p1.text.trim())
        setAiProfileAt(p1.cachedAt)
        return
      }
      if (p1.aborted) {
        setAiProfile(p1.text || null)
        return
      }
      if (!p1.text || p1.text.length < 100) {
        setProfileError(`Part 1 內容異常短（${p1.text.length} 字），中止 Part 2。請重試。`)
        return
      }

      // === Part 2 ===
      setGenStage('part2')
      console.log('[bigfive] Starting Part 2 with previous text length=', p1.text.length)
      const p2 = await fetchPart(2, p1.text)
      console.log('[bigfive] Part 2 done. aborted=', p2.aborted, 'text length=', p2.text.length)
      const combined = (p1.text + '\n\n' + p2.text).trim()
      const generatedAt = new Date().toISOString()
      setAiProfile(combined)
      setAiProfileAt(generatedAt)
      // 同步更新 viewing + subs，依視角寫到對應欄位（兩個視角獨立保留）
      const update = viewpoint === 'staff'
        ? { bigfive_ai_profile_staff: combined, bigfive_ai_profile_staff_at: generatedAt }
        : { bigfive_ai_profile_manager: combined, bigfive_ai_profile_manager_at: generatedAt }
      setViewing(v => v && v.id === viewing.id ? { ...v, ...update } : v)
      setSubs(prev => prev.map(s => s.id === viewing.id ? { ...s, ...update } : s))
    } catch (e) {
      console.error('[bigfive] Generation error at stage', genStage, ':', e)
      const stageHint = genStage === 'part1' ? '（Part 1 生成階段）' : genStage === 'part2' ? '（Part 2 生成階段）' : ''
      setProfileError((e instanceof Error ? `${e.name}: ${e.message}` : '生成失敗') + stageHint)
    } finally {
      setGenStage('idle')
      setGenerating(false)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <Link href="/admin/assessments" className="text-sm text-accent-600 hover:text-accent-700 transition-colors">← 返回列表</Link>
      <div className="flex items-start justify-between mt-3 mb-4 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">{event.name}</h1>
            <span className="badge bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200">🌈 Big Five 人格</span>
            {event.kind === 'interview' && (
              <span className="badge bg-purple-50 text-purple-700 ring-1 ring-purple-200">🎯 面試人員測驗</span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            code <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[11px]">{event.code}</code> ·
            已完成 <span className="tabular-nums font-semibold text-gray-700">{subs.length}</span> 人
            {inProgressSubs.length > 0 && <span className="ml-2 text-amber-600">· 作答中 {inProgressSubs.length}</span>}
            {event.deadline && <span className="ml-2">· 截止 {formatDateTime(event.deadline)}</span>}
          </p>
        </div>
        {subs.length > 0 && (
          <button onClick={downloadCsv} className="btn-secondary text-xs flex items-center gap-1.5 shrink-0">
            📥 匯出 CSV
          </button>
        )}
      </div>

      {inProgressSubs.length > 0 && (
        <div className="card mb-4 bg-amber-50/50 border border-amber-200/60">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <h3 className="font-bold text-amber-900 text-sm tracking-tight">作答中</h3>
            <span className="text-xs text-amber-700">{inProgressSubs.length} 人</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {inProgressSubs.map(s => (
              <span key={s.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-full text-xs ring-1 ring-amber-200">
                <span className="font-medium text-gray-900">{s.respondent_name}</span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-500">{formatDateTime(s.started_at)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 群組統整分析（≥ 2 人才顯示） */}
      {subs.length >= 2 && <BigFiveAggregateCharts subs={subs} />}

      {/* AI 群組分析按鈕（≥ 2 人才顯示） */}
      {subs.length >= 2 && (
        <BigFiveAdvancedAnalysis event={event} subs={subs} />
      )}

      {/* 受測者列表 */}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs">
            <tr>
              <th className="text-left p-3">姓名 / 部門</th>
              {BIGFIVE_DIM_KEYS.map(k => (
                <th key={k} className="text-center p-3" title={BIGFIVE_DATA.dimensions[k].short_desc}>
                  {BIGFIVE_DATA.dimensions[k].label}
                </th>
              ))}
              <th className="text-left p-3">完成時間</th>
              <th className="text-right p-3"></th>
            </tr>
          </thead>
          <tbody>
            {subs.map(s => {
              const scores = s.bigfive_scores as BigFiveScores | null | undefined
              return (
                <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="p-3">
                    <div className="font-medium">
                      {s.respondent_name}
                      {s.english_name && <span className="text-xs text-gray-500 font-normal ml-1.5">({s.english_name})</span>}
                    </div>
                    <div className="text-xs text-gray-400">{s.department}{s.employee_code ? ` · ${s.employee_code}` : ''}</div>
                  </td>
                  {BIGFIVE_DIM_KEYS.map(k => {
                    const d = scores?.dimensions[k]
                    return (
                      <td key={k} className="p-3 text-center">
                        {d ? (
                          <div>
                            <div className="tabular-nums font-medium text-gray-900">{d.pct}%</div>
                            <div className="text-[10px] text-gray-500">{d.level}</div>
                          </div>
                        ) : '—'}
                      </td>
                    )
                  })}
                  <td className="p-3 text-xs text-gray-500">{s.completed_at ? formatDateTime(s.completed_at) : '—'}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <button onClick={() => setViewing(s)} className="text-primary-600 text-xs hover:underline mr-2">查看 →</button>
                    <button
                      onClick={() => handleDeleteSubmission(s)}
                      className="text-red-500 text-xs hover:underline"
                      title="永久刪除此筆作答紀錄"
                    >
                      刪除
                    </button>
                  </td>
                </tr>
              )
            })}
            {subs.length === 0 && (
              <tr><td colSpan={BIGFIVE_DIM_KEYS.length + 3} className="text-center py-12 text-gray-400">尚無已完成的作答</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 個別查看 modal */}
      {viewing && viewing.bigfive_scores && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto animate-fade-in" onClick={() => setViewing(null)}>
          <div className="max-w-2xl w-full my-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end gap-2 mb-2 flex-wrap">
              {editingBigfive ? (
                <>
                  <button onClick={saveBigfiveAnswers} disabled={savingBigfive} className="btn-primary text-sm disabled:opacity-50">
                    {savingBigfive ? '儲存中…' : '✓ 儲存並重新計分'}
                  </button>
                  <button onClick={() => setEditingBigfive(null)} disabled={savingBigfive} className="btn-secondary text-sm">取消編輯</button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setEditingBigfive({ ...(viewing.bigfive_answers || {}) })}
                    className="text-sm px-3 py-2 rounded-xl border border-orange-200 text-orange-600 hover:bg-orange-50 transition flex items-center gap-1.5"
                    title="HR 可修正員工手滑點錯的答案，儲存後自動重新計分"
                  >
                    📝 修正答案
                  </button>
                  <button onClick={downloadPersonalPdf} disabled={downloadingPdf} className="btn-primary text-sm bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-50">
                    📄 {downloadingPdf ? '生成中…' : '下載 PDF'}
                  </button>
                  <button onClick={() => setViewing(null)} className="btn-secondary text-sm">✕ 關閉</button>
                </>
              )}
            </div>

            {editingBigfive && (
              <BigFiveAnswerEditor
                originalAnswers={viewing.bigfive_answers || {}}
                edited={editingBigfive}
                setEdited={setEditingBigfive}
              />
            )}

            {!editingBigfive && (
            <div ref={personReportRef}>
            {/* Card 1: 受測者標頭 + 雷達圖（讓 PDF 一頁裝得下） */}
            <div className="card">
              <div className="mb-3">
                <h2 className="text-xl font-bold text-gray-900 tracking-tight">
                  {viewing.respondent_name}
                  {viewing.english_name && <span className="text-base text-gray-500 font-normal ml-2">({viewing.english_name})</span>}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {viewing.department}{viewing.employee_code ? ' · ' + viewing.employee_code : ''}
                  {viewing.completed_at && <span className="ml-2">· 完成 {formatDateTime(viewing.completed_at)}</span>}
                </p>
              </div>
              <BigFiveRadar scores={viewing.bigfive_scores as BigFiveScores} benchmark={computeBigFiveGroupAvg(subs)} height={280} />
              <p className="text-[11px] text-gray-400 mt-1">紫色 = 個人；灰色虛線 = 本活動群組平均</p>
            </div>

            {/* Card 2: 衍生分析（原型 + 壓力 + 決策 + 風險 + 學習） */}
            <div className="card mt-3">
              <h3 className="font-bold text-base text-gray-900 mb-3 pb-2 border-b border-gray-200">深度洞察</h3>
              <BigFiveDerivedPanel scores={viewing.bigfive_scores as BigFiveScores} />
            </div>

            {/* Card 3: 職位 Fit Score */}
            <div className="card mt-3">
              <JobProfileFitPanel submissionId={viewing.id} />
            </div>

            {/* Card 4: 作答品質（只在有提示時顯示） */}
            {viewing.bigfive_answers && (() => {
              const durMs = viewing.started_at && viewing.completed_at
                ? new Date(viewing.completed_at).getTime() - new Date(viewing.started_at).getTime()
                : undefined
              const q = detectBigFiveQuality(BIGFIVE_DATA, viewing.bigfive_answers, durMs)
              if (!q.hasQualityConcerns) return (
                <div className="card mt-3 bg-emerald-50/50 border border-emerald-200">
                  <p className="text-xs text-emerald-800">✓ 作答品質指標正常（反向題一致性 {q.reverseConsistency}%，連續同分最長 {q.longestRun} 題）</p>
                </div>
              )
              return (
                <div className="card mt-3 bg-amber-50/50 border border-amber-200">
                  <h4 className="font-semibold text-xs text-amber-800 mb-1">⚠️ 作答品質提示</h4>
                  <ul className="list-disc list-inside text-xs text-amber-800 space-y-0.5">
                    {q.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                  <p className="text-[10px] text-amber-700 mt-2 leading-relaxed">
                    上述情形可能影響分數解讀。HR 可考慮確認受測者後重新作答，或仍以此份報告為參考。
                  </p>
                </div>
              )
            })()}

            {/* Card 5: 五大維度詳細描述 */}
            <div className="card mt-3">
              <h3 className="font-bold text-base text-gray-900 mb-3 pb-2 border-b border-gray-200">五大維度詳述</h3>
              <div className="space-y-3">
                {BIGFIVE_DIM_KEYS.map(k => {
                  const d = (viewing.bigfive_scores as BigFiveScores).dimensions[k]
                  const meta = BIGFIVE_DATA.dimensions[k]
                  return (
                    <div key={k} className="rounded-xl p-3 bg-gray-50">
                      <div className="flex items-baseline justify-between mb-1 flex-wrap gap-1">
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

            {/* AI 性格分析 */}
            <div className="card mt-3">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <h3 className="font-bold text-gray-900">
                  🧠 AI 人格適性分析
                  {aiProfileAt && (
                    <span className="text-xs text-gray-400 font-normal ml-2">
                      {viewpoint === 'staff' ? '基層員工視角' : '管理職視角'}
                      ・生成於 {formatDateTime(aiProfileAt)}
                    </span>
                  )}
                </h3>
                {aiProfile && (
                  <button onClick={() => generateProfile(true)} disabled={generating} className="text-xs text-orange-600 hover:text-orange-800 disabled:opacity-50">
                    {generating ? '生成中…' : '↻ 重新生成'}
                  </button>
                )}
              </div>

              {/* 分析視角切換 */}
              <div className="flex items-center gap-1.5 mb-3 p-1 bg-gray-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setViewpoint('manager')}
                  className={cn(
                    'flex-1 px-3 py-1.5 rounded-lg text-xs transition',
                    viewpoint === 'manager' ? 'bg-white shadow-sm font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-700',
                  )}
                >
                  👔 管理職視角
                  <div className="text-[10px] font-normal opacity-70 mt-0.5">領導、帶人、決策</div>
                </button>
                <button
                  type="button"
                  onClick={() => setViewpoint('staff')}
                  className={cn(
                    'flex-1 px-3 py-1.5 rounded-lg text-xs transition',
                    viewpoint === 'staff' ? 'bg-white shadow-sm font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-700',
                  )}
                >
                  🧑‍💼 基層員工視角
                  <div className="text-[10px] font-normal opacity-70 mt-0.5">做事、協作、自我成長</div>
                </button>
              </div>
              {/* 兩種視角獨立儲存，切換時自動載入對應內容；不需要視角不符提示 */}
              {(() => {
                const otherView = viewpoint === 'staff' ? 'manager' : 'staff'
                const otherHas = otherView === 'staff'
                  ? !!viewing.bigfive_ai_profile_staff
                  : !!(viewing.bigfive_ai_profile_manager || viewing.bigfive_ai_profile)
                if (!otherHas) return null
                return (
                  <div className="mb-2 px-3 py-1.5 bg-emerald-50 text-emerald-800 rounded-lg text-xs">
                    ✓ 另一視角（{otherView === 'staff' ? '基層員工' : '管理職'}）也已生成過，切換上方分頁即可查看
                  </div>
                )
              })()}

              {!aiProfile && !generating && (
                <div className="text-center py-6">
                  <button onClick={() => generateProfile(false)} className="btn-primary text-sm bg-fuchsia-600 hover:bg-fuchsia-700">
                    🧠 生成性格分析（{viewpoint === 'staff' ? '基層員工視角' : '管理職視角'}）
                  </button>
                  <p className="text-xs text-gray-500 mt-2">由 Claude AI 依五大人格分數生成約 1400-1700 字的專業人格適性報告，六大段分析</p>
                </div>
              )}
              {generating && (
                <div className="text-center py-6 text-sm text-gray-500">
                  <div className="w-6 h-6 border-4 border-fuchsia-600 border-t-transparent rounded-full animate-spin inline-block mr-2 align-middle" />
                  Claude 正在分析中{genStage === 'part1' ? '（前半段 1/2）' : genStage === 'part2' ? '（後半段 2/2）' : ''}…
                  <div className="text-[10px] mt-1 text-gray-400">Claude Opus 4.7 + adaptive thinking · 分兩段生成，每段約 25-40 秒</div>
                </div>
              )}
              {profileError && <p className="text-red-500 text-sm mt-2">⚠️ {profileError}</p>}
            </div>
            {/* AI 報告：每個 # 段落獨立成一張 .card，讓 PDF 自然分頁不被切 */}
            {aiProfile && renderBigFiveProfileAsCards(aiProfile)}
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Big Five 答案編輯器 — 列出 44 題現有作答，HR 可修改後重新計分
function BigFiveAnswerEditor({
  originalAnswers, edited, setEdited,
}: {
  originalAnswers: BigFiveAnswers
  edited: BigFiveAnswers
  setEdited: (next: BigFiveAnswers) => void
}) {
  const items = BIGFIVE_DATA.items
  const changedCount = Object.keys(edited).filter(id => edited[id] !== originalAnswers[id]).length
  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-bold text-gray-900 tracking-tight">📝 修正 Big Five 作答</h3>
          <p className="text-xs text-gray-500 mt-0.5">點選任一格 1-5 即可修改。儲存後自動重新計分（AI 分析保留不變）。</p>
        </div>
        {changedCount > 0 && (
          <span className="badge bg-orange-50 text-orange-700 ring-1 ring-orange-200 text-xs">已修改 {changedCount} 題</span>
        )}
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {items.map((item, idx) => {
          const pick = edited[item.id]
          const orig = originalAnswers[item.id]
          return (
            <div key={item.id} className="rounded-xl border border-gray-200 p-2.5">
              <div className="text-[11px] text-gray-500 mb-1 flex items-center justify-between">
                <span>{idx + 1}. <span className="text-gray-400">{item.dimension}{item.reverse ? '(反向)' : ''}</span></span>
                {pick !== orig && <span className="text-orange-600 font-medium">已修改</span>}
              </div>
              <p className="text-sm text-gray-900 mb-2">{item.statement}</p>
              <div className="grid grid-cols-5 gap-1">
                {BIGFIVE_DATA.meta.likert_labels.map((label, i) => {
                  const value = i + 1
                  const selected = pick === value
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setEdited({ ...edited, [item.id]: value })}
                      className={cn(
                        'px-1 py-1.5 rounded-lg text-xs border transition',
                        selected
                          ? 'bg-fuchsia-600 text-white border-fuchsia-600'
                          : 'bg-white text-gray-700 border-gray-200 hover:border-fuchsia-300',
                      )}
                      title={label}
                    >
                      <div className="font-bold tabular-nums">{value}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Big Five 群組統整圖表：群組平均雷達 + 部門 × 維度熱力圖 + 各維度分布
function BigFiveAggregateCharts({ subs }: { subs: AssessmentSubmission[] }) {
  const groupAvg = computeBigFiveGroupAvg(subs)

  // 部門 × 維度 熱力圖
  const deptDimMatrix = useMemo(() => {
    const byDept: Record<string, { dims: Record<string, { sum: number; n: number }>; count: number }> = {}
    for (const s of subs) {
      if (!s.bigfive_scores) continue
      const d = s.department
      if (!byDept[d]) {
        byDept[d] = { dims: {}, count: 0 }
        for (const k of BIGFIVE_DIM_KEYS) byDept[d].dims[k] = { sum: 0, n: 0 }
      }
      byDept[d].count += 1
      for (const k of BIGFIVE_DIM_KEYS) {
        const dim = (s.bigfive_scores as BigFiveScores).dimensions[k]
        if (dim) {
          byDept[d].dims[k].sum += dim.pct
          byDept[d].dims[k].n += 1
        }
      }
    }
    const rows = Object.entries(byDept).map(([dept, info]) => ({
      dept,
      count: info.count,
      cells: BIGFIVE_DIM_KEYS.map(k => ({
        key: k,
        pct: info.dims[k].n > 0 ? Math.round(info.dims[k].sum / info.dims[k].n) : null,
      })),
      overall: 0,
    }))
    for (const r of rows) {
      const valid = r.cells.filter(c => c.pct != null) as { pct: number }[]
      r.overall = valid.length > 0 ? valid.reduce((a, b) => a + b.pct, 0) / valid.length : 0
    }
    rows.sort((a, b) => b.overall - a.overall)
    return rows
  }, [subs])

  // 各維度分布（人數落在每個等級）
  const levelDist = useMemo(() => {
    const counts: Record<string, Record<string, number>> = {}
    const LEVELS = ['低', '中低', '中', '中高', '高']
    for (const k of BIGFIVE_DIM_KEYS) {
      counts[k] = {}
      for (const l of LEVELS) counts[k][l] = 0
    }
    for (const s of subs) {
      if (!s.bigfive_scores) continue
      for (const k of BIGFIVE_DIM_KEYS) {
        const d = (s.bigfive_scores as BigFiveScores).dimensions[k]
        if (d && counts[k][d.level] !== undefined) counts[k][d.level] += 1
      }
    }
    return BIGFIVE_DIM_KEYS.map(k => ({
      dim: BIGFIVE_DATA.dimensions[k].label,
      levels: LEVELS.map(l => ({ level: l, count: counts[k][l] || 0 })),
    }))
  }, [subs])

  function heatColor(pct: number | null): string {
    if (pct == null) return '#f3f4f6'
    const hue = Math.max(0, Math.min(120, pct * 1.2))
    const sat = 70
    const light = 92 - (pct * 0.25)
    return `hsl(${hue}, ${sat}%, ${light}%)`
  }

  return (
    <div className="space-y-3 mb-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 1. 群組平均雷達 */}
        <div className="card">
          <h3 className="font-bold text-gray-900 mb-1">群組平均人格輪廓</h3>
          <p className="text-xs text-gray-500 mb-2">已完成 {subs.length} 人的五維度平均</p>
          {groupAvg && <BigFiveRadar scores={{ dimensions: groupAvg, completed_at: '' }} height={240} />}
        </div>

        {/* 2. 部門 × 維度 熱力圖 */}
        <div className="card overflow-x-auto">
          <h3 className="font-bold text-gray-900 mb-1">部門 × 維度熱力圖</h3>
          <p className="text-xs text-gray-500 mb-2">看哪個部門在哪個維度偏高或偏低</p>
          {deptDimMatrix.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">尚無資料</p>
          ) : (
            <table className="text-xs w-full">
              <thead>
                <tr>
                  <th className="text-left p-1.5 font-semibold text-gray-600">部門</th>
                  {BIGFIVE_DIM_KEYS.map(k => (
                    <th key={k} className="p-1.5 font-semibold text-gray-600 text-center" title={BIGFIVE_DATA.dimensions[k].short_desc}>
                      {BIGFIVE_DATA.dimensions[k].label}
                    </th>
                  ))}
                  <th className="p-1.5 font-semibold text-gray-500 text-center">人數</th>
                </tr>
              </thead>
              <tbody>
                {deptDimMatrix.map(row => (
                  <tr key={row.dept}>
                    <td className="p-1.5 font-medium text-gray-800 whitespace-nowrap">{row.dept}</td>
                    {row.cells.map(c => (
                      <td
                        key={c.key}
                        className="p-1 text-center tabular-nums font-semibold"
                        style={{ backgroundColor: heatColor(c.pct), color: c.pct != null && c.pct >= 35 ? '#1f2937' : '#7f1d1d' }}
                        title={`${row.dept} · ${BIGFIVE_DATA.dimensions[c.key].label}：${c.pct ?? '—'}%`}
                      >
                        {c.pct != null ? `${c.pct}` : '—'}
                      </td>
                    ))}
                    <td className="p-1.5 text-center text-gray-500 tabular-nums">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 3. 各維度等級分布 */}
        <div className="card md:col-span-2">
          <h3 className="font-bold text-gray-900 mb-1">各維度等級分布</h3>
          <p className="text-xs text-gray-500 mb-2">每個維度的人數落在哪些等級</p>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            {levelDist.map(({ dim, levels }) => {
              const max = Math.max(...levels.map(l => l.count), 1)
              return (
                <div key={dim} className="rounded-xl bg-gray-50 p-2">
                  <div className="text-xs font-semibold text-gray-800 mb-1 text-center">{dim}</div>
                  <div className="space-y-0.5">
                    {levels.map(l => (
                      <div key={l.level} className="flex items-center gap-1.5 text-[10px]">
                        <span className="text-gray-500 w-7 shrink-0">{l.level}</span>
                        <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                          <div className="h-full bg-fuchsia-500" style={{ width: `${(l.count / max) * 100}%` }} />
                        </div>
                        <span className="text-gray-700 tabular-nums w-4 text-right">{l.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// 計算一群作答的 Big Five 群組平均分數（給雷達圖對照用）
function computeBigFiveGroupAvg(subs: AssessmentSubmission[]): BigFiveScores['dimensions'] | undefined {
  const completed = subs.filter(s => s.status === 'completed' && s.bigfive_scores)
  if (completed.length < 2) return undefined
  const acc: Record<string, { sumPct: number; sumRaw: number; sumMax: number; n: number }> = {}
  for (const k of BIGFIVE_DIM_KEYS) acc[k] = { sumPct: 0, sumRaw: 0, sumMax: 0, n: 0 }
  for (const s of completed) {
    const dims = (s.bigfive_scores as BigFiveScores).dimensions
    for (const k of BIGFIVE_DIM_KEYS) {
      const d = dims[k]
      if (!d) continue
      acc[k].sumPct += d.pct
      acc[k].sumRaw += d.raw
      acc[k].sumMax += d.max
      acc[k].n += 1
    }
  }
  const out = {} as BigFiveScores['dimensions']
  for (const k of BIGFIVE_DIM_KEYS) {
    const a = acc[k]
    const pct = a.n > 0 ? Math.round(a.sumPct / a.n) : 0
    out[k] = {
      raw: a.n > 0 ? Math.round(a.sumRaw / a.n) : 0,
      max: a.n > 0 ? Math.round(a.sumMax / a.n) : 0,
      pct,
      level: pct >= 80 ? '高' : pct >= 65 ? '中高' : pct >= 45 ? '中' : pct >= 30 ? '中低' : '低',
    }
  }
  return out
}

// Big Five AI 分析報告 markdown 渲染
// 支援：# 一、… 大標題；**1. xxx**：行內粗體子標題；空行；一般段落
// 把 AI 報告依 # 段落拆成多張 .card —— PDF 匯出時每張卡會分頁，
// 段落絕對不會被切到字行中間（每段約 200-300 字遠低於一頁高）
function renderBigFiveProfileAsCards(text: string): React.ReactNode {
  function inline(s: string, baseKey: string): React.ReactNode[] {
    const parts: React.ReactNode[] = []
    const regex = /\*\*(.+?)\*\*/g
    let lastIndex = 0
    let m: RegExpExecArray | null
    let i = 0
    while ((m = regex.exec(s)) !== null) {
      if (m.index > lastIndex) parts.push(s.slice(lastIndex, m.index))
      parts.push(<strong key={`${baseKey}-b${i++}`} className="font-bold text-gray-900">{m[1]}</strong>)
      lastIndex = m.index + m[0].length
    }
    if (lastIndex < s.length) parts.push(s.slice(lastIndex))
    return parts
  }

  // 把文字分組：[人格原型卡] + [每個 # 段落自己一張卡]
  type Block = { kind: 'archetype' | 'section'; title?: string; lines: string[] }
  const blocks: Block[] = []
  let current: Block | null = null
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      if (current) current.lines.push('')
      continue
    }
    const am = line.match(/^【人格原型[:：]?】\s*(.+)$/)
    if (am) {
      blocks.push({ kind: 'archetype', title: am[1].trim(), lines: [] })
      current = null
      continue
    }
    const hm = line.match(/^#\s+(.+)$/)
    if (hm) {
      if (current) blocks.push(current)
      current = { kind: 'section', title: hm[1], lines: [] }
      continue
    }
    if (current) current.lines.push(line)
    else {
      // 在第一個 # 之前的內容（少見）也包一卡
      current = { kind: 'section', title: '前言', lines: [line] }
    }
  }
  if (current) blocks.push(current)

  return (
    <>
      {blocks.map((b, idx) => {
        if (b.kind === 'archetype') {
          // 印刷友善：白底 + 紫色粗邊框，列印時不會浪費墨水且 B&W 也清晰
          return (
            <div key={`bf-archetype-${idx}`} className="card mt-3 border-2 border-fuchsia-500 bg-white">
              <div className="text-xs text-fuchsia-600 mb-1 font-semibold tracking-wide">✨ 你的人格原型</div>
              <div className="text-xl md:text-2xl font-bold tracking-tight text-fuchsia-900">{b.title}</div>
            </div>
          )
        }
        return (
          <div key={`bf-section-${idx}`} className="card mt-3">
            <h4 className="font-bold text-base text-gray-900 mb-3 pb-2 border-b border-gray-200">{b.title}</h4>
            <div className="text-sm text-gray-800 space-y-2">
              {b.lines.map((l, li) =>
                l ? <p key={li} className="leading-relaxed">{inline(l, `s${idx}l${li}`)}</p> : <div key={li} className="h-1" />
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}

function renderBigFiveProfile(text: string): React.ReactNode {
  function inline(s: string, baseKey: string): React.ReactNode[] {
    const parts: React.ReactNode[] = []
    const regex = /\*\*(.+?)\*\*/g
    let lastIndex = 0
    let m: RegExpExecArray | null
    let i = 0
    while ((m = regex.exec(s)) !== null) {
      if (m.index > lastIndex) parts.push(s.slice(lastIndex, m.index))
      parts.push(<strong key={`${baseKey}-b${i++}`} className="font-bold text-gray-900">{m[1]}</strong>)
      lastIndex = m.index + m[0].length
    }
    if (lastIndex < s.length) parts.push(s.slice(lastIndex))
    return parts
  }

  return text.split('\n').map((rawLine, i) => {
    const line = rawLine.trim()
    if (!line) return <div key={i} className="h-5" />

    // 人格原型 —— AI 個人化生成，渲染成大字標題
    const archetypeMatch = line.match(/^【人格原型[:：]?】\s*(.+)$/)
    if (archetypeMatch) {
      return (
        <div key={i} className="rounded-2xl bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white px-5 py-4 shadow-md mb-2">
          <div className="text-xs opacity-80 mb-1">✨ 你的人格原型</div>
          <div className="text-xl md:text-2xl font-bold tracking-tight">{archetypeMatch[1].trim()}</div>
        </div>
      )
    }

    const h = line.match(/^#\s+(.+)$/)
    if (h) {
      return (
        <h4 key={i} className="font-bold text-base text-gray-900 mt-6 mb-2 first:mt-0 pb-2 border-b border-gray-200">
          {h[1]}
        </h4>
      )
    }
    return <p key={i} className="leading-relaxed pb-3 last:pb-0">{inline(line, `l${i}`)}</p>
  })
}

// 職位剖面 fit 分數面板（顯示在個別檢視 modal 內）
function JobProfileFitPanel({ submissionId }: { submissionId: string }) {
  const [loading, setLoading] = useState(true)
  const [matches, setMatches] = useState<Array<{ id: string; name: string; description: string | null; fit: number }>>([])
  useEffect(() => {
    let cancel = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/admin/bigfive/job-profiles/match?submission_id=${submissionId}`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancel) setMatches(data.matches || [])
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => { cancel = true }
  }, [submissionId])
  if (loading) return null
  if (matches.length === 0) return null

  function barColor(fit: number) {
    if (fit >= 80) return 'bg-emerald-500'
    if (fit >= 65) return 'bg-lime-500'
    if (fit >= 50) return 'bg-amber-500'
    return 'bg-orange-400'
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-fuchsia-50 to-white border border-fuchsia-200 px-4 py-3 mb-3">
      <h4 className="font-bold text-sm text-fuchsia-900 mb-1">🎯 職位剖面 Fit Score</h4>
      <p className="text-[11px] text-gray-500 mb-2">與預設的職位人格剖面比對（可到 /admin/bigfive/job-profiles 修改）</p>
      <div className="space-y-1.5">
        {matches.slice(0, 6).map(m => (
          <div key={m.id} className="flex items-center gap-2 text-xs">
            <div className="w-20 shrink-0 font-medium text-gray-800 truncate" title={m.description || undefined}>{m.name}</div>
            <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className={cn('h-full transition-all', barColor(m.fit))} style={{ width: `${m.fit}%` }} />
            </div>
            <div className="w-10 text-right font-bold tabular-nums text-gray-900">{m.fit}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Big Five 進階 AI 分析：兩人配對 + 團隊化學作用
function BigFiveAdvancedAnalysis({ event, subs }: { event: AssessmentEvent; subs: AssessmentSubmission[] }) {
  const [mode, setMode] = useState<'idle' | 'pair' | 'team'>('idle')
  // 兩人配對
  const [pairA, setPairA] = useState<string>('')
  const [pairB, setPairB] = useState<string>('')
  const [pairResult, setPairResult] = useState<string | null>(null)
  const [pairMeta, setPairMeta] = useState<{ a: { name: string }; b: { name: string } } | null>(null)
  const [pairCached, setPairCached] = useState(false)
  const [pairGeneratedAt, setPairGeneratedAt] = useState<string | null>(null)
  // 團隊
  const [teamSelected, setTeamSelected] = useState<Set<string>>(new Set())
  const [teamResult, setTeamResult] = useState<string | null>(null)
  const [teamMembers, setTeamMembers] = useState(0)
  const [teamCached, setTeamCached] = useState(false)
  const [teamGeneratedAt, setTeamGeneratedAt] = useState<string | null>(null)
  // 共用
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<'pair' | 'team' | null>(null)
  // 歷史分析（此活動下所有已生成的 artifact）
  type TeamArtifact = { id: string; profile: string; submission_ids: string[]; created_at: string; meta: { scope_label?: string; member_count?: number; avgs?: Record<string, number> } | null }
  type PairArtifact = { id: string; profile: string; submission_ids: string[]; created_at: string; meta: { a?: { name: string }; b?: { name: string } } | null }
  const [historyTeam, setHistoryTeam] = useState<TeamArtifact[]>([])
  const [historyPair, setHistoryPair] = useState<PairArtifact[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch(`/api/admin/bigfive/artifacts?event_id=${event.id}`)
      if (!res.ok) return
      const data = await res.json()
      setHistoryTeam(data.team || [])
      setHistoryPair(data.pair || [])
    } catch { /* 靜默失敗 — 不影響主功能 */ } finally {
      setHistoryLoading(false)
    }
  }, [event.id])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  async function copyText(text: string, key: 'pair' | 'team') {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        // fallback：建一個臨時 textarea 走 execCommand
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(prev => prev === key ? null : prev), 2000)
    } catch {
      setError('複製失敗，請手動框選文字')
    }
  }

  const completed = subs.filter(s => s.bigfive_scores)

  // 把當前選擇序列化成排序後的 key，方便和 historyTeam / historyPair 比對
  const teamKey = useMemo(() => Array.from(teamSelected).sort().join('|'), [teamSelected])
  const pairKey = useMemo(() => (pairA && pairB && pairA !== pairB) ? [pairA, pairB].sort().join('|') : '', [pairA, pairB])

  // ✨ 選擇變動時自動從歷史 artifact 匹配：有匹配就直接秒載；沒匹配才清空
  // 不再需要使用者手動按「生成」才看到既有快取
  useEffect(() => {
    if (!pairKey) {
      setPairResult(null); setPairCached(false); setPairGeneratedAt(null)
      return
    }
    const match = historyPair.find(a => [...a.submission_ids].sort().join('|') === pairKey)
    if (match) {
      setPairResult(match.profile)
      setPairMeta({
        a: { name: match.meta?.a?.name || '—' },
        b: { name: match.meta?.b?.name || '—' },
      })
      setPairCached(true)
      setPairGeneratedAt(match.created_at)
      setError(null)
    } else {
      setPairResult(null); setPairCached(false); setPairGeneratedAt(null)
    }
  }, [pairKey, historyPair])

  useEffect(() => {
    if (!teamKey) {
      setTeamResult(null); setTeamCached(false); setTeamGeneratedAt(null)
      return
    }
    const match = historyTeam.find(a => [...a.submission_ids].sort().join('|') === teamKey)
    if (match) {
      setTeamResult(match.profile)
      setTeamMembers(match.meta?.member_count || match.submission_ids.length)
      setTeamCached(true)
      setTeamGeneratedAt(match.created_at)
      setError(null)
    } else {
      setTeamResult(null); setTeamCached(false); setTeamGeneratedAt(null)
    }
  }, [teamKey, historyTeam])

  async function runPair(regenerate = false) {
    if (!pairA || !pairB || pairA === pairB) { setError('請挑選兩位不同的受測者'); return }
    setLoading(true); setError(null)
    if (regenerate) setPairResult(null)
    try {
      const res = await fetch('/api/admin/bigfive/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a_submission_id: pairA, b_submission_id: pairB, regenerate }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || `失敗 ${res.status}`); return }
      setPairResult(data.profile)
      setPairMeta({ a: data.a, b: data.b })
      setPairCached(!!data.cached)
      setPairGeneratedAt(data.generated_at || null)
      fetchHistory()  // 新生成的會出現在歷史清單
    } catch (e) {
      setError(e instanceof Error ? e.message : '失敗')
    } finally {
      setLoading(false)
    }
  }

  async function runTeam(regenerate = false) {
    if (teamSelected.size < 2) { setError('至少挑選 2 位成員'); return }
    if (teamSelected.size > 30) { setError('一次最多 30 位'); return }
    setLoading(true); setError(null)
    if (regenerate) setTeamResult(null)
    try {
      const res = await fetch('/api/admin/bigfive/team-chemistry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submission_ids: Array.from(teamSelected),
          scope_label: event.name,
          event_id: event.id,
          regenerate,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || `失敗 ${res.status}`); return }
      setTeamResult(data.profile)
      setTeamMembers(data.member_count || teamSelected.size)
      setTeamCached(!!data.cached)
      setTeamGeneratedAt(data.generated_at || null)
      fetchHistory()  // 新生成的會出現在歷史清單
    } catch (e) {
      setError(e instanceof Error ? e.message : '失敗')
    } finally {
      setLoading(false)
    }
  }

  // 載入歷史 artifact 到當前畫面（不打 API 重新跑 AI，直接重現 DB 內容）
  // 從歷史 chip 點擊：只需還原選擇，上面的 useEffect 會自動載入內容
  function loadTeamFromHistory(a: TeamArtifact) {
    setMode('team')
    setTeamSelected(new Set(a.submission_ids))
    setError(null)
  }
  function loadPairFromHistory(a: PairArtifact) {
    setMode('pair')
    setPairA(a.submission_ids[0] || '')
    setPairB(a.submission_ids[1] || '')
    setError(null)
  }

  return (
    <div className="card mb-4">
      <h3 className="font-bold text-gray-900 tracking-tight mb-1">🤖 進階 AI 分析</h3>
      <p className="text-xs text-gray-500 mb-3">由 Claude 依 Big Five 分數產出兩人配對 / 團隊化學作用報告</p>

      {/* === 歷史已生成的分析（從 DB 永久快取載入） === */}
      {(historyTeam.length > 0 || historyPair.length > 0) && (
        <div className="mb-3 p-3 rounded-xl bg-amber-50/60 border border-amber-200">
          <div className="text-xs font-semibold text-amber-900 mb-2">📚 此活動已生成 {historyTeam.length + historyPair.length} 筆分析（點擊載入，不用重跑 AI）</div>
          {historyTeam.length > 0 && (
            <div className="mb-2">
              <div className="text-[11px] text-amber-700 mb-1">團隊化學作用</div>
              <div className="flex flex-wrap gap-1.5">
                {historyTeam.map(a => (
                  <button
                    key={a.id}
                    onClick={() => loadTeamFromHistory(a)}
                    className="px-2 py-1 rounded-lg bg-white border border-amber-300 text-xs text-amber-900 hover:bg-amber-100"
                    title={`生成於 ${formatDateTime(a.created_at)}`}
                  >
                    👥 {a.meta?.member_count || a.submission_ids.length} 人 · {new Date(a.created_at).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })}
                  </button>
                ))}
              </div>
            </div>
          )}
          {historyPair.length > 0 && (
            <div>
              <div className="text-[11px] text-amber-700 mb-1">兩人配對</div>
              <div className="flex flex-wrap gap-1.5">
                {historyPair.map(a => (
                  <button
                    key={a.id}
                    onClick={() => loadPairFromHistory(a)}
                    className="px-2 py-1 rounded-lg bg-white border border-amber-300 text-xs text-amber-900 hover:bg-amber-100"
                    title={`生成於 ${formatDateTime(a.created_at)}`}
                  >
                    🤝 {a.meta?.a?.name || '—'} × {a.meta?.b?.name || '—'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {historyLoading && <div className="mb-3 text-xs text-gray-400">載入歷史分析…</div>}

      <div className="flex gap-2 mb-3 flex-wrap">
        <button
          onClick={() => { setMode('pair'); setError(null); setPairResult(null); setTeamResult(null) }}
          className={cn('px-3 py-1.5 rounded-xl text-sm border transition',
            mode === 'pair' ? 'bg-fuchsia-50 text-fuchsia-900 border-fuchsia-300 ring-1 ring-fuchsia-200 font-semibold' : 'border-gray-200 text-gray-700 hover:border-gray-300'
          )}
        >
          🤝 兩人配對分析
        </button>
        <button
          onClick={() => { setMode('team'); setError(null); setPairResult(null); setTeamResult(null) }}
          className={cn('px-3 py-1.5 rounded-xl text-sm border transition',
            mode === 'team' ? 'bg-fuchsia-50 text-fuchsia-900 border-fuchsia-300 ring-1 ring-fuchsia-200 font-semibold' : 'border-gray-200 text-gray-700 hover:border-gray-300'
          )}
        >
          👥 團隊化學作用
        </button>
        {mode !== 'idle' && (
          <button onClick={() => { setMode('idle'); setError(null); setPairResult(null); setTeamResult(null) }} className="text-xs text-gray-400 hover:text-gray-600">關閉</button>
        )}
      </div>

      {mode === 'pair' && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <select value={pairA} onChange={e => setPairA(e.target.value)} className="input-field text-sm">
              <option value="">A 方（請選擇）</option>
              {completed.map(s => <option key={s.id} value={s.id}>{s.respondent_name}{s.english_name ? ` (${s.english_name})` : ''} · {s.department}</option>)}
            </select>
            <select value={pairB} onChange={e => setPairB(e.target.value)} className="input-field text-sm">
              <option value="">B 方（請選擇）</option>
              {completed.map(s => <option key={s.id} value={s.id}>{s.respondent_name}{s.english_name ? ` (${s.english_name})` : ''} · {s.department}</option>)}
            </select>
          </div>
          <button onClick={() => runPair(false)} disabled={loading || !pairA || !pairB || pairA === pairB} className="btn-primary text-sm bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-50">
            {loading ? '生成中…（約 15-30 秒）' : '🤖 生成配對分析（自動使用快取）'}
          </button>
          <p className="text-[11px] text-gray-400">已生成過的組合會直接讀快取秒回（不消耗 API 額度）；想換新內容請點下方「↻ 重新生成」</p>
        </div>
      )}

      {mode === 'team' && (
        <div className="space-y-2">
          <div className="rounded-xl border border-gray-200 max-h-40 overflow-y-auto p-2">
            <div className="text-xs text-gray-500 mb-1 flex items-center justify-between">
              <span>選擇要分析的成員（{teamSelected.size} / {completed.length}）</span>
              <button
                onClick={() => setTeamSelected(teamSelected.size === completed.length ? new Set() : new Set(completed.map(s => s.id)))}
                className="text-accent-600 hover:underline text-xs"
              >
                {teamSelected.size === completed.length ? '全不選' : '全選'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {completed.map(s => {
                const checked = teamSelected.has(s.id)
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      const next = new Set(teamSelected)
                      if (next.has(s.id)) next.delete(s.id); else next.add(s.id)
                      setTeamSelected(next)
                    }}
                    className={cn(
                      'px-2 py-0.5 rounded-full text-xs ring-1 transition',
                      checked
                        ? 'bg-fuchsia-600 text-white ring-fuchsia-600'
                        : 'bg-white text-gray-700 ring-gray-200 hover:ring-fuchsia-300'
                    )}
                  >
                    {s.respondent_name}
                  </button>
                )
              })}
            </div>
          </div>
          <button onClick={() => runTeam(false)} disabled={loading || teamSelected.size < 2} className="btn-primary text-sm bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-50">
            {loading ? '生成中…（約 20-40 秒）' : `🤖 生成團隊化學作用分析（${teamSelected.size} 人，自動使用快取）`}
          </button>
          <p className="text-[11px] text-gray-400">已生成過的成員組合會直接讀快取秒回</p>
        </div>
      )}

      {error && <p className="text-red-500 text-sm mt-2">⚠️ {error}</p>}

      {pairResult && pairMeta && (
        <div className="mt-4 p-4 rounded-xl bg-fuchsia-50/50 border border-fuchsia-200">
          <div className="flex items-start justify-between mb-2 flex-wrap gap-2">
            <h4 className="font-bold text-fuchsia-900 text-sm">
              🤝 配對分析：{pairMeta.a.name} × {pairMeta.b.name}
              {pairCached && <span className="ml-2 text-[11px] font-normal bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">✓ 快取</span>}
              {pairGeneratedAt && <span className="ml-2 text-[11px] font-normal text-gray-500">生成於 {formatDateTime(pairGeneratedAt)}</span>}
            </h4>
            <div className="flex items-center gap-3">
              <button
                onClick={() => copyText(`配對分析：${pairMeta.a.name} × ${pairMeta.b.name}\n\n${pairResult}`, 'pair')}
                className="text-xs text-fuchsia-700 hover:text-fuchsia-900"
                title="把整段配對分析文字複製到剪貼簿"
              >
                {copiedKey === 'pair' ? '✓ 已複製' : '📋 複製內容'}
              </button>
              <button
                onClick={() => runPair(true)}
                disabled={loading}
                className="text-xs text-orange-600 hover:text-orange-800 disabled:opacity-50"
                title="覆蓋既有快取，重新呼叫 AI 生成"
              >
                {loading ? '生成中…' : '↻ 重新生成（覆蓋快取）'}
              </button>
            </div>
          </div>
          <div className="text-sm text-gray-800 space-y-1.5">{renderBigFiveProfile(pairResult)}</div>
        </div>
      )}

      {teamResult && (
        <div className="mt-4 p-4 rounded-xl bg-fuchsia-50/50 border border-fuchsia-200">
          <div className="flex items-start justify-between mb-2 flex-wrap gap-2">
            <h4 className="font-bold text-fuchsia-900 text-sm">
              👥 團隊化學作用分析（{teamMembers} 人）
              {teamCached && <span className="ml-2 text-[11px] font-normal bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">✓ 快取</span>}
              {teamGeneratedAt && <span className="ml-2 text-[11px] font-normal text-gray-500">生成於 {formatDateTime(teamGeneratedAt)}</span>}
            </h4>
            <div className="flex items-center gap-3">
              <button
                onClick={() => copyText(`團隊化學作用分析（${teamMembers} 人）\n\n${teamResult}`, 'team')}
                className="text-xs text-fuchsia-700 hover:text-fuchsia-900"
                title="把整段團隊化學作用分析文字複製到剪貼簿"
              >
                {copiedKey === 'team' ? '✓ 已複製' : '📋 複製內容'}
              </button>
              <button
                onClick={() => runTeam(true)}
                disabled={loading}
                className="text-xs text-orange-600 hover:text-orange-800 disabled:opacity-50"
                title="覆蓋既有快取，重新呼叫 AI 生成"
              >
                {loading ? '生成中…' : '↻ 重新生成（覆蓋快取）'}
              </button>
            </div>
          </div>
          <div className="text-sm text-gray-800 space-y-1.5">{renderBigFiveProfile(teamResult)}</div>
        </div>
      )}
    </div>
  )
}

// =====================================================
// PDF 列印增強：封面頁 + 每頁頁眉頁腳
// =====================================================
type Html2Canvas = typeof import('html2canvas').default
type JsPDF = InstanceType<typeof import('jspdf').jsPDF>

async function addCoverAndChrome(pdf: JsPDF, html2canvas: Html2Canvas, viewing: AssessmentSubmission, headerCardCanvas: HTMLCanvasElement) {
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()

  // === 緊湊封面：只放標題列 + 品牌（不含姓名／部門，因為 headerCardCanvas 已有） ===
  const reportDate = new Date().toLocaleDateString('zh-TW')
  const coverEl = document.createElement('div')
  coverEl.style.position = 'fixed'
  coverEl.style.top = '-9999px'
  coverEl.style.left = '-9999px'
  coverEl.style.width = '672px'
  coverEl.style.background = 'white'
  // 設計成 A4 寬高比例上半部約 110mm（≈ 350px @ 672px width）
  coverEl.innerHTML = `
    <div style="height: 360px; padding: 50px 60px 30px; display: flex; flex-direction: column; justify-content: space-between; background: white; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang TC', sans-serif;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="color: #a21caf; font-size: 11px; font-weight: 700; letter-spacing: 4px;">DRACO LOP · TALENT ASSESSMENT</div>
          <div style="color: #9ca3af; font-size: 12px; margin-top: 2px;">登泰國際物流股份有限公司</div>
        </div>
        <div style="display: inline-block; padding: 4px 12px; background: linear-gradient(135deg, #f5d0fe, #fce7f3); color: #86198f; font-size: 11px; font-weight: 700; border-radius: 999px;">人格適性分析報告</div>
      </div>

      <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 20px 0;">
        <h1 style="font-size: 48px; font-weight: 900; color: #111827; line-height: 1.1; letter-spacing: -1px; margin: 0;">
          Big Five 人格特質報告
        </h1>
        <div style="width: 60px; height: 3px; background: linear-gradient(90deg, #a21caf, #f472b6); border-radius: 2px; margin-top: 16px;"></div>
        <div style="margin-top: 14px; font-size: 12px; color: #6b7280; line-height: 1.6;">
          本報告依 Big Five (BFI-44) 量表 + Claude AI 生成 · 共 5 大維度 · 30 個面向 · 行為情境化解析
        </div>
      </div>
    </div>
  `
  document.body.appendChild(coverEl)
  let coverHeightMm = 0
  try {
    const coverCanvas = await html2canvas(coverEl, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false })
    pdf.insertPage(1)
    pdf.setPage(1)
    coverHeightMm = (coverCanvas.height * pageW) / coverCanvas.width
    pdf.addImage(coverCanvas.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, pageW, coverHeightMm)
  } finally {
    document.body.removeChild(coverEl)
  }

  // === 把 headerCardCanvas（姓名 + 雷達圖）放在封面下半部 ===
  const margin = 10
  const usableW = pageW - margin * 2
  const headerCardH = (headerCardCanvas.height * usableW) / headerCardCanvas.width
  // 從 coverHeightMm + 一點間距開始；若超出頁面就壓縮高度
  const startY = coverHeightMm + 6
  const availableH = pageH - startY - 20  // 預留底部 footer 20mm
  const drawH = Math.min(headerCardH, availableH)
  const drawW = drawH < headerCardH ? (headerCardCanvas.width * drawH) / headerCardCanvas.height : usableW
  const drawX = (pageW - drawW) / 2
  pdf.addImage(headerCardCanvas.toDataURL('image/jpeg', 0.94), 'JPEG', drawX, startY, drawW, drawH)

  // === 封面底部 footer ===
  pdf.setFontSize(9)
  pdf.setTextColor(156, 163, 175)
  pdf.text(`報告產製：${reportDate}`, margin, pageH - 8)
  pdf.text('Generated by Claude Opus 4.7', pageW - margin, pageH - 8, { align: 'right' })

  // === 每頁底部右下角：簡潔頁碼 ===
  const totalPages = pdf.getNumberOfPages()
  for (let p = 2; p <= totalPages; p++) {
    pdf.setPage(p)
    pdf.setFontSize(8)
    pdf.setTextColor(180, 180, 180)
    pdf.text(`${p - 1} / ${totalPages - 1}`, pageW - 10, pageH - 5, { align: 'right' })
  }
}

// HTML escape，避免姓名/部門有特殊字元時破壞 cover HTML
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
