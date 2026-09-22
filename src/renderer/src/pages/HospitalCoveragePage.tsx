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
import {
  inspectTemplate,
  fillTemplate,
  buildSummaryWorkbook,
  buildPlanWorkbook,
  downloadBlob,
  type SheetInfo,
  type MatrixEntry,
  type PlanMixRow
} from '@renderer/services/commercial/templateFill'
import {
  buildMix,
  mixKeyOf,
  familyOf,
  unitBasis,
  unitPriceAt,
  rankOffers,
  parseAmountManwon,
  parsePremiumWon,
  type MixResult
} from '@renderer/services/commercial/coverageMix'
import { explainMix, buildBasicExplanation, explanationToText, type MixExplanation } from '@renderer/services/commercial/coverageMixAi'
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
  // 플랜별 AI 설명(조합 설계안이 왜 좋은지 3가지). 플랜을 바꿔도 각각 남는다.
  const [mixNotes, setMixNotes] = useState<Partial<Record<PlanKey, MixExplanation>>>({})
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

  // 담보 선택이 바뀌면 조합도 바뀐다. 옛 숫자로 쓴 설명이 남지 않게 지운다.
  useEffect(() => setMixNotes({}), [docs])

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

  /**
   * 플랜별 건수와 **회사별** 월 보험료.
   *
   * 보험료를 회사끼리 더하면 안 된다. 서로 비교하려고 올린 제안서라서,
   * A사 10만원 + B사 10만원을 더한 20만원은 아무도 내지 않는 금액이다.
   * (최종 합계표도 같은 이유로 회사별로만 더한다 — hospitalCoverage.SummaryRow)
   */
  const planCounts = (
    key: PlanKey
  ): { total: number; checked: number; byCompany: { company: string; premium: number }[] } => {
    let total = 0
    let checked = 0
    const premiums = new Map<string, number>()
    for (const doc of docs) {
      const company = doc.company.trim() || '회사 미확인'
      for (const it of itemsOfPlan(doc, key)) {
        total += 1
        if (!it.checked) continue
        checked += 1
        const won = Number(it.premium.replace(/[^\d]/g, '')) || 0
        premiums.set(company, (premiums.get(company) ?? 0) + won)
      }
    }
    const byCompany = [...premiums.entries()]
      .map(([company, premium]) => ({ company, premium }))
      .sort((a, b) => a.premium - b.premium)
    return { total, checked, byCompany }
  }

  const planGroups = groupsOfPlan(plan)
  const current = planCounts(plan)
  const planLabel = PLANS.find((p) => p.key === plan)?.label ?? ''

  /* ---------- 조합 설계안 (담보별 최저 보험료) ---------- */

  // 체크한 담보만 조합에 넣는다. 회사는 제안서의 보험사명 기준.
  const mix: MixResult = useMemo(() => {
    const items = docs.flatMap((doc) =>
      doc.items
        .filter((it) => it.plan === plan && it.checked)
        .map((it) => ({
          company: doc.company.trim() || '회사 미확인',
          coverageName: it.coverageName,
          amount: it.amount,
          premium: it.premium,
          plan: it.plan,
          groupKey: it.groupKey
        }))
    )
    return buildMix(items)
  }, [docs, plan])

  const mixCompanies = useMemo(
    () => [...new Set(docs.map((d) => d.company.trim() || '회사 미확인'))],
    [docs]
  )

  const planNote = mixNotes[plan] ?? null

  /* ---------- 담보 × 보험사 비교표 ---------- */

  interface CompareCell {
    premium: number | null
    /** 이 회사의 가입금액(만원). 회사마다 다르면 보험료만 비교하면 안 된다. */
    amountManwon: number | null
    /** 이 회사가 실제로 넣은 담보 이름. 묶인 줄에서 회사마다 다를 때 보여준다. */
    scope: string
  }

  interface CompareRow {
    key: string
    label: string
    /** 묶인 줄인지 — 회사마다 다른 담보가 들어갔을 수 있다 */
    grouped: boolean
    /** 실제로 회사마다 다른 담보가 들어갔는지 */
    scopesDiffer: boolean
    checked: boolean
    /** 이 줄에서 가장 큰 가입금액 — 단가 단위를 고를 때 쓴다 */
    amountManwon: number | null
    /** 회사마다 가입금액이 다른지 — 다르면 보험료만 보면 속는다 */
    amountsDiffer: boolean
    byCompany: Record<string, CompareCell | null>
    /** 값이 있는 회사 수 — 1곳뿐이면 비교가 아니라 '한 곳에만 있는 담보' */
    offeredBy: number
    items: { docId: string; itemKey: string }[]
  }

  /**
   * 담보를 세로, 보험사를 가로로 놓은 비교표.
   *
   * 회사마다 같은 자리에 다른 담보를 넣는다(A사 뇌혈관질환, B사 뇌졸중). 각각 다른 줄로
   * 두면 표가 0으로 가득 차 못 보므로 familyOf 로 한 줄에 모으고, 칸마다 그 회사가 실제로
   * 넣은 담보를 함께 보여준다 — 값이 다른 이유를 숨기지 않기 위해서다.
   *
   * 체크를 끈 담보도 표에 남긴다(다시 켤 수 있어야 하므로).
   */
  const compareRows: CompareRow[] = useMemo(() => {
    const byKey = new Map<string, CompareRow & { scopes: Set<string> }>()
    for (const doc of docs) {
      const company = doc.company.trim() || '회사 미확인'
      for (const it of doc.items) {
        if (it.plan !== plan) continue
        const mixKey = mixKeyOf(it.coverageName)
        if (!mixKey.key) continue
        const fam = familyOf(mixKey.key, mixKey.label)
        const row =
          byKey.get(fam.key) ??
          ({
            key: fam.key,
            label: fam.label,
            grouped: fam.grouped,
            scopesDiffer: false,
            checked: false,
            amountManwon: null,
            amountsDiffer: false,
            byCompany: {},
            offeredBy: 0,
            items: [],
            scopes: new Set<string>()
          } as CompareRow & { scopes: Set<string> })

        const won = parsePremiumWon(it.premium)
        const amount = parseAmountManwon(it.amount)
        const prev = row.byCompany[company]
        // 같은 회사에 같은 자리 담보가 여러 줄이면 보험료는 더하고 가입금액은 큰 쪽을 쓴다.
        row.byCompany[company] = {
          premium: (prev?.premium ?? 0) + (won ?? 0) || null,
          amountManwon: amount === null ? prev?.amountManwon ?? null : Math.max(prev?.amountManwon ?? 0, amount),
          scope: prev?.scope || mixKey.label
        }
        row.scopes.add(mixKey.label)
        if (amount !== null) row.amountManwon = Math.max(row.amountManwon ?? 0, amount)
        if (it.checked) row.checked = true
        row.items.push({ docId: doc.id, itemKey: it.key })
        byKey.set(fam.key, row)
      }
    }

    return [...byKey.values()]
      .map((row) => ({
        ...row,
        scopesDiffer: row.grouped && row.scopes.size > 1,
        amountsDiffer:
          new Set(
            Object.values(row.byCompany)
              .filter((c) => c?.premium && c.amountManwon)
              .map((c) => c!.amountManwon)
          ).size > 1,
        offeredBy: Object.values(row.byCompany).filter((c) => c?.premium).length
      }))
      .sort((a, b) => {
        // 여러 회사가 가진 담보를 위로, 그 안에서는 보험료가 큰 담보부터.
        if ((a.offeredBy > 1) !== (b.offeredBy > 1)) return a.offeredBy > 1 ? -1 : 1
        const max = (r: CompareRow): number =>
          Math.max(0, ...Object.values(r.byCompany).map((c) => c?.premium ?? 0))
        return max(b) - max(a)
      })
  }, [docs, plan])

  /** 여러 회사가 가진 담보 — 진짜 비교가 되는 줄 */
  const comparableRows = compareRows.filter((r) => r.offeredBy > 1)
  /** 한 곳에만 있는 담보 — 비교가 아니라 참고. 표 아래에 접어 둔다. */
  const soleRows = compareRows.filter((r) => r.offeredBy <= 1)

  /** 체크한 담보만 더한 회사별 합계. 회사끼리는 절대 더하지 않는다. */
  const compareTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const company of mixCompanies) {
      let sum = 0
      for (const row of compareRows) {
        if (!row.checked) continue
        sum += row.byCompany[company]?.premium ?? 0
      }
      totals.set(company, sum)
    }
    return totals
  }, [compareRows, mixCompanies])

  const totalValues = [...compareTotals.values()].filter((v) => v > 0)
  const cheapestTotal = totalValues.length > 1 ? Math.min(...totalValues) : null
  const dearestTotal = totalValues.length > 1 ? Math.max(...totalValues) : null

  /** 비교표에서 회사를 보험료 싼 순으로 왼쪽부터 놓는다. */
  const compareCompanies = useMemo(
    () => [...mixCompanies].sort((a, b) => (compareTotals.get(a) || Infinity) - (compareTotals.get(b) || Infinity)),
    [mixCompanies, compareTotals]
  )

  /** 담보 한 줄을 통째로 켜고 끈다(회사 구분 없이). */
  const toggleCompareRow = (row: CompareRow, next: boolean): void =>
    setDocs((prev) =>
      prev.map((d) => ({
        ...d,
        items: d.items.map((it) =>
          row.items.some((r) => r.docId === d.id && r.itemKey === it.key) ? { ...it, checked: next } : it
        )
      }))
    )

  /**
   * 담보별로 조합이 고른 회사. 비교표의 파란 칸을 이 값으로 칠해
   * '표에서 파란 칸' 과 '우리 추천' 이 항상 같게 만든다.
   *
   * 조합은 가입금액까지 보정해서 고르기 때문에, 보험료 숫자만 보고 칠하면
   * 추천과 다른 칸이 파랗게 되어 FC가 헷갈린다.
   */
  const mixPickByKey = useMemo(() => {
    const picks = new Map<string, string>()
    for (const row of mix.rows) if (row.best) picks.set(row.key, row.best.company)
    return picks
  }, [mix])


  /**
   * 담보 카드 — 담보 하나에 카드 하나.
   *
   * 예전에는 담보 × 보험사 표 하나로 보여줬다. 회사가 셋만 돼도 옆으로 넘겨야 하고,
   * 한 화면에 숫자가 수십 개라 FC 도 고객도 읽지 못했다. 그래서 세로로만 읽는 카드로 바꿨다.
   * 카드 하나에 담보 하나, 그 안에 회사별 막대 — 막대가 짧은 곳이 싼 곳이다.
   *
   * 정렬은 "아끼는 돈이 큰 담보" 순이다. 어디서 돈이 갈리는지가 먼저 보여야 한다.
   */
  const coverageCards = useMemo(() => {
    return comparableRows
      .map((row) => {
        const basis = unitBasis(row.amountManwon)
        const ranking = rankOffers(
          compareCompanies
            .map((company) => ({
              company,
              premiumWon: row.byCompany[company]?.premium ?? 0,
              amountManwon: row.byCompany[company]?.amountManwon ?? null
            }))
            .filter((o) => o.premiumWon > 0),
          basis
        )
        // 조합이 고른 회사를 그대로 강조한다 — 카드와 추천이 어긋나면 FC 가 헷갈린다.
        const pick = mixPickByKey.get(row.key) ?? ranking.best?.company ?? null
        // 가입금액이 같을 때만 "매달 얼마 아낌" 을 원 단위로 말할 수 있다.
        const saving =
          !row.amountsDiffer && ranking.ranked.length > 1 && pick === ranking.ranked[0].company
            ? ranking.ranked[1].premiumWon - ranking.ranked[0].premiumWon
            : null
        return { row, basis, ranking, pick, saving }
      })
      .filter((card) => card.ranking.ranked.length > 0)
      .sort((a, b) => (b.saving ?? 0) - (a.saving ?? 0))
  }, [comparableRows, compareCompanies, mixPickByKey])

  /** 이 플랜에서 회사마다 몇 개를 맡고 매달 얼마인지 — 결론 카드의 역할 배지 */
  const planRoles = useMemo(() => {
    const roles = new Map<string, { count: number; premium: number }>()
    for (const card of coverageCards) {
      if (!card.row.checked || !card.pick) continue
      const premium = card.row.byCompany[card.pick]?.premium ?? 0
      const prev = roles.get(card.pick) ?? { count: 0, premium: 0 }
      roles.set(card.pick, { count: prev.count + 1, premium: prev.premium + premium })
    }
    return [...roles.entries()]
      .map(([company, v]) => ({ company, ...v }))
      .sort((a, b) => b.premium - a.premium)
  }, [coverageCards])

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

  /* ---------- 플랜 엑셀 · AI 설명 ---------- */

  // 조합 설계안 표를 엑셀용 행으로. 회사별 보험료를 같이 실어 비교 시트를 만든다.
  const buildPlanMixRows = (): PlanMixRow[] =>
    mix.rows
      .filter((row) => row.best)
      .map((row) => {
        const byCompany: Record<string, number | null> = {}
        for (const company of mixCompanies) {
          byCompany[company] = row.candidates.find((c) => c.company === company)?.premiumWon ?? null
        }
        return {
          label: row.label,
          company: row.best!.company,
          coverageName: row.best!.coverageName,
          amountManwon: row.best!.amountManwon,
          premiumWon: row.best!.premiumWon,
          unitPrice: row.best!.unitPrice,
          needsReview: row.needsReview,
          soleOffer: row.soleOffer,
          byCompany
        }
      })

  const planListRows = (): { company: string; coverageName: string; amount: string; term: string; premium: string }[] =>
    docs.flatMap((doc) =>
      doc.items
        .filter((it) => it.plan === plan && it.checked)
        .map((it) => ({
          company: doc.company.trim() || '회사 미확인',
          coverageName: it.coverageName,
          amount: it.amount,
          term: it.term,
          premium: it.premium
        }))
    )

  // AI 설명을 받아 온다. 서버가 없거나 실패하면 숫자로 만든 기본 설명을 그대로 쓴다.
  const requestPlanNote = async (): Promise<MixExplanation> => {
    const { explanation, error: aiError } = await explainMix(planLabel, mix)
    setMixNotes((prev) => ({ ...prev, [plan]: explanation }))
    if (aiError) setNotice(`${aiError} 숫자로 만든 기본 설명을 사용합니다.`)
    return explanation
  }

  const explainPlan = async (): Promise<void> => {
    setError(null)
    if (mix.rows.length === 0) {
      setError('설명할 담보가 없습니다. 담보를 체크해주세요.')
      return
    }
    setBusy('AI가 이 설계안의 장점을 정리하는 중…')
    try {
      const explanation = await requestPlanNote()
      if (explanation.source === 'ai') setNotice('AI 설명을 받았습니다.')
    } finally {
      setBusy(null)
    }
  }

  const downloadPlanExcel = async (): Promise<void> => {
    setError(null)
    if (mix.rows.length === 0) {
      setError('내려받을 담보가 없습니다. 담보를 체크해주세요.')
      return
    }
    try {
      // 설명을 아직 안 받았으면 기본 설명이라도 넣어 엑셀이 비지 않게 한다.
      const explanation = planNote ?? buildBasicExplanation(planLabel, mix)
      setBusy('엑셀을 만드는 중…')
      const blob = await buildPlanWorkbook({
        planLabel,
        companies: mixCompanies,
        mixRows: buildPlanMixRows(),
        mixPremium: mix.mixPremium,
        cheapestSingle: mix.cheapestSingle,
        savedVsSingle: mix.savedVsSingle,
        byCompanyTotal: mix.byCompany,
        explanation,
        rows: planListRows()
      })
      downloadBlob(blob, `${planLabel}_조합설계안_${stamp()}.xlsx`)
      setNotice(`${planLabel} 엑셀을 내려받았습니다.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '엑셀 파일을 만드는 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  const copyPlanNote = async (): Promise<void> => {
    const explanation = planNote ?? buildBasicExplanation(planLabel, mix)
    try {
      await navigator.clipboard.writeText(explanationToText(explanation))
      setNotice('설명을 복사했습니다.')
    } catch {
      setError('복사하지 못했습니다. 직접 선택해서 복사해주세요.')
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
              {/* 1) 어떤 보험을 볼지 고르기 */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PLANS.map((p) => {
                  const c = planCounts(p.key)
                  const active = plan === p.key
                  const none = c.total === 0
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setPlan(p.key)}
                      className={[
                        'rounded-2xl border-2 px-3 py-3 text-center transition',
                        active
                          ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                          : none
                            ? 'border-slate-800 bg-white opacity-50'
                            : 'border-slate-800 bg-white hover:border-indigo-300'
                      ].join(' ')}
                    >
                      <span className={['block text-[15px] font-extrabold', active ? 'text-indigo-700' : 'text-slate-100'].join(' ')}>
                        {p.label}
                      </span>
                      <span className="mt-0.5 block text-[12px] font-semibold text-slate-500 tabular-nums">
                        {none ? '없음' : `담보 ${c.total}개`}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* 2) 결론 — 담보마다 싼 회사로 나누면 얼마인가 */}
              {mix.rows.length > 0 ? (
                <div className="space-y-3 rounded-2xl border-2 border-indigo-300 bg-white p-4 shadow-sm">
                  <div>
                    <h3 className="text-[15px] font-extrabold text-slate-100">담보마다 싼 회사로 나누면?</h3>
                    <p className="mt-0.5 text-[12px] text-slate-500">
                      제안서 {mixCompanies.length}건을 담보 {mix.rows.length}개로 쪼개서 하나씩 더 싼 쪽을 골랐습니다
                    </p>
                  </div>

                  {/* 큰 숫자 — 얼마 내고, 얼마 아끼나 */}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl bg-[#0e1e3a] px-4 py-3 text-white">
                      <div className="text-[12px] font-semibold opacity-80">나눠서 가입하면 매달</div>
                      <div className="mt-0.5 text-[26px] font-extrabold leading-tight tabular-nums">
                        {mix.mixPremium ? won(mix.mixPremium) : '확인 필요'}
                      </div>
                    </div>
                    {mix.savedVsSingle !== null && mix.savedVsSingle > 0 && mix.cheapestSingle ? (
                      <div className="rounded-xl bg-emerald-600 px-4 py-3 text-white">
                        <div className="text-[12px] font-semibold opacity-90">한 회사에 다 넣는 것보다</div>
                        <div className="mt-0.5 text-[26px] font-extrabold leading-tight tabular-nums">
                          매달 {won(mix.savedVsSingle)} 아낌
                        </div>
                        <div className="mt-0.5 text-[11px] opacity-90">
                          1년이면 {won(mix.savedVsSingle * 12)} · {mix.cheapestSingle.company} 한 곳이면 {won(mix.cheapestSingle.premium)}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border-2 border-slate-800 bg-slate-950 px-4 py-3">
                        <div className="text-[12px] font-semibold text-slate-500">한 회사에 다 넣기</div>
                        <div className="mt-0.5 text-[14px] font-bold text-slate-300">
                          모든 담보를 가진 회사가 없어 비교하지 않았습니다
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 어느 회사에서 무엇을 사는지 — 결론을 한 줄로 */}
                  {planRoles.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-[12px] font-bold text-slate-300">어디서 무엇을 사나요</p>
                      <ul className="space-y-1">
                        {planRoles.map((role) => (
                          <li
                            key={role.company}
                            className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
                          >
                            <span className="text-[13px] font-extrabold text-slate-100">{role.company}</span>
                            <span className="text-[12px] font-semibold text-slate-500">
                              담보 {role.count}개 · 매달{' '}
                              <span className="font-extrabold tabular-nums text-slate-200">{won(role.premium)}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <p className="text-[11px] leading-relaxed text-slate-500">
                    아래 카드에서 담보마다 <span className="font-bold text-emerald-700">✓ 표시된 회사</span>가 고른 곳입니다.
                    같은 보장금액으로 맞춰 비교하고, 보장 범위가 다른 담보(뇌혈관질환과 뇌졸중 등)는 섞지 않습니다.
                  </p>

                  {/* AI 설명 */}
                  {planNote ? (
                    <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[13px] font-extrabold text-amber-900">{planNote.headline}</p>
                        <div className="flex items-center gap-1.5">
                          <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                            {planNote.source === 'ai' ? 'AI가 씀' : '기본 설명'}
                          </span>
                          <button type="button" onClick={copyPlanNote} className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100">
                            복사
                          </button>
                        </div>
                      </div>
                      <ol className="mt-2 space-y-1.5">
                        {planNote.points.map((point, i) => (
                          <li key={point} className="flex gap-2 text-[12px] leading-relaxed text-amber-900">
                            <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">{i + 1}</span>
                            <span>{point}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}

                  {/* 버튼 — 크게 */}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={explainPlan} disabled={Boolean(busy)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] font-extrabold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50">
                      <Sparkles className="h-4 w-4" /> 고객에게 설명할 말 3가지
                    </button>
                    <button type="button" onClick={downloadPlanExcel} disabled={Boolean(busy)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-slate-700 bg-white px-3 py-2.5 text-[13px] font-extrabold text-slate-200 transition hover:bg-slate-950 disabled:opacity-50">
                      <Download className="h-4 w-4" /> 엑셀로 받기
                    </button>
                  </div>
                </div>
              ) : null}

              {/* 3) 담보 카드 — 담보 하나에 카드 하나. 옆으로 넘기지 않고 세로로만 읽는다.
                  막대가 길면 비싼 곳. 숫자를 읽지 않아도 어디가 싼지 보이게 하는 게 목적이다. */}
              {coverageCards.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-1 px-1">
                    <h3 className="text-[14px] font-extrabold text-slate-100">담보별로 어디가 싼지</h3>
                    <p className="text-[11.5px] text-slate-500">돈이 많이 갈리는 담보부터 · 막대가 짧은 곳이 쌉니다</p>
                  </div>

                  <ul className="space-y-2">
                    {coverageCards.map(({ row, basis, ranking, pick, saving }) => (
                      <li
                        key={row.key}
                        className={[
                          'rounded-2xl border-2 bg-white p-3 shadow-sm transition',
                          row.checked ? 'border-slate-800' : 'border-slate-800 opacity-45'
                        ].join(' ')}
                      >
                        <label className="flex cursor-pointer items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={row.checked}
                            onChange={(e) => toggleCompareRow(row, e.target.checked)}
                            className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600"
                          />
                          <span className="flex-1">
                            <span className="block text-[15px] font-extrabold leading-tight text-slate-100">{row.label}</span>
                            <span className="mt-0.5 block text-[11.5px] text-slate-500">
                              {row.amountsDiffer
                                ? '회사마다 가입금액이 다릅니다 — 같은 금액으로 맞춰 비교했습니다'
                                : row.amountManwon
                                  ? `가입금액 ${row.amountManwon.toLocaleString('ko-KR')}만원`
                                  : '가입금액을 못 읽어 보험료로만 비교했습니다'}
                              {row.scopesDiffer ? ' · 회사마다 보장범위가 다릅니다' : ''}
                            </span>
                          </span>
                        </label>

                        <ol className="mt-2.5 space-y-2">
                          {ranking.ranked.map((offer) => {
                            const win = offer.company === pick
                            // 고른 회사와 견준 차이. 혹시 더 싼 곳이 있으면 그대로 말한다(숨기지 않는다).
                            const pickOffer = ranking.ranked.find((o) => o.company === pick)
                            const diff = row.amountsDiffer
                              ? offer.score - (pickOffer?.score ?? offer.score)
                              : offer.premiumWon - (pickOffer?.premiumWon ?? offer.premiumWon)
                            // 가입금액이 다른 줄은 단가로 견준다(칸 아래에 단위를 적어 둔다).
                            const head = row.amountsDiffer ? '단가 ' : ''
                            const gapText =
                              diff > 0
                                ? `${head}+${diff.toLocaleString('ko-KR')}원`
                                : diff < 0
                                  ? `${head}-${Math.abs(diff).toLocaleString('ko-KR')}원`
                                  : '같음'
                            return (
                              <li key={offer.company}>
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className={['text-[13px] font-bold', win ? 'text-emerald-700' : 'text-slate-300'].join(' ')}>
                                    {win ? '✓ ' : ''}
                                    {offer.company}
                                  </span>
                                  <span
                                    className={[
                                      'shrink-0 tabular-nums text-[15px] font-extrabold',
                                      win ? 'text-emerald-700' : 'text-slate-200'
                                    ].join(' ')}
                                  >
                                    {won(offer.premiumWon)}
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center gap-2">
                                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                                    <span
                                      className={['block h-full rounded-full', win ? 'bg-emerald-500' : 'bg-slate-600'].join(' ')}
                                      style={{ width: `${Math.max(8, Math.round(offer.ratio * 100))}%` }}
                                    />
                                  </span>
                                  <span
                                    className={[
                                      'w-[92px] shrink-0 text-right text-[11px] font-bold tabular-nums',
                                      win ? 'text-emerald-700' : 'text-slate-500'
                                    ].join(' ')}
                                  >
                                    {win ? '가장 쌈' : gapText}
                                  </span>
                                </div>
                                {row.amountsDiffer && offer.amountManwon ? (
                                  <div className="mt-0.5 text-[10.5px] text-slate-500">
                                    {offer.amountManwon.toLocaleString('ko-KR')}만원
                                    {offer.unitPrice ? ` · ${basis?.label} ${offer.unitPrice.toLocaleString('ko-KR')}원` : ''}
                                  </div>
                                ) : null}
                                {row.scopesDiffer ? (
                                  <div className="mt-0.5 text-[10.5px] text-slate-500">{row.byCompany[offer.company]?.scope}</div>
                                ) : null}
                              </li>
                            )
                          })}
                        </ol>

                        {saving && pick ? (
                          <p className="mt-2 rounded-xl bg-emerald-50 px-2.5 py-1.5 text-[12px] font-bold leading-relaxed text-emerald-800">
                            이 담보는 {pick} — 매달 {won(saving)} 아낍니다 (1년 {won(saving * 12)})
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* 한 곳에만 있는 담보 — 비교가 안 되니 카드로 만들지 않고 목록으로 접어 둔다. */}
              {soleRows.length > 0 ? (
                <details className="rounded-2xl border border-slate-800 bg-white shadow-sm">
                  <summary className="cursor-pointer px-4 py-3 text-[13px] font-bold text-slate-100">
                    한 회사에만 있는 담보 {soleRows.length}개
                    <span className="ml-1.5 text-[11px] font-medium text-slate-500">비교할 상대가 없습니다</span>
                  </summary>
                  <div className="space-y-1 border-t border-slate-800 px-3 py-2">
                    {soleRows.map((row) => {
                      const only = compareCompanies.find((c) => row.byCompany[c]?.premium)
                      const cell = only ? row.byCompany[only] : null
                      return (
                        <label
                          key={row.key}
                          className={[
                            'flex cursor-pointer flex-wrap items-center gap-2 rounded-xl border border-slate-800 px-2.5 py-2',
                            row.checked ? 'bg-white' : 'bg-slate-950 opacity-60'
                          ].join(' ')}
                        >
                          <input
                            type="checkbox"
                            checked={row.checked}
                            onChange={(e) => toggleCompareRow(row, e.target.checked)}
                            className="h-5 w-5 accent-indigo-600"
                          />
                          <span className="flex-1 text-[13px] font-bold text-slate-100">{row.label}</span>
                          {only ? (
                            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-bold text-indigo-700">{only}</span>
                          ) : null}
                          {cell?.amountManwon ? (
                            <span className="text-[11px] tabular-nums text-slate-500">
                              {cell.amountManwon.toLocaleString('ko-KR')}만원
                            </span>
                          ) : null}
                          <span className="text-[13px] font-extrabold tabular-nums text-slate-200">
                            {cell?.premium ? won(cell.premium) : '-'}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </details>
              ) : null}

              {/* 예전 표 — 익숙한 FC 를 위해 남기되 접어 둔다. 기본은 위 카드로 본다. */}
              {compareRows.length > 0 ? (
                <details className="rounded-2xl border border-slate-800 bg-white shadow-sm">
                  <summary className="cursor-pointer px-4 py-3 text-[13px] font-bold text-slate-100">
                    표로 한 번에 보기
                    <span className="ml-1.5 text-[11px] font-medium text-slate-500">
                      담보 {compareRows.length}개 × 회사 {compareCompanies.length}곳
                    </span>
                  </summary>
                  <div className="border-t border-slate-800">
                                {compareRows.length > 0 ? (
                    <div className="bg-white">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                        <div>
                          <h3 className="text-[14px] font-extrabold text-slate-100">보험사별 담보 비교표</h3>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            <span className="rounded bg-sky-100 px-1 font-bold text-blue-700">파란 칸</span>이 담보마다 고른 회사,{' '}
                            <span className="font-bold text-rose-600">빨간 숫자</span>가 제일 비싼 곳입니다 · 큰 숫자는 월 보험료,{' '}
                            아랫줄 작은 숫자는 같은 금액으로 맞췄을 때의 보험료(진단비 1,000만원당 · 소액담보 100만원당 · 입원일당 1만원당)
                          </p>
                        </div>
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => setAllChecked(true)} className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-200 hover:bg-slate-950">
                            <CheckSquare className="h-3.5 w-3.5" /> 모두 체크
                          </button>
                          <button type="button" onClick={() => setAllChecked(false)} className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-200 hover:bg-slate-950">
                            <Square className="h-3.5 w-3.5" /> 전체 해제
                          </button>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-[12px]">
                          <thead>
                            <tr>
                              <th className="sticky left-0 z-10 min-w-[200px] border-b-2 border-slate-800 bg-[#0e1e3a] px-3 py-2 text-left text-[12px] font-bold text-white">
                                담보 <span className="font-normal opacity-70">/ 가입금액</span>
                              </th>
                              {compareCompanies.map((company) => {
                                const total = compareTotals.get(company) ?? 0
                                const best = cheapestTotal !== null && total === cheapestTotal
                                const worst = dearestTotal !== null && total === dearestTotal && !best
                                return (
                                  <th key={company} className="min-w-[108px] border-b-2 border-l border-slate-800 bg-[#0e1e3a] px-2 py-2 text-center align-top">
                                    <div className="text-[12px] font-bold text-white">{company}</div>
                                    <div className={['mt-0.5 text-[16px] font-extrabold tabular-nums', best ? 'text-sky-300' : worst ? 'text-rose-300' : 'text-white'].join(' ')}>
                                      {total ? total.toLocaleString('ko-KR') : '-'}
                                    </div>
                                    {best ? (
                                      <div className="mt-0.5 inline-block rounded-full bg-sky-400 px-1.5 py-0.5 text-[9px] font-bold text-[#0e1e3a]">가장 쌈</div>
                                    ) : worst ? (
                                      <div className="mt-0.5 inline-block rounded-full bg-rose-400 px-1.5 py-0.5 text-[9px] font-bold text-[#0e1e3a]">가장 비쌈</div>
                                    ) : null}
                                  </th>
                                )
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {comparableRows.map((row, idx) => {
                              const values = compareCompanies
                                .map((c) => row.byCompany[c]?.premium)
                                .filter((v): v is number => typeof v === 'number' && v > 0)
                              const max = values.length > 1 ? Math.max(...values) : null
                              const pickedCompany =
                                mixPickByKey.get(row.key) ??
                                compareCompanies.find((c) => row.byCompany[c]?.premium === Math.min(...values))
                              // 담보 크기에 맞는 단가 단위(1,000만원당 / 100만원당 / 1만원당).
                              // 가입금액이 회사마다 달라도 어디가 싼지 한눈에 보게 하는 값이다.
                              const basis = unitBasis(row.amountManwon)
                              return (
                                <tr key={row.key} className={[row.checked ? '' : 'opacity-40', idx % 2 ? 'bg-slate-950/40' : ''].join(' ')}>
                                  <th className={['sticky left-0 z-10 border-b border-slate-800 px-3 py-2 text-left font-normal', idx % 2 ? 'bg-slate-950' : 'bg-white'].join(' ')}>
                                    <label className="flex cursor-pointer items-start gap-2">
                                      <input type="checkbox" checked={row.checked} onChange={(e) => toggleCompareRow(row, e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600" />
                                      <span className="flex-1">
                                        <span className="block text-[12.5px] font-bold leading-tight text-slate-100">{row.label}</span>
                                        <span className="mt-0.5 flex flex-wrap items-center gap-1">
                                          {row.amountManwon && !row.amountsDiffer ? (
                                            <span className="text-[11px] tabular-nums text-slate-500">
                                              {row.amountManwon.toLocaleString('ko-KR')}만원
                                            </span>
                                          ) : null}
                                          {basis ? (
                                            <span className="text-[11px] text-slate-600">아랫줄 = {basis.label}</span>
                                          ) : null}
                                          {row.amountsDiffer ? (
                                            <span className="rounded bg-sky-100 px-1 py-0.5 text-[9px] font-bold text-blue-700">회사마다 가입금액 다름</span>
                                          ) : null}
                                          {row.scopesDiffer ? (
                                            <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-800">회사마다 보장범위 다름</span>
                                          ) : null}
                                        </span>
                                      </span>
                                    </label>
                                  </th>
                                  {compareCompanies.map((company) => {
                                    const cell = row.byCompany[company]
                                    const v = cell?.premium ?? null
                                    // 단가는 그 회사가 실제로 가입한 금액으로 낸다.
                                    // 줄의 최대 금액으로 나누면 적게 가입한 회사가 싸 보인다.
                                    const unit = unitPriceAt(v, cell?.amountManwon ?? null, basis)
                                    const isPick = Boolean(v) && company === pickedCompany
                                    const isMax = max !== null && v === max && !isPick
                                    return (
                                      <td
                                        key={company}
                                        className={[
                                          'border-b border-l border-slate-800 px-2 py-2 text-center align-middle tabular-nums',
                                          !v ? 'text-slate-600' : isPick ? 'bg-sky-100 font-extrabold text-blue-700' : isMax ? 'font-bold text-rose-600' : 'font-semibold text-slate-200'
                                        ].join(' ')}
                                      >
                                        {v ? (
                                          <>
                                            {row.amountsDiffer && cell?.amountManwon ? (
                                              <span className="block text-[10px] font-semibold leading-tight opacity-70">
                                                {cell.amountManwon.toLocaleString('ko-KR')}만원
                                              </span>
                                            ) : null}
                                            <span className="block text-[13px]">{v.toLocaleString('ko-KR')}</span>
                                            {unit ? (
                                              <span className="mt-0.5 block text-[10px] font-semibold leading-tight opacity-60">
                                                {unit.toLocaleString('ko-KR')}
                                              </span>
                                            ) : null}
                                            {row.scopesDiffer ? (
                                              <span className="mt-0.5 block text-[9.5px] font-medium leading-tight opacity-70">{cell?.scope}</span>
                                            ) : null}
                                          </>
                                        ) : (
                                          <span className="text-[12px]">없음</span>
                                        )}
                                      </td>
                                    )
                                  })}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      <p className="border-t border-slate-800 px-4 py-2 text-[11px] leading-relaxed text-slate-500">
                        회사마다 담보 이름이 달라도 같은 자리 담보끼리 한 줄로 모았습니다. 가입금액이 회사마다 다르면 칸 위에 그
                        회사의 가입금액을, 보장범위가 다르면 칸 아래에 그 회사가 실제로 넣은 담보를 적어 뒀습니다.
                        칸 가운데 큰 숫자는 월 보험료, 그 아래 작은 숫자는 가입금액을 같게 맞췄을 때의 보험료라 회사끼리 바로 견줄 수 있습니다.
                        체크를 끄면 위 합계에서 빠집니다.
                      </p>
                    </div>
                  ) : null}

                  </div>
                </details>
              ) : null}
              {/* 4) 담보 그룹 — 접어두고, 필요할 때만 연다 */}
              {planGroups.length > 0 ? (
                <details className="rounded-2xl border border-slate-800 bg-white shadow-sm">
                  <summary className="cursor-pointer px-4 py-3 text-[13px] font-bold text-slate-100">
                    어떤 담보를 넣을지 고르기
                    <span className="ml-1.5 text-[11px] font-medium text-slate-500">
                      {isPlanDefault(plan, planPrefs) ? '기본 설정 그대로' : '내가 바꾼 설정 저장됨'}
                    </span>
                  </summary>
                  <div className="border-t border-slate-800 p-3">
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
                              'inline-flex items-center gap-1.5 rounded-xl border-2 px-3 py-2 text-[12px] font-bold transition',
                              on ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-800 bg-white text-slate-500'
                            ].join(' ')}
                          >
                            {on ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                            {g.label}
                            <span className="text-[11px] font-semibold tabular-nums opacity-70">{found}</span>
                          </button>
                        )
                      })}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => onSetAllGroups(true)} className="rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-950">모두 켜기</button>
                      <button type="button" onClick={() => onSetAllGroups(false)} className="rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-950">모두 끄기</button>
                      <button type="button" onClick={onResetPlan} className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-950">
                        <RotateCcw className="h-3.5 w-3.5" /> 기본으로
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">여기서 켜고 끈 설정은 저장돼서, 다음에 제안서를 올릴 때 그대로 적용됩니다.</p>
                  </div>
                </details>
              ) : null}

              {/* 5) 담보 하나하나 보기 — 평소엔 접어둔다 */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <span className="text-[12px] font-bold text-slate-500">
                  담보 하나하나 확인 · 체크 {current.checked}/{current.total}개
                </span>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setAllChecked(true)} className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-950">
                    <CheckSquare className="h-3.5 w-3.5" /> 모두 체크
                  </button>
                  <button type="button" onClick={() => setAllChecked(false)} className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-950">
                    <Square className="h-3.5 w-3.5" /> 전체 해제
                  </button>
                </div>
              </div>

              {docs.map((doc) => {
                const rows = itemsOfPlan(doc, plan)
                // 평소엔 접어 둔다. 결과(쪼개기)가 먼저 보이고, 확인할 때만 펼친다.
                return (
                  <details key={doc.id} className="rounded-2xl border border-slate-800 bg-white shadow-sm">
                    <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-bold text-slate-100">
                      {doc.company || '회사 미확인'} <span className="font-normal text-slate-500">— 담보 {rows.length}개 중 {rows.filter((it) => it.checked).length}개 체크</span>
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
