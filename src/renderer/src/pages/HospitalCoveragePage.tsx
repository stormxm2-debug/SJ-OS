import { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { BedDouble, Upload, FileText, Trash2, Download, RotateCcw, FileSpreadsheet, CheckSquare, Square } from 'lucide-react'
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
import { inspectTemplate, fillTemplate, downloadBlob, type SheetInfo, type MatrixEntry } from '@renderer/services/commercial/templateFill'

/**
 * 입원·간병 합계표 — 가입제안서 PDF 여러 건에서 입원·간병 담보를 뽑아 고객 엑셀 양식 항목으로 분류하고,
 * 상황별 하루 입원 시 받는 금액을 전 보험사 합산한다. 제안서는 이 화면(브라우저 메모리)에서만 처리한다.
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

async function analyzeProposal(file: File): Promise<ProposalDoc> {
  const { pages, scannedPages } = await extractPdfPages(await file.arrayBuffer())
  const { rows, warnings } = parseCoverageTable(pages)
  const company = detectCompany(pages, file.name) ?? ''

  const classified = rows.map((row, index) => ({ row, index, ...classifyCoverage(row.coverageName, row.amount) }))
  const items: CoverageItem[] = classified.map((c) => ({
    ...c.row,
    key: `${file.name}-${c.index}`,
    choice: choiceOf(c.categories),
    sideChoice: c.sides.length === 2 ? '양쪽' : c.sides[0],
    daily: c.value === null ? '' : String(c.value),
    needsReview: c.needsReview,
    reason: c.reason,
    checked: c.categories.length > 0
  }))

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
  const [pending, setPending] = useState<File[]>([])
  const [docs, setDocs] = useState<ProposalDoc[]>([])
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [includeGeneral, setIncludeGeneral] = useState(false)
  const [template, setTemplate] = useState<TemplateState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const templateInput = useRef<HTMLInputElement>(null)

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
        results.push(await analyzeProposal(file))
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

  const setAllChecked = (checked: boolean): void =>
    setDocs((prev) =>
      prev.map((d) => ({
        ...d,
        items: d.items.map((it) => ({ ...it, checked: checked && categoriesOf(it.choice).length > 0 }))
      }))
    )

  const resetAll = (): void => {
    if (!window.confirm('올린 제안서와 선택 내용을 모두 지울까요?')) return
    setDocs([])
    setPending([])
    setOverrides({})
    setTemplate(null)
    setError(null)
    setNotice(null)
    setTab('upload')
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

  const companies = matrix.map((m) => m.company)
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

  /* ---------- 내려받기 ---------- */

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
    setBusy('엑셀 양식을 채우는 중…')
    try {
      const entries: MatrixEntry[] = matrix.map((m) => {
        const cells: MatrixEntry['cells'] = {}
        for (const category of CATEGORIES) {
          const sides: Partial<Record<Side, number | string>> = {}
          for (const side of SIDES) {
            const raw = valueOf(m.company, category, side)
            if (raw === '') continue
            sides[side] = category === '간병페이백' || Number.isNaN(Number(raw)) ? raw : Number(raw)
          }
          if (Object.keys(sides).length) cells[category] = sides
        }
        const premium = Number(premiumOf(m.company))
        return { company: m.company, premium: premiumOf(m.company) !== '' && Number.isFinite(premium) ? premium : null, cells }
      })
      const result = await fillTemplate({
        template: template.buffer,
        matrix: entries,
        sheetName: template.sheetName,
        summary,
        paybackNotes
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

  const downloadList = (): void => {
    const rows = docs.flatMap((d) =>
      d.items.filter((it) => it.checked).map((it) => [d.company, it.coverageName, it.amount, it.term, it.premium])
    )
    if (rows.length === 0) {
      setError('체크된 담보가 없습니다.')
      return
    }
    const sheet = XLSX.utils.aoa_to_sheet([['보험사', '담보명', '가입금액', '납입기간·만기', '보험료'], ...rows])
    sheet['!cols'] = [{ wch: 12 }, { wch: 60 }, { wch: 14 }, { wch: 18 }, { wch: 12 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, '담보정리')
    XLSX.writeFile(wb, `가입제안서_담보정리_${stamp()}.xlsx`)
  }

  /* ---------- 화면 ---------- */

  return (
    <div className="space-y-4 pb-16">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-[#0e1e3a] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <BedDouble className="h-4 w-4 text-[#e6c877]" />
          <h1 className="text-sm font-extrabold text-white">입원·간병 합계표</h1>
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
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-700">확인 필요</span>
                  <span className="rounded-full border border-slate-800 bg-slate-950 px-2.5 py-0.5 font-semibold text-slate-500">양식에 없는 담보(기본 해제)</span>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setAllChecked(true)} className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-950">
                    <CheckSquare className="h-3.5 w-3.5" /> 분류된 담보 모두 체크
                  </button>
                  <button type="button" onClick={() => setAllChecked(false)} className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-950">
                    <Square className="h-3.5 w-3.5" /> 전체 해제
                  </button>
                </div>
              </div>

              {docs.map((doc) => (
                <details key={doc.id} open className="rounded-2xl border border-slate-800 bg-white shadow-sm">
                  <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-bold text-slate-100">
                    {doc.company || '회사 미확인'} <span className="font-normal text-slate-500">— {doc.fileName} (체크 {doc.items.filter((it) => it.checked).length}/{doc.items.length})</span>
                  </summary>
                  <div className="overflow-x-auto border-t border-slate-800">
                    <table className="w-full min-w-[900px] text-left text-[12px]">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-950 text-[11px] text-slate-500">
                          <th className="px-2 py-2"></th>
                          <th className="px-2 py-2 font-semibold">담보명</th>
                          <th className="px-2 py-2 font-semibold">가입금액</th>
                          <th className="px-2 py-2 font-semibold">납입기간·만기</th>
                          <th className="px-2 py-2 font-semibold">보험료</th>
                          <th className="px-2 py-2 font-semibold">양식 항목</th>
                          <th className="px-2 py-2 font-semibold">구분</th>
                          <th className="px-2 py-2 font-semibold">일당(만원)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {doc.items.map((it) => {
                          const unmatched = categoriesOf(it.choice).length === 0
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
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
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
            {/* 최종 합계표 */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-end justify-between gap-2 px-1">
                <div>
                  <h2 className="text-sm font-bold text-slate-100">최종 합계표 <span className="text-[11px] font-medium text-slate-500">하루 입원 시 받는 금액(만원) · 체크한 담보 전 보험사 합산</span></h2>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-300">
                  <input type="checkbox" checked={includeGeneral} onChange={(e) => setIncludeGeneral(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
                  상급병원 합계에 종합병원일당도 더하기 (약관상 해당 시)
                </label>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-white shadow-sm">
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950 text-[11px] text-slate-500">
                      <th className="px-3 py-2.5 font-semibold">상황</th>
                      <th className="px-3 py-2.5 text-right font-semibold">상해</th>
                      <th className="px-3 py-2.5 text-right font-semibold">질병</th>
                      <th className="px-3 py-2.5 font-semibold">합산 항목</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((row) => (
                      <tr key={row.label} className="border-b border-slate-800 last:border-0">
                        <td className="px-3 py-2 font-semibold whitespace-nowrap text-slate-100">{row.label}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-100">{row.상해 ? `${row.상해}만원` : ''}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-100">{row.질병 ? `${row.질병}만원` : ''}</td>
                        <td className="px-3 py-2 text-[11px] text-slate-500">{row.parts.join(' + ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

            {/* 항목별 보험료 */}
            <details className="rounded-2xl border border-slate-800 bg-white shadow-sm">
              <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-bold text-slate-100">항목별 보험료 (체크한 담보 기준, 월 보험료)</summary>
              <div className="overflow-x-auto border-t border-slate-800">
                <table className="w-full min-w-[480px] text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950 text-[11px] text-slate-500">
                      <th className="px-3 py-2 font-semibold">항목</th>
                      {companies.map((c) => <th key={c} className="px-3 py-2 text-right font-semibold">{c}</th>)}
                      <th className="px-3 py-2 text-right font-semibold">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORIES.filter((c) => c !== '간병페이백').map((category) => {
                      const values = companies.map((c) => premiumTable.get(c)?.get(category) ?? 0)
                      const total = values.reduce((a, b) => a + b, 0)
                      if (!total) return null
                      return (
                        <tr key={category} className="border-b border-slate-800">
                          <td className="px-3 py-1.5 font-semibold text-slate-200">{category}</td>
                          {values.map((v, i) => <td key={companies[i]} className="px-3 py-1.5 text-right tabular-nums">{won(v)}</td>)}
                          <td className="px-3 py-1.5 text-right font-bold tabular-nums">{won(total)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </details>

            {/* 양식 미리보기 */}
            <details className="rounded-2xl border border-slate-800 bg-white shadow-sm">
              <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-bold text-slate-100">양식 미리보기 (회사별 값 · 직접 수정 가능)</summary>
              <p className="px-4 pt-2 text-[11px] text-slate-500">농협처럼 일당을 못 읽은 칸(빨간 칸)은 여기에 직접 입력하세요.</p>
              <div className="overflow-x-auto p-2">
                <table className="text-center text-[12px]">
                  <thead>
                    <tr className="text-[11px] text-slate-500">
                      <th className="sticky left-0 bg-white px-2 py-1 text-left">항목</th>
                      {companies.map((c) => <th key={c} colSpan={2} className="border border-slate-800 px-2 py-1 font-bold text-slate-200">{c}</th>)}
                    </tr>
                    <tr className="text-[10px] text-slate-500">
                      <th className="sticky left-0 bg-white"></th>
                      {companies.flatMap((c) => SIDES.map((s) => <th key={`${c}-${s}`} className="border border-slate-800 px-2 py-0.5 font-medium">{s}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORIES.map((category) => (
                      <tr key={category}>
                        <th className="sticky left-0 whitespace-nowrap bg-white px-2 py-1 text-left text-[12px] font-semibold text-slate-200">{category}</th>
                        {companies.flatMap((company) =>
                          SIDES.map((side) => {
                            const entry = matrix.find((m) => m.company === company)
                            const hasAny = Boolean(entry && Object.keys(entry.cells[category] ?? {}).length)
                            const key = overrideKey(company, category, side)
                            const value = valueOf(company, category, side)
                            const needsInput = category !== '간병페이백' && !value && docs.some(
                              (d) => (d.company.trim() || '회사 미확인') === company && d.items.some((it) => it.checked && it.daily === '' && categoriesOf(it.choice).includes(category))
                            )
                            return (
                              <td key={key} className="border border-slate-800 p-0.5">
                                <input value={value} onChange={(e) => setOverrides((prev) => ({ ...prev, [key]: e.target.value.trim() }))}
                                  className={['w-14 rounded px-1 py-0.5 text-center text-[12px] tabular-nums outline-none focus:bg-white', needsInput ? 'bg-rose-50' : hasAny ? '' : 'bg-transparent'].join(' ')} />
                              </td>
                            )
                          })
                        )}
                      </tr>
                    ))}
                    <tr>
                      <th className="sticky left-0 bg-white px-2 py-1 text-left text-[12px] font-semibold text-slate-200">보험료</th>
                      {companies.map((company) => {
                        const key = overrideKey(company, '보험료', '')
                        return (
                          <td key={key} colSpan={2} className="border border-slate-800 p-0.5">
                            <input value={premiumOf(company)} onChange={(e) => setOverrides((prev) => ({ ...prev, [key]: e.target.value.trim() }))}
                              className="w-full rounded px-1 py-0.5 text-center text-[12px] tabular-nums outline-none" />
                          </td>
                        )
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>

            {/* 엑셀 받기 */}
            <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-bold text-slate-100">엑셀 받기</h2>
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
              <p className="mt-2 text-[11px] text-slate-500">양식의 기존 표·수식은 그대로 두고 값만 채웁니다. 합계표와 페이백 안내는 시트 아래에 추가됩니다.</p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={downloadList} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-white px-3 py-2 text-[12px] font-semibold text-slate-200 hover:bg-slate-950">
                  <Download className="h-3.5 w-3.5" /> 담보 목록만 받기
                </button>
                <button type="button" disabled={Boolean(busy)} onClick={() => void downloadTemplate()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e1e3a] px-3 py-2 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-50">
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
          <button type="button" disabled={Boolean(busy)} onClick={() => void downloadTemplate()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e1e3a] px-3 py-1.5 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-50">
            <Download className="h-3.5 w-3.5" /> 양식에 채워서 받기
          </button>
        </div>
      ) : null}
    </div>
  )
}
