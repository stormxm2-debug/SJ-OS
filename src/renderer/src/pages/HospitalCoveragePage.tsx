import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, FileText, Trash2, Download, RotateCcw, FileSpreadsheet, CheckSquare, Square, Sparkles } from 'lucide-react'
import { extractPdfPages, parseCoverageTable, REVIEW, type ParsedRow } from '@renderer/services/commercial/proposalParser'
import {
  CATEGORIES,
  SIDES,
  SANGGEUP_ROOMS,
  GENERAL_ROOMS,
  classifyCoverage,
  detectCompany,
  detectPayback,
  findTotalPremium,
  describePayback,
  computeSummary,
  type Category,
  type Side,
  type PaybackNote
} from '@renderer/services/commercial/hospitalCoverage'
import { inspectTemplate, fillTemplate, buildSummaryWorkbook, downloadBlob, type SheetInfo, type MatrixEntry } from '@renderer/services/commercial/templateFill'
import {
  PLANS,
  classifyPlanGroup,
  groupsOfPlan,
  type PlanGroup,
  type PlanKey
} from '@renderer/services/commercial/coveragePlans'
import {
  loadPlanPrefs,
  subscribePlanPrefs,
  isGroupOn,
  isPlanDefault,
  toggleGroup,
  setAllGroups,
  resetPlan,
  type PlanPrefs
} from '@renderer/services/commercial/coveragePlanPrefs'
import {
  requestAiSummary,
  buildBasicSummary,
  summaryToText,
  type ProposalSummaryInput
} from '@renderer/services/commercial/proposalSummaryAi'

/**
 * 가입제안서 담보 정리 — 가입제안서 PDF 여러 건에서 입원·간병 담보를 뽑아 고객 엑셀 양식 항목으로 분류하고,
 * 상황별 하루 입원 시 받는 금액을 전 보험사 합산한다. 제안서는 이 화면(브라우저 메모리)에서만 처리하고,
 * AI 요약에는 계산된 숫자만 보낸다. 보험사는 월 보험료 낮은 순으로 왼쪽부터 나열한다.
 *
 * 색상: 이 앱은 slate 스케일 반전 리맵 — 어두운 글씨 text-slate-100/200, 밝은 면 bg-white/bg-slate-950.
 */

const UNMATCHED = '미분류'
const GROUP_SANGGEUP = '상급 1인/2~3/4~5인실'
const GROUP_GENERAL = '종합 1인/2~3/4~5인실'
const CHOICES = [UNMATCHED, ...CATEGORIES.filter((c) => c !== '간병페이백'), GROUP_SANGGEUP, GROUP_GENERAL]

type TabKey = 'upload' | 'items' | 'result'
type SideChoice = '양쪽' | Side

interface CoverageItem extends ParsedRow {
  key: string
  choice: string
  sideChoice: SideChoice
  daily: string
  needsReview: boolean
  reason: string
  checked: boolean
  /** 이 담보가 속한 플랜. 입원비 양식 항목을 찾은 담보는 'hospital'. */
  plan: PlanKey
  /** 종합·운전자·실손 담보의 세부 그룹 키(입원비·미분류는 null). */
  groupKey: string | null
}

interface ProposalDoc {
  id: string
  fileName: string
  company: string
  totalPremium: number | null
  payback: boolean
  paybackNote: PaybackNote | null
  warnings: string[]
  items: CoverageItem[]
}

interface TemplateState {
  file: File
  buffer: ArrayBuffer
  sheets: SheetInfo[]
  sheetName: string
}

function categoriesOf(choice: string): Category[] {
  if (choice === GROUP_SANGGEUP) return [...SANGGEUP_ROOMS]
  if (choice === GROUP_GENERAL) return [...GENERAL_ROOMS]
  return (CATEGORIES as readonly string[]).includes(choice) ? [choice as Category] : []
}

function choiceOf(categories: Category[]): string {
  if (categories.length === 0) return UNMATCHED
  if (SANGGEUP_ROOMS.every((c) => categories.includes(c))) return GROUP_SANGGEUP
  if (GENERAL_ROOMS.every((c) => categories.includes(c))) return GROUP_GENERAL
  return categories[0]
}

const won = (n: number): string => (n ? `${n.toLocaleString('ko-KR')}원` : '')
const stamp = (): string => {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

async function analyzeProposal(file: File, prefs: PlanPrefs): Promise<ProposalDoc> {
  const { pages, scannedPages } = await extractPdfPages(await file.arrayBuffer())
  const { rows, warnings } = parseCoverageTable(pages)
  const company = detectCompany(pages, file.name) ?? ''

  const classified = rows.map((row, index) => ({ row, index, ...classifyCoverage(row.coverageName, row.amount) }))
  const items: CoverageItem[] = classified.map((c) => {
    const isHospital = c.categories.length > 0
    const group = classifyPlanGroup(c.row.coverageName, isHospital)
    return {
      ...c.row,
      key: `${file.name}-${c.index}`,
      choice: choiceOf(c.categories),
      sideChoice: c.sides.length === 2 ? '양쪽' : c.sides[0],
      daily: c.value === null ? '' : String(c.value),
      needsReview: c.needsReview,
      reason: c.reason,
      // 입원비는 기존대로 분류되면 체크. 다른 플랜은 FC가 저장해 둔 그룹 설정을 그대로 따른다.
      checked: isHospital || (group !== null && isGroupOn(group.plan, group.key, prefs)),
      plan: isHospital ? 'hospital' : (group?.plan ?? 'comprehensive'),
      groupKey: group?.key ?? null
    }
  })

  const allWarnings = [...warnings]
  if (pages.length > 0 && scannedPages.length === pages.length) {
    allWarnings.unshift('글자가 없는 스캔 PDF입니다. 지금은 글자가 들어 있는 PDF만 읽을 수 있습니다.')
  } else if (scannedPages.length > 0) {
    allWarnings.push(`${scannedPages.join(', ')}쪽은 스캔 이미지라 읽지 못했습니다.`)
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fileName: file.name,
    company,
    totalPremium: findTotalPremium(pages),
    payback: detectPayback(pages) || classified.some((c) => c.payback),
    paybackNote: describePayback(pages, company),
    warnings: allWarnings,
    items
  }
}

export default function HospitalCoveragePage(): JSX.Element {
  const [tab, setTab] = useState<TabKey>('upload')
  const [plan, setPlan] = useState<PlanKey>('hospital')
  const [planPrefs, setPlanPrefs] = useState<PlanPrefs>(() => loadPlanPrefs())
  const [pending, setPending] = useState<File[]>([])
  const [docs, setDocs] = useState<ProposalDoc[]>([])
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [includeGeneral, setIncludeGeneral] = useState(false)
  const [template, setTemplate] = useState<TemplateState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [summaryText, setSummaryText] = useState('')
  const [summarySource, setSummarySource] = useState<'ai' | 'basic' | 'edited' | null>(null)
  const [summaryKey, setSummaryKey] = useState('')
  const [includeSummary, setIncludeSummary] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const templateInput = useRef<HTMLInputElement>(null)

  useEffect(() => subscribePlanPrefs(() => setPlanPrefs(loadPlanPrefs())), [])

  /* ---------- 파일 받기 ---------- */

  const registerTemplate = async (file: File): Promise<void> => {
    try {
      const buffer = await file.arrayBuffer()
      const sheets = await inspectTemplate(buffer)
      if (sheets.length === 0) throw new Error("양식에서 '회사명' 칸이 있는 시트를 찾지 못했습니다.")
      setTemplate({ file, buffer, sheets, sheetName: sheets[0].name })
      setNotice(`엑셀 양식 등록: ${file.name}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '엑셀 양식을 읽지 못했습니다.')
    }
  }

  const addFiles = (list: FileList | File[]): void => {
    setError(null)
    const rejected: string[] = []
    const accepted: File[] = []
    for (const file of Array.from(list)) {
      if (/\.xlsx$/i.test(file.name)) {
        void registerTemplate(file)
      } else if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        accepted.push(file)
      } else {
        rejected.push(`${file.name}: 지금은 PDF만 읽을 수 있습니다(사진·스캔본은 추후 지원).`)
      }
    }
    if (accepted.length) setPending((prev) => [...prev, ...accepted])
    if (rejected.length) setError(rejected.join('\n'))
  }

  const analyze = async (): Promise<void> => {
    if (pending.length === 0) return
    setError(null)
    const failures: string[] = []
    const results: ProposalDoc[] = []
    for (const [i, file] of pending.entries()) {
      setBusy(`제안서 분석 중 (${i + 1}/${pending.length}) — ${file.name}`)
      try {
        results.push(await analyzeProposal(file, planPrefs))
      } catch {
        failures.push(`${file.name}: 분석 중 오류가 발생했습니다. PDF가 손상되지 않았는지 확인해주세요.`)
      }
    }
    setBusy(null)
    setPending([])
    setDocs((prev) => [...prev, ...results])
    if (failures.length) setError(failures.join('\n'))
    if (results.length) setTab('items')
  }

  /* ---------- 상태 수정 ---------- */

  const updateDoc = (id: string, patch: Partial<ProposalDoc>): void =>
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))

  const updateItem = (docId: string, key: string, patch: Partial<CoverageItem>): void =>
    setDocs((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, items: d.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) } : d))
    )

  // 지금 보고 있는 플랜의 담보만 체크/해제한다(다른 플랜에서 골라 둔 것을 건드리지 않게).
  const setAllChecked = (checked: boolean): void =>
    setDocs((prev) =>
      prev.map((d) => ({
        ...d,
        items: d.items.map((it) =>
          it.plan !== plan
            ? it
            : { ...it, checked: checked && (plan !== 'hospital' || categoriesOf(it.choice).length > 0) }
        )
      }))
    )

  /* ---------- 담보 그룹 (FC별 저장) ---------- */

  // 저장된 그룹 설정을 지금 올라와 있는 담보에 다시 적용한다.
  const syncPlanChecks = (target: PlanKey, prefs: PlanPrefs): void =>
    setDocs((prev) =>
      prev.map((d) => ({
        ...d,
        items: d.items.map((it) =>
          it.plan === target && it.groupKey ? { ...it, checked: isGroupOn(target, it.groupKey, prefs) } : it
        )
      }))
    )

  const onToggleGroup = (group: PlanGroup): void => {
    toggleGroup(plan, group.key)
    syncPlanChecks(plan, loadPlanPrefs())
  }

  const onSetAllGroups = (on: boolean): void => {
    setAllGroups(plan, on)
    syncPlanChecks(plan, loadPlanPrefs())
  }

  const onResetPlan = (): void => {
    resetPlan(plan)
    syncPlanChecks(plan, loadPlanPrefs())
    setNotice(`${PLANS.find((p) => p.key === plan)?.label} 담보를 기본 셋팅으로 되돌렸습니다.`)
  }

  const resetAll = (): void => {
    if (!window.confirm('올린 제안서와 선택 내용을 모두 지울까요?')) return
    setDocs([])
    setPending([])
    setOverrides({})
    setTemplate(null)
    setSummaryText('')
    setSummarySource(null)
    setError(null)
    setNotice(null)
    setTab('upload')
    setPlan('hospital')
  }

  /* ---------- 회사별 매트릭스 · 합계 ---------- */

  const matrix = useMemo(() => {
    const byCompany = new Map<string, { premium: number | null; payback: boolean; cells: MatrixEntry['cells'] }>()
    for (const doc of docs) {
      const company = doc.company.trim() || '회사 미확인'
      const entry = byCompany.get(company) ?? { premium: null, payback: false, cells: {} }
      if (doc.totalPremium !== null) entry.premium = (entry.premium ?? 0) + doc.totalPremium
      entry.payback = entry.payback || doc.payback
      for (const it of doc.items) {
        if (!it.checked || it.daily === '') continue
        const sides: Side[] = it.sideChoice === '양쪽' ? SIDES : [it.sideChoice]
        for (const category of categoriesOf(it.choice)) {
          const cell = entry.cells[category] ?? {}
          for (const side of sides) cell[side] = it.daily
          entry.cells[category] = cell
        }
      }
      byCompany.set(company, entry)
    }
    return [...byCompany.entries()].map(([company, e]) => ({ company, ...e }))
  }, [docs])

  const overrideKey = (company: string, category: string, side: string): string => `${company}|${category}|${side}`

  const valueOf = (company: string, category: Category, side: Side): string => {
    const key = overrideKey(company, category, side)
    if (key in overrides) return overrides[key]
    const entry = matrix.find((m) => m.company === company)
    if (!entry) return ''
    if (category === '간병페이백') return entry.payback ? 'o' : 'x'
    const value = entry.cells[category]?.[side]
    return value === undefined ? '' : String(value)
  }

  const premiumOf = (company: string): string => {
    const key = overrideKey(company, '보험료', '')
    if (key in overrides) return overrides[key]
    const premium = matrix.find((m) => m.company === company)?.premium
    return premium === null || premium === undefined ? '' : String(premium)
  }

  const premiumNumber = (company: string): number => {
    const raw = premiumOf(company)
    const n = Number(raw)
    return raw !== '' && Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY
  }
  // 보험사는 월 보험료가 낮은 회사부터 왼쪽 → 오른쪽 (보험료를 모르는 회사는 맨 뒤).
  const companies = matrix.map((m) => m.company).sort((a, b) => premiumNumber(a) - premiumNumber(b))

  const summary = computeSummary(companies, valueOf, includeGeneral)

  const paybackNotes: PaybackNote[] = []
  for (const doc of docs) {
    if (!doc.paybackNote?.text) continue
    const company = doc.company.trim() || doc.paybackNote.company
    if (!paybackNotes.some((n) => n.company === company)) paybackNotes.push({ ...doc.paybackNote, company })
  }

  // 체크한 담보의 보험료를 항목·회사별로 합산(한 담보가 여러 항목에 들어가도 첫 항목에만 한 번).
  const premiumTable = useMemo(() => {
    const totals = new Map<string, Map<string, number>>()
    for (const doc of docs) {
      const company = doc.company.trim() || '회사 미확인'
      for (const it of doc.items) {
        const category = categoriesOf(it.choice)[0]
        const premium = Number(it.premium.replace(/[^\d]/g, ''))
        if (!it.checked || !category || !premium) continue
        const bucket = totals.get(company) ?? new Map<string, number>()
        bucket.set(category, (bucket.get(category) ?? 0) + premium)
        totals.set(company, bucket)
      }
    }
    return totals
  }, [docs])

  const itemCount = docs.reduce((n, d) => n + d.items.length, 0)
  const checkedCount = docs.reduce((n, d) => n + d.items.filter((it) => it.checked).length, 0)

  /* ---------- 플랜별 집계 ---------- */

  const itemsOfPlan = (doc: ProposalDoc, key: PlanKey): CoverageItem[] => doc.items.filter((it) => it.plan === key)

  const planCounts = (key: PlanKey): { total: number; checked: number; premium: number } => {
    let total = 0
    let checked = 0
    let premium = 0
    for (const doc of docs) {
      for (const it of itemsOfPlan(doc, key)) {
        total += 1
        if (!it.checked) continue
        checked += 1
        premium += Number(it.premium.replace(/[^\d]/g, '')) || 0
      }
    }
    return { total, checked, premium }
  }

  const planGroups = groupsOfPlan(plan)
  const current = planCounts(plan)

  /* ---------- 내려받기 ---------- */

  // 화면 값(직접 수정 포함)을 엑셀용 회사별 표로. 순서는 보험료 낮은 순.
  const buildEntries = (): MatrixEntry[] =>
    companies.map((company) => {
      const cells: MatrixEntry['cells'] = {}
      for (const category of CATEGORIES) {
        const sides: Partial<Record<Side, number | string>> = {}
        for (const side of SIDES) {
          const raw = valueOf(company, category, side)
          if (raw === '') continue
          sides[side] = category === '간병페이백' || Number.isNaN(Number(raw)) ? raw : Number(raw)
        }
        if (Object.keys(sides).length) cells[category] = sides
      }
      const premium = Number(premiumOf(company))
      return { company, premium: premiumOf(company) !== '' && Number.isFinite(premium) ? premium : null, cells }
    })

  /* ---------- 요약 설명 ---------- */

  // AI에는 계산된 숫자와 회사명만 보낸다(고객 이름·파일명·원문 제외).
  const summaryInput = (): ProposalSummaryInput => ({
    companies: buildEntries().map((entry) => {
      const dailyByCategory: Record<string, { 상해?: number; 질병?: number }> = {}
      for (const [category, sides] of Object.entries(entry.cells)) {
        if (category === '간병페이백' || !sides) continue
        const s = Number(sides.상해)
        const d = Number(sides.질병)
        if (s || d) dailyByCategory[category] = { ...(s ? { 상해: s } : {}), ...(d ? { 질병: d } : {}) }
      }
      return { company: entry.company, monthlyPremium: entry.premium, payback: entry.cells.간병페이백?.상해 === 'o', dailyByCategory }
    }),
    summary,
    paybackNotes
  })

  const makeSummary = async (): Promise<string> => {
    setBusy('AI가 보험별 장점을 정리하는 중…')
    const input = summaryInput()
    const res = await requestAiSummary(input)
    let text: string
    const premiums = new Map(input.companies.map((c) => [c.company, c.monthlyPremium]))
    if (res.ok && res.summary && res.summary.companies.length) {
      text = summaryToText(res.summary, premiums)
      setSummarySource('ai')
      setNotice('AI가 보험별 장점을 정리했습니다. 필요하면 고쳐서 쓰세요.')
    } else {
      text = summaryToText(buildBasicSummary(input), premiums)
      setSummarySource('basic')
      setNotice(`${res.error ?? 'AI 요약을 만들지 못했습니다.'} 숫자 비교로 만든 기본 장점 설명으로 채웠습니다.`)
    }
    setSummaryText(text)
    setSummaryKey(JSON.stringify(input))
    setBusy(null)
    return text
  }

  // 요약을 만든 뒤 숫자(보험료·체크·일당)가 바뀌었으면 옛 요약이다. 직접 고친 요약은 그대로 둔다.
  const summaryStale = Boolean(summaryText) && summarySource !== 'edited' && summaryKey !== JSON.stringify(summaryInput())

  const ensureSummaryLines = async (): Promise<string[]> => {
    if (!includeSummary) return []
    const text = summaryText.trim() && !summaryStale ? summaryText : await makeSummary()
    return text.split('\n').map((line) => line.trim()).filter(Boolean)
  }

  const downloadExcel = async (): Promise<void> => {
    setError(null)
    if (companies.length === 0) {
      setError('엑셀에 넣을 내용이 없습니다. 제안서를 올리고 담보를 체크해주세요.')
      return
    }
    try {
      const summaryLines = await ensureSummaryLines()
      setBusy('엑셀 파일을 만드는 중…')
      const order = new Map(companies.map((c, i) => [c, i]))
      const rows = docs
        .flatMap((d) =>
          d.items
            .filter((it) => it.checked)
            .map((it) => ({ company: d.company.trim() || '회사 미확인', coverageName: it.coverageName, amount: it.amount, term: it.term, premium: it.premium }))
        )
        .sort((a, b) => (order.get(a.company) ?? 99) - (order.get(b.company) ?? 99))
      const blob = await buildSummaryWorkbook({
        matrix: buildEntries(),
        categories: CATEGORIES,
        summary,
        paybackNotes,
        summaryLines,
        rows
      })
      downloadBlob(blob, `가입제안서_담보정리_${stamp()}.xlsx`)
      setNotice('엑셀 파일을 내려받았습니다.')
    } catch (e) {
      setError(e instanceof Error ? e.message : '엑셀 파일을 만드는 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  const downloadTemplate = async (): Promise<void> => {
    setError(null)
    if (!template) {
      setError('먼저 엑셀 양식 파일(.xlsx)을 선택해주세요.')
      setTab('result')
      return
    }
    if (companies.length === 0) {
      setError('양식에 채울 내용이 없습니다. 제안서를 올리고 담보를 체크해주세요.')
      return
    }
    try {
      const summaryLines = await ensureSummaryLines()
      setBusy('엑셀 양식을 채우는 중…')
      const result = await fillTemplate({
        template: template.buffer,
        matrix: buildEntries(),
        sheetName: template.sheetName,
        summary,
        paybackNotes,
        summaryLines
      })
      downloadBlob(result.blob, `${template.file.name.replace(/\.xlsx$/i, '')}_${stamp()}.xlsx`)
      setNotice(
        result.skippedCompanies.length
          ? `'${result.sheetName}' 시트에 채웠습니다. 빈 회사 칸이 모자라 넣지 못한 회사: ${result.skippedCompanies.join(', ')}`
          : `'${result.sheetName}' 시트에 채워서 내려받았습니다.`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : '엑셀 양식을 채우는 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  /* ---------- 화면 ---------- */

  return (
    <div className="space-y-4 pb-16">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-[#0e1e3a] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-[#e6c877]" />
          <h1 className="text-sm font-extrabold text-white">가입제안서 담보 정리</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">
            제안서 {docs.length}건 · 담보 {checkedCount}/{itemCount}
          </span>
        </div>
        <button type="button" onClick={resetAll} className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/10">
          <RotateCcw className="h-3.5 w-3.5" /> 전체 초기화
        </button>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-800">
        {(
          [
            ['upload', '1 제안서 올리기', docs.length ? `${docs.length}건` : ''],
            ['items', '2 담보 선택', itemCount ? `${checkedCount}/${itemCount}` : ''],
            ['result', '3 합계 · 엑셀', '']
          ] as [TabKey, string, string][]
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={[
              'whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-bold transition',
              tab === key ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-200'
            ].join(' ')}
          >
            {label} {count ? <span className="ml-1 text-[11px] font-medium text-slate-500">{count}</span> : null}
          </button>
        ))}
      </div>

      {busy ? <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-[13px] font-medium text-indigo-700">{busy}</div> : null}
      {error ? <div className="whitespace-pre-line rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-medium text-rose-700">{error}</div> : null}
      {notice && !error ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[13px] font-medium text-emerald-700">{notice}</div> : null}

      {/* 1. 제안서 올리기 */}
      {tab === 'upload' ? (
        <div className="space-y-4">
          <div
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              addFiles(e.dataTransfer.files)
            }}
            className={[
              'cursor-pointer rounded-2xl border-2 border-dashed bg-white px-4 py-8 text-center shadow-sm transition',
              dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-700 hover:border-indigo-400'
            ].join(' ')}
          >
            <Upload className="mx-auto h-7 w-7 text-slate-500" />
            <p className="mt-2 text-[14px] font-bold text-slate-100">가입제안서 PDF를 끌어다 놓거나 눌러서 고르세요</p>
            <p className="mt-1 text-[12px] text-slate-500">여러 건 한꺼번에 가능 · 고객 엑셀 양식(.xlsx)을 놓으면 양식으로 등록됩니다</p>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".pdf,.xlsx,application/pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>

          {pending.length > 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
              <ul className="space-y-1.5">
                {pending.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-[12px] text-slate-200">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span className="flex-1 truncate">{file.name}</span>
                    <button type="button" onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))} className="text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void analyze()}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#0e1e3a] px-4 py-2 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {docs.length ? '추가 분석하기' : '분석 시작'} ({pending.length}건)
              </button>
            </div>
          ) : null}

          {docs.length > 0 ? (
            <div className="space-y-2">
              <h2 className="px-1 text-sm font-bold text-slate-100">분석된 제안서</h2>
              <p className="px-1 text-[12px] text-slate-500">회사명·보험료가 다르면 고치세요. 같은 회사 제안서가 여러 건이면 보험료는 합산됩니다.</p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {docs.map((doc) => (
                  <div key={doc.id} className="rounded-2xl border border-slate-800 bg-white p-3 shadow-sm">
                    <div className="truncate text-[11px] text-slate-500" title={doc.fileName}>{doc.fileName}</div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="text-[11px] font-semibold text-slate-500">
                        회사
                        <input value={doc.company} onChange={(e) => updateDoc(doc.id, { company: e.target.value })} placeholder="회사명 입력"
                          className="mt-1 w-full rounded-md border border-slate-700 bg-white px-2 py-1 text-[12px] text-slate-200 outline-none focus:border-indigo-400" />
                      </label>
                      <label className="text-[11px] font-semibold text-slate-500">
                        월 보험료(원)
                        <input type="number" value={doc.totalPremium ?? ''} onChange={(e) => updateDoc(doc.id, { totalPremium: e.target.value === '' ? null : Number(e.target.value) })}
                          className="mt-1 w-full rounded-md border border-slate-700 bg-white px-2 py-1 text-right text-[12px] tabular-nums text-slate-200 outline-none focus:border-indigo-400" />
                      </label>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">
                        담보 {doc.items.length}건 · 체크 {doc.items.filter((it) => it.checked).length}건{doc.payback ? ' · 페이백 o' : ''}
                      </span>
                      <button type="button" onClick={() => setDocs((prev) => prev.filter((d) => d.id !== doc.id))} className="font-semibold text-rose-500">
                        빼기
                      </button>
                    </div>
                    {!doc.company ? <div className="mt-1 text-[11px] text-amber-700">회사명을 찾지 못했습니다. 직접 입력해주세요.</div> : null}
                    {doc.warnings.map((w) => (
                      <div key={w} className="mt-1 text-[11px] text-amber-700">{w}</div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 2. 담보 선택 */}
      {tab === 'items' ? (
        <div className="space-y-3">
          {docs.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-white p-6 text-center text-[13px] text-slate-500 shadow-sm">먼저 제안서를 올려주세요.</div>
          ) : (
            <>
              {/* 플랜 고르기 — 제안서 한 건에 섞여 있는 담보를 네 플랜으로 갈라 본다 */}
              <div className="flex flex-wrap gap-1.5">
                {PLANS.map((p) => {
                  const c = planCounts(p.key)
                  const active = plan === p.key
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setPlan(p.key)}
                      className={[
                        'rounded-xl border px-3 py-2 text-left transition',
                        active ? 'border-indigo-500 bg-indigo-50' : 'border-slate-800 bg-white hover:border-indigo-300'
                      ].join(' ')}
                    >
                      <span className={['block text-[13px] font-bold', active ? 'text-indigo-700' : 'text-slate-200'].join(' ')}>{p.label}</span>
                      <span className="block text-[11px] font-medium text-slate-500 tabular-nums">
                        {c.total === 0 ? '해당 담보 없음' : `${c.checked}/${c.total}건`}
                      </span>
                    </button>
                  )
                })}
              </div>

              <p className="px-1 text-[11px] text-slate-500">{PLANS.find((p) => p.key === plan)?.hint}</p>

              {/* 담보 그룹 — 기본 셋팅에서 켜고 끈 값이 이 기기에 저장돼 다음 제안서부터 자동 적용된다 */}
              {planGroups.length > 0 ? (
                <div className="rounded-2xl border border-slate-800 bg-white p-3 shadow-sm">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-[12px] font-bold text-slate-100">담보 그룹</h3>
                      {isPlanDefault(plan, planPrefs) ? (
                        <span className="rounded-full border border-slate-800 bg-slate-950 px-2 py-0.5 text-[10px] font-semibold text-slate-500">기본 셋팅</span>
                      ) : (
                        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">내 설정 저장됨</span>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => onSetAllGroups(true)} className="rounded-lg border border-slate-800 bg-white px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-950">모두 켜기</button>
                      <button type="button" onClick={() => onSetAllGroups(false)} className="rounded-lg border border-slate-800 bg-white px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-950">모두 끄기</button>
                      <button type="button" onClick={onResetPlan} className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-950">
                        <RotateCcw className="h-3 w-3" /> 기본으로
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {planGroups.map((g) => {
                      const on = isGroupOn(plan, g.key, planPrefs)
                      const found = docs.reduce((n, d) => n + d.items.filter((it) => it.groupKey === g.key).length, 0)
                      return (
                        <button
                          key={g.key}
                          type="button"
                          onClick={() => onToggleGroup(g)}
                          className={[
                            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition',
                            on ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-800 bg-white text-slate-500 hover:border-indigo-300'
                          ].join(' ')}
                        >
                          {on ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                          {g.label}
                          <span className="text-[11px] font-medium tabular-nums opacity-70">{found}</span>
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">
                    켜고 끈 설정은 이 기기에 저장돼 다음에 제안서를 올릴 때 그대로 적용됩니다.
                  </p>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-700">확인 필요</span>
                  <span className="rounded-full border border-slate-800 bg-slate-950 px-2.5 py-0.5 font-semibold text-slate-500">
                    {plan === 'hospital' ? '양식에 없는 담보(기본 해제)' : `체크한 담보 보험료 ${won(current.premium)}`}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setAllChecked(true)} className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-950">
                    <CheckSquare className="h-3.5 w-3.5" /> {plan === 'hospital' ? '분류된 담보 모두 체크' : '이 플랜 모두 체크'}
                  </button>
                  <button type="button" onClick={() => setAllChecked(false)} className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-950">
                    <Square className="h-3.5 w-3.5" /> 전체 해제
                  </button>
                </div>
              </div>

              {docs.map((doc) => {
                const rows = itemsOfPlan(doc, plan)
                return (
                  <details key={doc.id} open className="rounded-2xl border border-slate-800 bg-white shadow-sm">
                    <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-bold text-slate-100">
                      {doc.company || '회사 미확인'} <span className="font-normal text-slate-500">— {doc.fileName} (체크 {rows.filter((it) => it.checked).length}/{rows.length})</span>
                    </summary>
                    {rows.length === 0 ? (
                      <div className="border-t border-slate-800 px-4 py-4 text-[12px] text-slate-500">이 제안서에는 해당 플랜 담보가 없습니다.</div>
                    ) : (
                      <div className="overflow-x-auto border-t border-slate-800">
                        <table className={['w-full text-left text-[12px]', plan === 'hospital' ? 'min-w-[900px]' : 'min-w-[720px]'].join(' ')}>
                          <thead>
                            <tr className="border-b border-slate-800 bg-slate-950 text-[11px] text-slate-500">
                              <th className="px-2 py-2"></th>
                              <th className="px-2 py-2 font-semibold">담보명</th>
                              <th className="px-2 py-2 font-semibold">가입금액</th>
                              <th className="px-2 py-2 font-semibold">납입기간·만기</th>
                              <th className="px-2 py-2 font-semibold">보험료</th>
                              {plan === 'hospital' ? (
                                <>
                                  <th className="px-2 py-2 font-semibold">양식 항목</th>
                                  <th className="px-2 py-2 font-semibold">구분</th>
                                  <th className="px-2 py-2 font-semibold">일당(만원)</th>
                                </>
                              ) : (
                                <th className="px-2 py-2 font-semibold">담보 그룹</th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((it) => {
                              const unmatched = plan === 'hospital' ? categoriesOf(it.choice).length === 0 : it.groupKey === null
                              const rowTone = it.checked && it.needsReview ? 'bg-amber-50' : unmatched ? 'text-slate-500' : ''
                              return (
                                <tr key={it.key} className={['border-b border-slate-800 last:border-0', rowTone].join(' ')}>
                                  <td className="px-2 py-1.5">
                                    <input type="checkbox" checked={it.checked} onChange={(e) => updateItem(doc.id, it.key, { checked: e.target.checked })} className="h-4 w-4 accent-indigo-600" />
                                  </td>
                                  <td className="max-w-[340px] px-2 py-1.5 text-slate-200" title={it.reason}>{it.coverageName}</td>
                                  <td className={['px-2 py-1.5 whitespace-nowrap', it.amount === REVIEW ? 'font-bold text-rose-600' : ''].join(' ')}>{it.amount}</td>
                                  <td className="px-2 py-1.5 whitespace-nowrap">{it.term}</td>
                                  <td className={['px-2 py-1.5 whitespace-nowrap tabular-nums', it.premium === REVIEW ? 'font-bold text-rose-600' : ''].join(' ')}>{it.premium}</td>
                                  {plan === 'hospital' ? (
                                    <>
                                      <td className="px-2 py-1.5">
                                        <select value={it.choice} onChange={(e) => updateItem(doc.id, it.key, { choice: e.target.value, checked: e.target.value !== UNMATCHED })}
                                          className="rounded-md border border-slate-700 bg-white px-1.5 py-1 text-[12px] text-slate-200 outline-none">
                                          {CHOICES.map((c) => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                      </td>
                                      <td className="px-2 py-1.5">
                                        <select value={it.sideChoice} onChange={(e) => updateItem(doc.id, it.key, { sideChoice: e.target.value as SideChoice })}
                                          className="rounded-md border border-slate-700 bg-white px-1.5 py-1 text-[12px] text-slate-200 outline-none">
                                          {(['양쪽', '상해', '질병'] as SideChoice[]).map((s) => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                      </td>
                                      <td className="px-2 py-1.5">
                                        <input value={it.daily} onChange={(e) => updateItem(doc.id, it.key, { daily: e.target.value.trim() })} placeholder={it.needsReview ? '직접 입력' : ''}
                                          className="w-20 rounded-md border border-slate-700 bg-white px-2 py-1 text-right text-[12px] tabular-nums text-slate-200 outline-none focus:border-indigo-400" />
                                      </td>
                                    </>
                                  ) : (
                                    <td className="px-2 py-1.5">
                                      <select value={it.groupKey ?? ''} onChange={(e) => updateItem(doc.id, it.key, { groupKey: e.target.value || null, checked: e.target.value !== '' })}
                                        className="rounded-md border border-slate-700 bg-white px-1.5 py-1 text-[12px] text-slate-200 outline-none">
                                        <option value="">미분류</option>
                                        {planGroups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                                      </select>
                                    </td>
                                  )}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </details>
                )
              })}
            </>
          )}
        </div>
      ) : null}

      {/* 3. 합계 · 엑셀 */}
      {tab === 'result' ? (
        companies.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-white p-6 text-center text-[13px] text-slate-500 shadow-sm">아직 계산할 담보가 없습니다. 제안서를 올리고 담보를 체크해주세요.</div>
        ) : (
          <div className="space-y-4">
            {/* 최종 합계표 — 회사별 담보 표와 바로 아래 회사별 합계 */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-end justify-between gap-2 px-1">
                <h2 className="text-sm font-bold text-slate-100">
                  최종 합계표 <span className="text-[11px] font-medium text-slate-500">보험료 낮은 순 · 일당 만원 · 위 칸은 직접 수정 가능</span>
                </h2>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-300">
                  <input type="checkbox" checked={includeGeneral} onChange={(e) => setIncludeGeneral(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
                  상급병원 합계에 종합병원일당도 더하기 (약관상 해당 시)
                </label>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-white p-2 shadow-sm">
                <table className="w-full border-collapse text-center text-[12px]">
                  <thead>
                    <tr className="text-[12px]">
                      <th rowSpan={2} className="sticky left-0 z-[1] border border-slate-800 bg-[#0e1e3a] px-3 py-1.5 text-left font-bold text-white">항목</th>
                      {companies.map((c) => <th key={c} colSpan={2} className="border border-slate-800 bg-[#0e1e3a] px-2 py-1.5 font-bold text-white">{c}</th>)}
                    </tr>
                    <tr className="text-[11px] text-slate-500">
                      {companies.flatMap((c) => SIDES.map((s) => <th key={`${c}-${s}`} className="border border-slate-800 bg-slate-950 px-2 py-1 font-semibold">{s}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORIES.map((category) => (
                      <tr key={category}>
                        <th className="sticky left-0 z-[1] whitespace-nowrap border border-slate-800 bg-white px-3 py-1 text-left text-[12px] font-semibold text-slate-200">{category}</th>
                        {companies.flatMap((company) =>
                          SIDES.map((side) => {
                            const key = overrideKey(company, category, side)
                            const value = valueOf(company, category, side)
                            const needsInput = category !== '간병페이백' && !value && docs.some(
                              (d) => (d.company.trim() || '회사 미확인') === company && d.items.some((it) => it.checked && it.daily === '' && categoriesOf(it.choice).includes(category))
                            )
                            return (
                              <td key={key} className="border border-slate-800 p-0.5">
                                <input value={value} onChange={(e) => setOverrides((prev) => ({ ...prev, [key]: e.target.value.trim() }))}
                                  className={['w-full min-w-[3.5rem] rounded px-1 py-0.5 text-center text-[12px] tabular-nums outline-none focus:bg-indigo-50', needsInput ? 'bg-rose-50' : 'bg-transparent'].join(' ')} />
                              </td>
                            )
                          })
                        )}
                      </tr>
                    ))}
                    <tr className="bg-slate-950">
                      <th className="sticky left-0 z-[1] border border-slate-800 bg-slate-950 px-3 py-1 text-left text-[12px] font-bold text-slate-100">월 보험료</th>
                      {companies.map((company) => {
                        const key = overrideKey(company, '보험료', '')
                        return (
                          <td key={key} colSpan={2} className="border border-slate-800 p-0.5">
                            <input value={premiumOf(company)} onChange={(e) => setOverrides((prev) => ({ ...prev, [key]: e.target.value.trim() }))}
                              className="w-full rounded bg-transparent px-1 py-0.5 text-center text-[12px] font-bold tabular-nums outline-none focus:bg-white" />
                          </td>
                        )
                      })}
                    </tr>
                    <tr>
                      <th colSpan={1 + companies.length * 2} className="border border-slate-800 bg-[#0e1e3a] px-3 py-1.5 text-left text-[12px] font-bold text-white">
                        합계 <span className="font-medium text-white/70">하루 입원 시 받는 금액(만원) · 회사별</span>
                      </th>
                    </tr>
                    {summary.map((row) => (
                      <tr key={row.label} className="bg-amber-50" title={row.parts.join(' + ')}>
                        <th className="sticky left-0 z-[1] whitespace-nowrap border border-slate-800 bg-amber-50 px-3 py-1.5 text-left text-[12px] font-bold text-slate-100">{row.label}</th>
                        {companies.flatMap((company) =>
                          SIDES.map((side) => {
                            const value = row.byCompany[company]?.[side] ?? 0
                            return <td key={`${row.label}-${company}-${side}`} className="border border-slate-800 px-2 py-1.5 font-bold tabular-nums text-slate-100">{value || ''}</td>
                          })
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-1 pt-2 text-[11px] text-slate-500">빨간 칸은 일당을 못 읽은 곳입니다(예: 농협). 직접 입력하면 합계가 바로 바뀝니다. 합계 줄에 마우스를 올리면 더한 항목이 보입니다.</p>
              </div>

              {/* 페이백 안내 */}
              {paybackNotes.length > 0 ? (
                paybackNotes.map((note) => (
                  <div key={note.company} className="rounded-xl border-l-4 border-indigo-400 bg-indigo-50 px-3 py-2 text-[12px] text-slate-200">
                    <div className="font-bold text-indigo-700">{note.company} 간병 페이백</div>
                    <div className="mt-0.5">{note.text}</div>
                    {note.evidence[0] ? <div className="mt-1 text-[11px] text-slate-500">원문: {note.evidence[0]}</div> : null}
                  </div>
                ))
              ) : (
                <div className="px-1 text-[12px] text-slate-500">제안서에서 간병인 지원금(페이백) 조건을 찾지 못했습니다. 원문을 확인해주세요.</div>
              )}
            </div>

            {/* 요약 설명 */}
            <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-slate-100">
                  이 보험의 장점{' '}
                  {summarySource ? (
                    <span className="text-[11px] font-medium text-slate-500">
                      {summarySource === 'ai' ? 'AI 정리' : summarySource === 'basic' ? '기본 설명(AI 미연결)' : '직접 수정함'}
                    </span>
                  ) : null}
                </h2>
                <button type="button" disabled={Boolean(busy)} onClick={() => void makeSummary()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[12px] font-bold text-indigo-700 hover:opacity-90 disabled:opacity-50">
                  <Sparkles className="h-3.5 w-3.5" /> {summaryText ? 'AI로 다시 정리' : 'AI로 장점 정리'}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">보험사별로 고객에게 설명할 장점을 정리합니다. 합계·보험료·페이백 숫자와 회사명만 AI에 보냅니다(고객 이름·제안서 원문 제외). 엑셀 받을 때 비어 있거나 숫자가 바뀌었으면 자동으로 새로 만듭니다.</p>
              {summaryStale ? <div className="mt-2 text-[12px] font-medium text-amber-700">정리한 뒤 숫자가 바뀌었습니다. 엑셀 받을 때 새로 만들거나, 지금 다시 정리하세요.</div> : null}
              {summaryText ? (
                <textarea value={summaryText} onChange={(e) => { setSummaryText(e.target.value); setSummarySource('edited') }} rows={Math.min(16, summaryText.split('\n').length + 1)}
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] leading-relaxed text-slate-200 outline-none focus:border-indigo-400" />
              ) : null}
              <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-300">
                <input type="checkbox" checked={includeSummary} onChange={(e) => setIncludeSummary(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
                엑셀에 장점 설명 넣기
              </label>
            </div>

            {/* 항목별 보험료 */}
            <details open className="rounded-2xl border border-slate-800 bg-white shadow-sm">
              <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-bold text-slate-100">
                항목별 보험료 <span className="text-[11px] font-medium text-slate-500">체크한 담보 기준 · 월 보험료와 1일당 받는 금액 · 저렴한 회사부터</span>
              </summary>
              <div className="overflow-x-auto border-t border-slate-800">
                <table className="w-full min-w-[480px] text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950 text-[11px] text-slate-500">
                      <th className="px-3 py-2 font-semibold">항목</th>
                      {companies.map((c) => <th key={c} className="px-3 py-2 text-right font-semibold">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORIES.filter((c) => c !== '간병페이백').map((category) => {
                      // 회사끼리 더하지 않는다 — 회사별 월 보험료와 그 담보로 하루에 받는 금액을 같이 보여준다.
                      const cells = companies.map((company) => {
                        const premium = premiumTable.get(company)?.get(category) ?? 0
                        const daily = SIDES.map((side) => [side, Number(valueOf(company, category, side)) || 0] as const).filter(([, v]) => v > 0)
                        return { company, premium, daily }
                      })
                      if (cells.every((c) => !c.premium && c.daily.length === 0)) return null
                      return (
                        <tr key={category} className="border-b border-slate-800 align-top">
                          <td className="px-3 py-1.5 font-semibold text-slate-200">{category}</td>
                          {cells.map((c) => (
                            <td key={c.company} className="px-3 py-1.5 text-right tabular-nums">
                              <div className="font-semibold text-slate-200">{c.premium ? `월 ${won(c.premium)}` : c.daily.length ? '보험료 확인 필요' : ''}</div>
                              {c.daily.length ? (
                                <div className="text-[11px] text-indigo-700">1일당 {c.daily.map(([side, v]) => `${side} ${v}만원`).join(' · ')}</div>
                              ) : null}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </details>

            {/* 엑셀 받기 */}
            <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-bold text-slate-100">엑셀 받기</h2>
              <p className="mt-1 text-[12px] text-slate-500">양식 없이 바로 받기 — A4 가로 한 장: 회사별 담보 표 + 합계 · 페이백 안내 · 이 보험의 장점 (+ 담보목록 시트)</p>
              <div className="mt-2 flex justify-end">
                <button type="button" disabled={Boolean(busy)} onClick={() => void downloadExcel()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e1e3a] px-3 py-2 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-50">
                  <Download className="h-3.5 w-3.5" /> 엑셀 받기
                </button>
              </div>
              <div className="my-3 border-t border-slate-800" />
              <p className="text-[12px] font-semibold text-slate-300">내 엑셀 양식에 채워서 받기</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => templateInput.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-200 hover:bg-slate-950">
                  <FileSpreadsheet className="h-3.5 w-3.5" /> 엑셀 양식 선택
                </button>
                <input ref={templateInput} type="file" accept=".xlsx" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void registerTemplate(file)
                  e.target.value = ''
                }} />
                <span className="text-[12px] text-slate-500">{template ? template.file.name : '선택된 양식 없음'}</span>
                {template && template.sheets.length > 1 ? (
                  <select value={template.sheetName} onChange={(e) => setTemplate({ ...template, sheetName: e.target.value })}
                    className="rounded-md border border-slate-700 bg-white px-2 py-1 text-[12px] text-slate-200 outline-none">
                    {template.sheets.map((s) => (
                      <option key={s.name} value={s.name}>{s.name}{s.companies.length ? ` (${s.companies.join(', ')})` : ' (비어 있음)'}</option>
                    ))}
                  </select>
                ) : null}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">양식의 기존 표·수식은 그대로 두고 값만 채웁니다(회사는 보험료 낮은 순). 회사별 합계·페이백 안내·장점 설명은 표 아래에 추가됩니다.</p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button type="button" disabled={Boolean(busy) || !template} onClick={() => void downloadTemplate()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-white px-3 py-2 text-[12px] font-semibold text-slate-200 hover:bg-slate-950 disabled:opacity-50">
                  <Download className="h-3.5 w-3.5" /> 양식에 채워서 받기
                </button>
              </div>
            </div>
          </div>
        )
      ) : null}

      {/* 하단 상태 바 */}
      {docs.length > 0 ? (
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-white px-4 py-2.5 shadow-lg">
          <span className="text-[12px] text-slate-500">
            제안서 {docs.length}건 · 담보 {checkedCount}/{itemCount} 체크 · {template ? template.file.name : '양식 미선택'}
          </span>
          <div className="flex gap-1.5">
            {template ? (
              <button type="button" disabled={Boolean(busy)} onClick={() => void downloadTemplate()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-200 hover:bg-slate-950 disabled:opacity-50">
                <FileSpreadsheet className="h-3.5 w-3.5" /> 양식에 채워서 받기
              </button>
            ) : null}
            <button type="button" disabled={Boolean(busy)} onClick={() => void downloadExcel()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e1e3a] px-3 py-1.5 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-50">
              <Download className="h-3.5 w-3.5" /> 엑셀 받기
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
