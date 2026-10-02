import type { Workbook, Worksheet, CellValue } from 'exceljs'
import type { Category, Side, SummaryRow, PaybackNote } from './hospitalCoverage'

/**
 * 고객 엑셀 양식 채우기 (브라우저 메모리에서 처리 — 서버 전송 없음).
 *
 * 양식 파일을 그대로 열어 값만 채운다. 서식·수식·열 너비는 건드리지 않는다.
 * 양식마다 항목 열 위치·시트 구성이 달라 "회사명" 칸을 찾아 기준을 잡는다.
 * 회사마다 두 칸(왼쪽 상해 / 오른쪽 질병). exceljs 는 엑셀을 다룰 때만 불러온다.
 */

const COMPANY_PAIRS = 11

export interface SheetInfo {
  name: string
  companies: string[]
}

export interface MatrixEntry {
  company: string
  premium: number | null
  cells: Partial<Record<Category, Partial<Record<Side, number | string>>>>
}

interface Layout {
  companyRow: number
  labelColumn: number
  rowByLabel: Map<string, number>
  slots: { left: number; right: number; name: string }[]
}

async function loadExcelJs(): Promise<typeof import('exceljs')> {
  const mod = await import('exceljs')
  // 번들 방식에 따라 default 로 감싸져 오는 경우가 있다.
  return ((mod as unknown as { default?: typeof import('exceljs') }).default ?? mod) as typeof import('exceljs')
}

async function loadWorkbook(buffer: ArrayBuffer): Promise<Workbook> {
  const ExcelJS = await loadExcelJs()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  return workbook
}

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('')
    if ('text' in value && typeof value.text === 'string') return value.text
    if ('result' in value && value.result !== undefined) return String(value.result)
    return ''
  }
  return String(value)
}

const norm = (value: CellValue): string => cellText(value).replace(/\s/g, '')

function findLayout(sheet: Worksheet): Layout | null {
  let companyRow = 0
  let labelColumn = 0
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (companyRow) return
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (!companyRow && norm(cell.value) === '회사명') {
        companyRow = rowNumber
        labelColumn = colNumber
      }
    })
  })
  if (!companyRow) return null

  const rowByLabel = new Map<string, number>()
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === companyRow) return
    const label = norm(row.getCell(labelColumn).value)
    if (label && !rowByLabel.has(label)) rowByLabel.set(label, rowNumber)
  })

  const slots = Array.from({ length: COMPANY_PAIRS }, (_, i) => {
    const left = labelColumn + 1 + i * 2
    return { left, right: left + 1, name: norm(sheet.getRow(companyRow).getCell(left).value) }
  })
  return { companyRow, labelColumn, rowByLabel, slots }
}

// 양식 안에서 담보표가 있는 시트 목록(이미 적힌 회사 포함).
export async function inspectTemplate(buffer: ArrayBuffer): Promise<SheetInfo[]> {
  const workbook = await loadWorkbook(buffer)
  const sheets: SheetInfo[] = []
  for (const sheet of workbook.worksheets) {
    const layout = findLayout(sheet)
    if (layout) sheets.push({ name: sheet.name, companies: layout.slots.filter((s) => s.name).map((s) => s.name) })
  }
  return sheets
}

function chooseSheet(workbook: Workbook, sheetName: string): Worksheet | null {
  const wanted = sheetName ? workbook.worksheets.find((s) => s.name === sheetName) : undefined
  if (wanted && findLayout(wanted)) return wanted
  // 이미 회사가 많이 적혀 있는 시트를 우선한다(빈 사본 시트에 잘못 채우지 않도록).
  let best: Worksheet | null = null
  let bestScore = -1
  for (const sheet of workbook.worksheets) {
    const layout = findLayout(sheet)
    if (!layout) continue
    const score = layout.slots.filter((s) => s.name).length
    if (score > bestScore) {
      best = sheet
      bestScore = score
    }
  }
  return best
}

// 기존 표와 수식은 그대로 두고, 표 바로 아래에 회사별 합계(같은 회사 칸)·페이백 안내·요약 설명을 덧붙인다.
function writeSummaryBlock(
  sheet: Worksheet,
  labelColumn: number,
  slotByCompany: Map<string, { left: number; right: number }>,
  summary: SummaryRow[],
  notes: PaybackNote[],
  summaryLines: string[]
): void {
  if (summary.length === 0 && notes.length === 0 && summaryLines.length === 0) return
  let rowNumber = sheet.rowCount + 2
  const put = (row: number, col: number, value: CellValue, bold = false): void => {
    const cell = sheet.getRow(row).getCell(col)
    cell.value = value
    if (bold) cell.font = { ...(cell.font ?? {}), bold: true }
  }

  if (summary.length > 0 && slotByCompany.size > 0) {
    put(rowNumber++, labelColumn, '합계 (하루 입원 시 받는 금액, 만원)', true)
    for (const row of summary) {
      put(rowNumber, labelColumn, row.label, true)
      for (const [company, slot] of slotByCompany) {
        const totals = row.byCompany[company]
        if (!totals) continue
        if (totals.상해) put(rowNumber, slot.left, totals.상해)
        if (totals.질병) put(rowNumber, slot.right, totals.질병)
      }
      rowNumber++
    }
    rowNumber++
  }
  if (notes.length > 0) {
    put(rowNumber++, labelColumn, '간병 페이백 안내', true)
    for (const note of notes) {
      put(rowNumber, labelColumn, note.company)
      put(rowNumber, labelColumn + 1, note.text)
      rowNumber++
    }
    rowNumber++
  }
  if (summaryLines.length > 0) {
    put(rowNumber++, labelColumn, '이 보험의 장점', true)
    for (const line of summaryLines) put(rowNumber++, labelColumn, line)
  }
}

export async function fillTemplate(args: {
  template: ArrayBuffer
  matrix: MatrixEntry[]
  sheetName: string
  summary: SummaryRow[]
  paybackNotes: PaybackNote[]
  summaryLines?: string[]
}): Promise<{ blob: Blob; sheetName: string; skippedCompanies: string[] }> {
  const workbook = await loadWorkbook(args.template)
  const sheet = chooseSheet(workbook, args.sheetName)
  if (!sheet) throw new Error("엑셀 양식에서 '회사명' 칸이 있는 시트를 찾지 못했습니다.")
  const layout = findLayout(sheet)
  if (!layout) throw new Error("엑셀 양식에서 '회사명' 칸이 있는 시트를 찾지 못했습니다.")

  const used = new Set<number>()
  const skippedCompanies: string[] = []
  const slotByCompany = new Map<string, { left: number; right: number }>()

  for (const entry of args.matrix) {
    const company = entry.company.trim()
    if (!company) continue
    const compact = company.replace(/\s/g, '')
    const slot =
      layout.slots.find((s) => s.name === compact && !used.has(s.left)) ??
      layout.slots.find((s) => !s.name && !used.has(s.left))
    if (!slot) {
      skippedCompanies.push(company)
      continue
    }
    used.add(slot.left)
    slotByCompany.set(entry.company, slot)
    if (!slot.name) {
      sheet.getRow(layout.companyRow).getCell(slot.left).value = company
      slot.name = compact
    }

    for (const [label, sides] of Object.entries(entry.cells)) {
      const rowNumber = layout.rowByLabel.get(label.replace(/\s/g, ''))
      if (!rowNumber || !sides) continue
      for (const [side, value] of Object.entries(sides)) {
        if (value === '' || value === undefined) continue
        sheet.getRow(rowNumber).getCell(side === '질병' ? slot.right : slot.left).value = value
      }
    }

    const premiumRow = layout.rowByLabel.get('보험료')
    if (premiumRow && entry.premium !== null && Number.isFinite(entry.premium)) {
      sheet.getRow(premiumRow).getCell(slot.left).value = entry.premium
      sheet.getRow(premiumRow).getCell(slot.right).value = entry.premium
    }
  }

  writeSummaryBlock(sheet, layout.labelColumn, slotByCompany, args.summary, args.paybackNotes, args.summaryLines ?? [])
  // 총보험료·입원일당 합계 같은 수식이 엑셀을 열 때 바로 다시 계산되도록 한다.
  workbook.calcProperties = { ...workbook.calcProperties, fullCalcOnLoad: true }

  const out = await workbook.xlsx.writeBuffer()
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  return { blob, sheetName: sheet.name, skippedCompanies }
}

export interface CoverageListRow {
  company: string
  coverageName: string
  amount: string
  term: string
  premium: string
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// A4 가로로 인쇄되도록 설정한다. onePage 면 한 장에 모두 들어가게 줄인다.
function setA4Landscape(sheet: Worksheet, lastColumn: number, lastRow: number, onePage: boolean): void {
  sheet.pageSetup = {
    ...sheet.pageSetup,
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: onePage ? 1 : 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    printArea: `A1:${sheet.getColumn(lastColumn).letter}${lastRow}`
  }
}

// 양식 없이 바로 받는 정리 엑셀.
// '합계표' 시트(A4 가로): 회사별 담보 표 → 바로 아래 회사별 합계 → 간병 페이백 → 이 보험의 장점. '담보목록' 시트: 원문 담보.
export async function buildSummaryWorkbook(args: {
  matrix: MatrixEntry[] // 보험료 낮은 순
  categories: readonly Category[]
  summary: SummaryRow[]
  paybackNotes: PaybackNote[]
  summaryLines: string[]
  rows: CoverageListRow[]
}): Promise<Blob> {
  const ExcelJS = await loadExcelJs()
  const workbook = new ExcelJS.Workbook()

  const NAVY = 'FF0E1E3A'
  const GOLD_SOFT = 'FFFBF3DC'
  const GRAY_SOFT = 'FFF3F5F9'
  const line = { style: 'thin' as const, color: { argb: 'FFC5CCD8' } }
  const boxed = { top: line, left: line, bottom: line, right: line }
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
  const font = 'Malgun Gothic'

  const sheet = workbook.addWorksheet('합계표', { views: [{ showGridLines: false }] })
  const companyCount = Math.max(args.matrix.length, 1)
  const lastCol = 1 + companyCount * 2
  // A4 가로 한 장 너비(약 140자)를 회사 칸이 나눠 쓰도록 폭을 정한다.
  const valueWidth = Math.max(8, Math.min(26, Math.floor((140 - 24) / (companyCount * 2))))
  const mergedWidth = valueWidth * companyCount * 2
  const linesFor = (text: string, width: number): number => Math.max(1, Math.ceil((text.length * 1.9) / width))
  sheet.getColumn(1).width = 24
  for (let c = 2; c <= lastCol; c++) sheet.getColumn(c).width = valueWidth

  const style = (row: number, col: number, opts: { bold?: boolean; color?: string; bg?: string; size?: number; align?: 'left' | 'center' | 'right'; numFmt?: string; wrap?: boolean } = {}): void => {
    const cell = sheet.getCell(row, col)
    cell.font = { name: font, size: opts.size ?? 10, bold: Boolean(opts.bold), color: opts.color ? { argb: opts.color } : undefined }
    cell.alignment = { horizontal: opts.align ?? 'center', vertical: 'middle', wrapText: Boolean(opts.wrap) }
    cell.border = boxed
    if (opts.bg) cell.fill = fill(opts.bg)
    if (opts.numFmt) cell.numFmt = opts.numFmt
  }

  /* 제목 */
  let r = 1
  sheet.mergeCells(r, 1, r, lastCol)
  sheet.getCell(r, 1).value = '가입제안서 담보 정리 — 입원·간병 보장 비교'
  sheet.getCell(r, 1).font = { name: font, size: 16, bold: true, color: { argb: NAVY } }
  sheet.getCell(r, 1).alignment = { horizontal: 'left', vertical: 'middle' }
  sheet.getRow(r).height = 28
  r++
  sheet.mergeCells(r, 1, r, lastCol)
  const d = new Date()
  sheet.getCell(r, 1).value = `작성일 ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} · 보험사는 월 보험료 낮은 순 · 금액 단위: 일당 만원 / 보험료 원`
  sheet.getCell(r, 1).font = { name: font, size: 9, color: { argb: 'FF6B7280' } }
  r += 2

  /* 회사별 담보 표 */
  const nameRow = r
  const sideRow = r + 1
  sheet.mergeCells(nameRow, 1, sideRow, 1)
  sheet.getCell(nameRow, 1).value = '항목'
  args.matrix.forEach((entry, i) => {
    const left = 2 + i * 2
    sheet.mergeCells(nameRow, left, nameRow, left + 1)
    sheet.getCell(nameRow, left).value = entry.company
    sheet.getCell(sideRow, left).value = '상해'
    sheet.getCell(sideRow, left + 1).value = '질병'
  })
  for (let c = 1; c <= lastCol; c++) {
    style(nameRow, c, { bold: true, color: 'FFFFFFFF', bg: NAVY, size: 11 })
    style(sideRow, c, { bold: true, bg: GRAY_SOFT, size: 9 })
  }
  sheet.getRow(nameRow).height = 22
  r = sideRow + 1

  const writeValues = (label: string, valueAt: (entry: MatrixEntry, side: Side) => number | string | undefined, opts: { bg?: string; bold?: boolean } = {}): void => {
    sheet.getCell(r, 1).value = label
    style(r, 1, { bold: true, align: 'left', bg: opts.bg })
    args.matrix.forEach((entry, i) => {
      ;(['상해', '질병'] as Side[]).forEach((side, j) => {
        const value = valueAt(entry, side)
        if (value !== undefined && value !== '' && value !== 0) sheet.getCell(r, 2 + i * 2 + j).value = value
        style(r, 2 + i * 2 + j, { bg: opts.bg, bold: opts.bold })
      })
    })
    sheet.getRow(r).height = 18
    r++
  }

  for (const category of args.categories) writeValues(category, (entry, side) => entry.cells[category]?.[side])

  // 월 보험료: 회사당 두 칸을 합쳐 한 번만.
  sheet.getCell(r, 1).value = '월 보험료'
  style(r, 1, { bold: true, align: 'left', bg: GRAY_SOFT })
  args.matrix.forEach((entry, i) => {
    const left = 2 + i * 2
    sheet.mergeCells(r, left, r, left + 1)
    if (entry.premium !== null) sheet.getCell(r, left).value = entry.premium
    style(r, left, { bold: true, bg: GRAY_SOFT, numFmt: '#,##0"원"' })
    style(r, left + 1, { bg: GRAY_SOFT })
  })
  sheet.getRow(r).height = 20
  r++

  /* 회사별 합계 — 같은 표 바로 아래 */
  if (args.summary.length > 0) {
    sheet.mergeCells(r, 1, r, lastCol)
    sheet.getCell(r, 1).value = '합계 (하루 입원 시 받는 금액 · 만원)'
    for (let c = 1; c <= lastCol; c++) style(r, c, { bold: true, color: 'FFFFFFFF', bg: NAVY, align: 'left' })
    sheet.getRow(r).height = 20
    r++
    for (const row of args.summary) {
      writeValues(row.label, (entry, side) => row.byCompany[entry.company]?.[side], { bg: GOLD_SOFT, bold: true })
    }
  }
  let lastRow = r - 1

  /* 간병 페이백 */
  if (args.paybackNotes.length > 0) {
    r++
    sheet.getCell(r, 1).value = '간병 페이백 안내'
    sheet.getCell(r, 1).font = { name: font, size: 11, bold: true, color: { argb: NAVY } }
    r++
    for (const note of args.paybackNotes) {
      sheet.getCell(r, 1).value = note.company
      style(r, 1, { bold: true, align: 'left' })
      sheet.mergeCells(r, 2, r, lastCol)
      sheet.getCell(r, 2).value = note.text
      style(r, 2, { align: 'left', wrap: true })
      sheet.getRow(r).height = linesFor(note.text, mergedWidth) * 15 + 6
      r++
    }
    lastRow = r - 1
  }

  /* 이 보험의 장점 */
  if (args.summaryLines.length > 0) {
    r++
    sheet.getCell(r, 1).value = '이 보험의 장점'
    sheet.getCell(r, 1).font = { name: font, size: 11, bold: true, color: { argb: NAVY } }
    r++
    for (const text of args.summaryLines) {
      sheet.mergeCells(r, 1, r, lastCol)
      sheet.getCell(r, 1).value = text
      const isHeading = text.startsWith('[')
      sheet.getCell(r, 1).font = { name: font, size: 10, bold: isHeading, color: isHeading ? { argb: NAVY } : undefined }
      sheet.getCell(r, 1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
      sheet.getRow(r).height = linesFor(text, mergedWidth + 24) * 15 + 3
      r++
    }
    lastRow = r - 1
  }

  setA4Landscape(sheet, lastCol, lastRow, true)

  /* 담보목록 */
  const list = workbook.addWorksheet('담보목록')
  list.columns = [
    { header: '보험사', key: 'company', width: 12 },
    { header: '담보명', key: 'coverageName', width: 60 },
    { header: '가입금액', key: 'amount', width: 14 },
    { header: '납입기간·만기', key: 'term', width: 20 },
    { header: '보험료(원)', key: 'premium', width: 12 }
  ]
  list.getRow(1).font = { bold: true }
  for (const row of args.rows) {
    const digits = row.premium.replace(/[^\d]/g, '')
    const added = list.addRow({ ...row, premium: digits && /^[\d,\s원]+$/.test(row.premium) ? Number(digits) : row.premium })
    added.getCell('premium').numFmt = '#,##0'
  }
  list.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, args.rows.length + 1), column: 5 } }
  list.views = [{ state: 'frozen', ySplit: 1 }]
  setA4Landscape(list, 5, Math.max(1, args.rows.length + 1), false)

  const out = await workbook.xlsx.writeBuffer()
  return new Blob([out], { type: XLSX_MIME })
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* ---------- 플랜별 엑셀 (종합·운전자·실손) ---------- */

export interface PlanMixRow {
  label: string
  company: string
  coverageName: string
  amountManwon: number | null
  premiumWon: number | null
  unitPrice: number | null
  needsReview: boolean
  soleOffer: boolean
  /** 회사별 보험료(원) — 비교표에 그대로 깐다. */
  byCompany: Record<string, number | null>
}

/**
 * 플랜 하나를 엑셀로 내려받는다. 시트 3장:
 *  1) 조합 설계안 — 담보별로 고른 회사와 보험료, 합계, 절감액, 이 설계안의 장점
 *  2) 담보 비교   — 담보 × 회사 보험료 매트릭스 (고른 칸은 강조)
 *  3) 담보목록    — 제안서 원문 그대로
 */
export async function buildPlanWorkbook(args: {
  planLabel: string
  companies: string[]
  mixRows: PlanMixRow[]
  mixPremium: number
  cheapestSingle: { company: string; premium: number } | null
  savedVsSingle: number | null
  byCompanyTotal: { company: string; premium: number; rowCount: number }[]
  explanation: { headline: string; points: string[] }
  rows: CoverageListRow[]
}): Promise<Blob> {
  const ExcelJS = await loadExcelJs()
  const workbook = new ExcelJS.Workbook()

  const NAVY = 'FF0E1E3A'
  const GOLD_SOFT = 'FFFBF3DC'
  const GRAY_SOFT = 'FFF3F5F9'
  const PICK = 'FFE8F0FE'
  const line = { style: 'thin' as const, color: { argb: 'FFC5CCD8' } }
  const boxed = { top: line, left: line, bottom: line, right: line }
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
  const font = 'Malgun Gothic'
  const d = new Date()
  const today = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`

  const styleCell = (
    sheet: Worksheet,
    row: number,
    col: number,
    opts: { bold?: boolean; color?: string; bg?: string; size?: number; align?: 'left' | 'center' | 'right'; numFmt?: string; wrap?: boolean } = {}
  ): void => {
    const cell = sheet.getCell(row, col)
    cell.font = { name: font, size: opts.size ?? 10, bold: Boolean(opts.bold), color: opts.color ? { argb: opts.color } : undefined }
    cell.alignment = { horizontal: opts.align ?? 'center', vertical: 'middle', wrapText: Boolean(opts.wrap) }
    cell.border = boxed
    if (opts.bg) cell.fill = fill(opts.bg)
    if (opts.numFmt) cell.numFmt = opts.numFmt
  }

  /* ===== 1) 조합 설계안 ===== */
  const mix = workbook.addWorksheet('조합 설계안', { views: [{ showGridLines: false }] })
  const MIX_COLS = 6
  mix.getColumn(1).width = 30
  mix.getColumn(2).width = 16
  mix.getColumn(3).width = 14
  mix.getColumn(4).width = 14
  mix.getColumn(5).width = 16
  mix.getColumn(6).width = 34

  let r = 1
  mix.mergeCells(r, 1, r, MIX_COLS)
  mix.getCell(r, 1).value = `${args.planLabel} — 조합 설계안 (담보별 최저 보험료)`
  mix.getCell(r, 1).font = { name: font, size: 16, bold: true, color: { argb: NAVY } }
  mix.getCell(r, 1).alignment = { horizontal: 'left', vertical: 'middle' }
  mix.getRow(r).height = 28
  r++
  mix.mergeCells(r, 1, r, MIX_COLS)
  mix.getCell(r, 1).value =
    `작성일 ${today} · 비교한 제안서 ${args.companies.length}건 · 비교 기준: 가입금액 1,000만원당 월 보험료 · 금액 단위: 원`
  mix.getCell(r, 1).font = { name: font, size: 9, color: { argb: 'FF6B7280' } }
  r += 2

  // 담보별 표
  const HEAD = ['담보', '고른 보험사', '가입금액(만원)', '월 보험료(원)', '1천만원당(원)', '제안서상 담보명']
  HEAD.forEach((h, i) => {
    mix.getCell(r, i + 1).value = h
    styleCell(mix, r, i + 1, { bold: true, color: 'FFFFFFFF', bg: NAVY })
  })
  r++

  for (const row of args.mixRows) {
    mix.getCell(r, 1).value = row.label
    styleCell(mix, r, 1, { align: 'left', bold: true, bg: GRAY_SOFT })
    mix.getCell(r, 2).value = row.company
    styleCell(mix, r, 2, { bold: true, bg: PICK })
    mix.getCell(r, 3).value = row.amountManwon ?? '확인 필요'
    styleCell(mix, r, 3, { numFmt: '#,##0' })
    mix.getCell(r, 4).value = row.premiumWon ?? '확인 필요'
    styleCell(mix, r, 4, { numFmt: '#,##0' })
    mix.getCell(r, 5).value = row.unitPrice ?? (row.needsReview ? '가입금액 확인 필요' : '-')
    styleCell(mix, r, 5, { numFmt: '#,##0', color: row.needsReview ? 'FFB45309' : undefined })
    mix.getCell(r, 6).value = row.soleOffer ? `${row.coverageName} (이 회사에만 있음)` : row.coverageName
    styleCell(mix, r, 6, { align: 'left', size: 9, color: 'FF6B7280', wrap: true })
    r++
  }

  // 합계
  mix.mergeCells(r, 1, r, 3)
  mix.getCell(r, 1).value = '조합 설계안 월 보험료 합계'
  styleCell(mix, r, 1, { bold: true, align: 'left', bg: GOLD_SOFT })
  styleCell(mix, r, 2, { bg: GOLD_SOFT })
  styleCell(mix, r, 3, { bg: GOLD_SOFT })
  mix.getCell(r, 4).value = args.mixPremium
  styleCell(mix, r, 4, { bold: true, numFmt: '#,##0', bg: GOLD_SOFT })
  mix.mergeCells(r, 5, r, 6)
  styleCell(mix, r, 5, { bg: GOLD_SOFT })
  r++

  if (args.cheapestSingle && args.savedVsSingle !== null) {
    mix.mergeCells(r, 1, r, 3)
    mix.getCell(r, 1).value = `한 회사로만 넣을 때 가장 저렴한 곳 — ${args.cheapestSingle.company}`
    styleCell(mix, r, 1, { align: 'left' })
    styleCell(mix, r, 2, {})
    styleCell(mix, r, 3, {})
    mix.getCell(r, 4).value = args.cheapestSingle.premium
    styleCell(mix, r, 4, { numFmt: '#,##0' })
    mix.mergeCells(r, 5, r, 6)
    mix.getCell(r, 5).value =
      args.savedVsSingle > 0
        ? `조합이 월 ${args.savedVsSingle.toLocaleString('ko-KR')}원 저렴 (연 ${(args.savedVsSingle * 12).toLocaleString('ko-KR')}원)`
        : '조합과 차이 없음'
    styleCell(mix, r, 5, { bold: args.savedVsSingle > 0, align: 'left', color: args.savedVsSingle > 0 ? 'FF15803D' : undefined })
    r++
  }
  r++

  // 회사별 단독 합계
  mix.mergeCells(r, 1, r, MIX_COLS)
  mix.getCell(r, 1).value = '회사별 단독 합계 — 그 회사가 가진 담보만 더한 값'
  mix.getCell(r, 1).font = { name: font, size: 11, bold: true, color: { argb: NAVY } }
  mix.getCell(r, 1).alignment = { horizontal: 'left', vertical: 'middle' }
  r++
  for (const c of args.byCompanyTotal) {
    mix.mergeCells(r, 1, r, 3)
    mix.getCell(r, 1).value = `${c.company} (담보 ${c.rowCount}개)`
    styleCell(mix, r, 1, { align: 'left' })
    styleCell(mix, r, 2, {})
    styleCell(mix, r, 3, {})
    mix.getCell(r, 4).value = c.premium
    styleCell(mix, r, 4, { numFmt: '#,##0' })
    mix.mergeCells(r, 5, r, 6)
    styleCell(mix, r, 5, {})
    r++
  }
  r++

  // 이 설계안의 장점
  mix.mergeCells(r, 1, r, MIX_COLS)
  mix.getCell(r, 1).value = args.explanation.headline || '이 설계안의 장점'
  mix.getCell(r, 1).font = { name: font, size: 12, bold: true, color: { argb: NAVY } }
  mix.getCell(r, 1).alignment = { horizontal: 'left', vertical: 'middle' }
  mix.getCell(r, 1).fill = fill(GOLD_SOFT)
  mix.getRow(r).height = 24
  r++
  for (const [i, point] of args.explanation.points.entries()) {
    mix.mergeCells(r, 1, r, MIX_COLS)
    mix.getCell(r, 1).value = `${i + 1}. ${point}`
    mix.getCell(r, 1).font = { name: font, size: 10 }
    mix.getCell(r, 1).alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
    mix.getRow(r).height = Math.max(18, Math.ceil((point.length * 1.9) / 130) * 16)
    r++
  }
  setA4Landscape(mix, MIX_COLS, r - 1, false)

  /* ===== 2) 담보 비교 ===== */
  const cmp = workbook.addWorksheet('담보 비교', { views: [{ showGridLines: false, state: 'frozen', xSplit: 1, ySplit: 3 }] })
  const cmpCols = 1 + args.companies.length
  cmp.getColumn(1).width = 30
  for (let c = 2; c <= cmpCols; c++) cmp.getColumn(c).width = 16

  let cr = 1
  cmp.mergeCells(cr, 1, cr, Math.max(cmpCols, 2))
  cmp.getCell(cr, 1).value = `${args.planLabel} — 담보별 회사 보험료 비교`
  cmp.getCell(cr, 1).font = { name: font, size: 14, bold: true, color: { argb: NAVY } }
  cmp.getCell(cr, 1).alignment = { horizontal: 'left', vertical: 'middle' }
  cr++
  cmp.mergeCells(cr, 1, cr, Math.max(cmpCols, 2))
  cmp.getCell(cr, 1).value = '색이 칠해진 칸이 조합 설계안에서 고른 회사입니다 · 빈칸은 그 회사 제안서에 없는 담보 · 단위: 원'
  cmp.getCell(cr, 1).font = { name: font, size: 9, color: { argb: 'FF6B7280' } }
  cr++

  cmp.getCell(cr, 1).value = '담보'
  styleCell(cmp, cr, 1, { bold: true, color: 'FFFFFFFF', bg: NAVY, align: 'left' })
  args.companies.forEach((company, i) => {
    cmp.getCell(cr, i + 2).value = company
    styleCell(cmp, cr, i + 2, { bold: true, color: 'FFFFFFFF', bg: NAVY })
  })
  cr++

  for (const row of args.mixRows) {
    cmp.getCell(cr, 1).value = row.label
    styleCell(cmp, cr, 1, { align: 'left', bold: true, bg: GRAY_SOFT })
    args.companies.forEach((company, i) => {
      const value = row.byCompany[company]
      cmp.getCell(cr, i + 2).value = value ?? ''
      styleCell(cmp, cr, i + 2, { numFmt: '#,##0', bg: company === row.company ? PICK : undefined, bold: company === row.company })
    })
    cr++
  }

  cmp.getCell(cr, 1).value = '합계'
  styleCell(cmp, cr, 1, { bold: true, align: 'left', bg: GOLD_SOFT })
  args.companies.forEach((company, i) => {
    cmp.getCell(cr, i + 2).value = args.byCompanyTotal.find((c) => c.company === company)?.premium ?? 0
    styleCell(cmp, cr, i + 2, { bold: true, numFmt: '#,##0', bg: GOLD_SOFT })
  })
  setA4Landscape(cmp, Math.max(cmpCols, 2), cr, false)

  /* ===== 3) 담보목록 ===== */
  const list = workbook.addWorksheet('담보목록')
  list.columns = [
    { header: '보험사', key: 'company', width: 12 },
    { header: '담보명', key: 'coverageName', width: 60 },
    { header: '가입금액', key: 'amount', width: 14 },
    { header: '납입기간·만기', key: 'term', width: 20 },
    { header: '보험료(원)', key: 'premium', width: 12 }
  ]
  list.getRow(1).font = { bold: true }
  for (const row of args.rows) {
    const digits = row.premium.replace(/[^\d]/g, '')
    const added = list.addRow({ ...row, premium: digits && /^[\d,\s원]+$/.test(row.premium) ? Number(digits) : row.premium })
    added.getCell('premium').numFmt = '#,##0'
  }
  list.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, args.rows.length + 1), column: 5 } }
  list.views = [{ state: 'frozen', ySplit: 1 }]
  setA4Landscape(list, 5, Math.max(1, args.rows.length + 1), false)

  const out = await workbook.xlsx.writeBuffer()
  return new Blob([out], { type: XLSX_MIME })
}

/* =========================================================================
 * 3장 포맷 엑셀 (가입제안서 비교)
 *  ① 종합비교: 보험사 · 상품명 · 담보건수 · 월 보험료
 *  ② 담보비교: 담보 종류(키워드 분류) × 보험사 가입금액
 *  ③ 보험사별 상세: 담보명 · 가입금액 · 월 보험료 (+ 합계)
 * ======================================================================= */

export interface ThreeSheetRow {
  name: string
  amount: string
  fee: number
}
export interface ThreeSheetProposal {
  insurer: string
  product: string
  total: number
  rows: ThreeSheetRow[]
}

const TS_CATEGORY_ORDER = [
  '상해 입원일당',
  '질병/일반 입원일당',
  '상급종합병원 입원일당',
  '종합병원 입원일당',
  '중환자실 입원일당',
  '간병인사용(요양병원제외)',
  '간병인사용(요양병원)',
  '간호·간병통합 입원일당',
  '응급실 내원',
  '사망/주계약'
]

function tsCategoryOf(nmRaw: string): string | null {
  const s = (nmRaw || '').replace(/\s/g, '')
  if (/간호간병|간호·간병|간호\.?간병통합/.test(s)) return '간호·간병통합 입원일당'
  if (/간병인|간병사용/.test(s)) return /요양병원(?!제외)|요양\)/.test(s) && !/제외/.test(s) ? '간병인사용(요양병원)' : '간병인사용(요양병원제외)'
  if (/중환자/.test(s)) return '중환자실 입원일당'
  if (/상급종합/.test(s)) return '상급종합병원 입원일당'
  if (/종합병원/.test(s)) return '종합병원 입원일당'
  if (/응급/.test(s)) return '응급실 내원'
  if (/상해.*입원|입원.*상해/.test(s)) return '상해 입원일당'
  if (/질병.*입원|첫날부터입원|입원일당/.test(s)) return '질병/일반 입원일당'
  if (/사망|주계약|기본계약/.test(s)) return '사망/주계약'
  return null
}

/**
 * 상해·질병 구분이 없는 "통합 기본 입원일당"인지. 첫날부터입원 / 그냥 입원일당처럼
 * 한 담보로 상해·질병을 모두 보장하는 것을 말한다(종합·상급·중환자·간병·간호·응급은
 * tsCategoryOf 에서 먼저 걸러지므로 여기까지 오지 않는다). 이런 담보는 ②담보비교에서
 * 상해·질병 칸 양쪽에 함께 보여준다.
 */
function tsIsCombinedInpatient(nmRaw: string): boolean {
  const s = (nmRaw || '').replace(/\s/g, '')
  if (/상해|질병/.test(s)) return false
  return /첫날부터입원|입원일당/.test(s)
}

/** 담보명이 해당 카테고리 칸에 들어갈지. 통합 기본 입원일당은 상해·질병 두 칸 모두 매칭. */
function tsMatchesCategory(nmRaw: string, cat: string): boolean {
  const primary = tsCategoryOf(nmRaw)
  if (primary === cat) return true
  if (
    (cat === '상해 입원일당' || cat === '질병/일반 입원일당') &&
    primary === '질병/일반 입원일당' &&
    tsIsCombinedInpatient(nmRaw)
  ) {
    return true
  }
  return false
}

/**
 * 가입금액 문자열을 만원 단위 숫자로. "1,000만원"→1000, "2만원"→2, "4.5만원"→4.5,
 * "1억"→10000. 파싱 불가면 null.
 */
function tsAmountManwon(amountRaw: string): number | null {
  const s = (amountRaw || '').replace(/\s|,/g, '')
  let total = 0
  let matched = false
  const eok = s.match(/([\d.]+)억/)
  if (eok) {
    total += parseFloat(eok[1]) * 10000
    matched = true
  }
  const man = s.match(/([\d.]+)만/)
  if (man) {
    total += parseFloat(man[1])
    matched = true
  }
  return matched ? total : null
}

/**
 * 일당이 아니라 "가입금액(정액)"으로 보이는 큰 금액인지(일당은 보통 20만원 이하).
 * NH 올원더풀(요양·간병 1,000만형)·NH 건강플러스(첫날부터입원 3,000만형)처럼
 * 일당 비교표에 섞이면 오류처럼 보이는 값을 가려낸다.
 */
function tsIsLumpSum(amountRaw: string): boolean {
  const v = tsAmountManwon(amountRaw)
  return v !== null && v >= 500
}

function tsSheetName(base: string, used: Set<string>): string {
  const clean = (base || '제안서').replace(/[[\]:*?/\\]/g, ' ').slice(0, 28).trim() || '제안서'
  let name = clean
  let i = 2
  while (used.has(name)) name = `${clean.slice(0, 26)}_${i++}`
  used.add(name)
  return name
}

export async function buildThreeSheetWorkbook(proposals: ThreeSheetProposal[]): Promise<Blob> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  const NAVY = 'FF0E1E3A'
  const HEAD = 'FF1F3A63'
  const LITE = 'FFF2F5FA'
  const font = 'Malgun Gothic'
  const line = { style: 'thin' as const, color: { argb: 'FFC5CCD8' } }
  const boxed = { top: line, left: line, bottom: line, right: line }
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
  const headRow = (sheet: Worksheet, row: number, cols: string[]): void => {
    cols.forEach((t, i) => {
      const c = sheet.getCell(row, i + 1)
      c.value = t
      c.font = { name: font, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      c.fill = fill(HEAD)
      c.border = boxed
    })
  }
  const put = (sheet: Worksheet, row: number, col: number, val: CellValue, o: { bold?: boolean; align?: 'left' | 'center' | 'right'; bg?: string; num?: boolean; color?: string } = {}): void => {
    const c = sheet.getCell(row, col)
    c.value = val
    c.font = { name: font, size: 10, bold: Boolean(o.bold), color: o.color ? { argb: o.color } : undefined }
    c.alignment = { horizontal: o.align ?? 'left', vertical: 'middle' }
    c.border = boxed
    if (o.bg) c.fill = fill(o.bg)
    if (o.num) c.numFmt = '#,##0'
  }

  // ① 종합비교
  const s1 = wb.addWorksheet('종합비교', { views: [{ showGridLines: false }] })
  s1.getColumn(1).width = 18
  s1.getColumn(2).width = 52
  s1.getColumn(3).width = 10
  s1.getColumn(4).width = 15
  s1.mergeCells(1, 1, 1, 4)
  s1.getCell(1, 1).value = '가입제안서 비교 — 종합'
  s1.getCell(1, 1).font = { name: font, size: 15, bold: true, color: { argb: 'FFFFFFFF' } }
  s1.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' }
  s1.getCell(1, 1).fill = fill(NAVY)
  s1.getRow(1).height = 26
  headRow(s1, 3, ['보험사', '상품명', '담보 건수', '월 보험료(원)'])
  let r = 4
  for (const p of proposals) {
    put(s1, r, 1, p.insurer || '-', { bold: true })
    put(s1, r, 2, p.product || '-')
    put(s1, r, 3, p.rows.length, { align: 'center' })
    put(s1, r, 4, p.total || 0, { align: 'right', num: true, bold: true })
    r++
  }
  put(s1, r, 1, '', {})
  put(s1, r, 2, '각 상품은 대체(비교) 안이며 합산 대상이 아닙니다. 월 보험료로 비교하세요.', { color: 'FF9F2529' })
  put(s1, r, 3, '(참고)합산', { align: 'center', color: 'FF9F2529' })
  put(s1, r, 4, proposals.reduce((n, p) => n + (p.total || 0), 0), { align: 'right', num: true, bold: true, color: 'FF9F2529' })

  // ② 담보비교
  const s2 = wb.addWorksheet('담보비교', { views: [{ showGridLines: false }] })
  const lastCol = 1 + proposals.length
  s2.getColumn(1).width = 30
  for (let c = 2; c <= lastCol; c++) s2.getColumn(c).width = 16
  s2.mergeCells(1, 1, 1, lastCol)
  s2.getCell(1, 1).value = '담보 종류별 가입금액·월 보험료 비교 (근사 분류 — 상세는 보험사별 시트 확인)'
  s2.getCell(1, 1).font = { name: font, size: 13, bold: true, color: { argb: 'FFFFFFFF' } }
  s2.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' }
  s2.getCell(1, 1).fill = fill(NAVY)
  s2.getRow(1).height = 24
  headRow(s2, 3, ['담보 종류', ...proposals.map((p) => p.insurer || p.product.slice(0, 10))])
  r = 4
  let hasLump = false
  for (const cat of TS_CATEGORY_ORDER) {
    put(s2, r, 1, cat, { bold: true, bg: LITE })
    const dailyCat = cat !== '사망/주계약' // 사망/주계약은 원래 가입금액(정액) 칸
    proposals.forEach((p, i) => {
      const hit = p.rows.find((row) => tsMatchesCategory(row.name, cat))
      if (!hit) {
        put(s2, r, i + 2, '-', { align: 'center', color: 'FFAAB2C0' })
        return
      }
      // 일당 칸에 들어온 큰 금액(가입금액·정액형)은 일당처럼 보이지 않게 '정액' 표시.
      if (dailyCat && tsIsLumpSum(hit.amount)) {
        hasLump = true
        put(s2, r, i + 2, `${hit.amount} (정액)`, { align: 'center', color: 'FF9F6B00' })
      } else {
        put(s2, r, i + 2, hit.amount, { align: 'center' })
      }
    })
    r++
  }
  put(s2, r, 1, '월 보험료(원)', { bold: true, bg: HEAD, color: 'FFFFFFFF' })
  proposals.forEach((p, i) => put(s2, r, i + 2, p.total || 0, { align: 'right', num: true, bold: true, color: 'FF2F63E6' }))
  r += 2
  s2.mergeCells(r, 1, r, lastCol)
  const note = hasLump
    ? '※ 상해·질병 구분이 없는 통합 입원담보(첫날부터입원 등)는 상해·질병 칸에 함께 표시됩니다. ‘(정액)’은 일당이 아니라 가입금액(정액 보장)형 담보로, 일당 금액과 직접 비교되지 않습니다(NH 등). 정확한 내역은 보험사별 상세 시트를 확인하세요.'
    : '※ 상해·질병 구분이 없는 통합 입원담보(첫날부터입원 등)는 상해·질병 칸에 함께 표시됩니다. 정확한 내역은 보험사별 상세 시트를 확인하세요.'
  s2.getCell(r, 1).value = note
  s2.getCell(r, 1).font = { name: font, size: 9, color: { argb: 'FF66718A' } }
  s2.getCell(r, 1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }

  // ②-B 담보 종류별 월 보험료 — 같은 카테고리에 속한 담보들의 보험료 합
  r += 2
  s2.mergeCells(r, 1, r, lastCol)
  s2.getCell(r, 1).value = '담보 종류별 월 보험료 (해당 담보 보험료 합, 원)'
  s2.getCell(r, 1).font = { name: font, size: 12, bold: true, color: { argb: 'FFFFFFFF' } }
  s2.getCell(r, 1).alignment = { horizontal: 'center', vertical: 'middle' }
  s2.getCell(r, 1).fill = fill(NAVY)
  s2.getRow(r).height = 22
  r++
  headRow(s2, r, ['담보 종류', ...proposals.map((p) => p.insurer || p.product.slice(0, 10))])
  r++
  // 보험료는 특약당 한 번만 집계해야 하므로 '대표 카테고리'(tsCategoryOf) 기준으로 합산한다.
  // (가입금액 표는 통합담보를 상해·질병 두 칸에 모두 보여주지만, 보험료를 양쪽에 더하면
  //  이중 집계되어 합이 전체 월 보험료를 넘어가므로 여기서는 대표 카테고리에만 더한다.)
  const shownSum = proposals.map(() => 0)
  for (const cat of TS_CATEGORY_ORDER) {
    put(s2, r, 1, cat, { bold: true, bg: LITE })
    proposals.forEach((p, i) => {
      const feeSum = p.rows.filter((row) => tsCategoryOf(row.name) === cat).reduce((n, row) => n + (row.fee || 0), 0)
      shownSum[i] += feeSum
      put(s2, r, i + 2, feeSum > 0 ? feeSum : '-', { align: feeSum > 0 ? 'right' : 'center', num: feeSum > 0, color: feeSum > 0 ? undefined : 'FFAAB2C0' })
    })
    r++
  }
  put(s2, r, 1, '비교 담보 보험료 합(원)', { bold: true, bg: LITE })
  proposals.forEach((p, i) => put(s2, r, i + 2, shownSum[i], { align: 'right', num: true, bold: true }))
  r++
  put(s2, r, 1, '전체 월 보험료(원)', { bold: true, bg: HEAD, color: 'FFFFFFFF' })
  proposals.forEach((p, i) => put(s2, r, i + 2, p.total || 0, { align: 'right', num: true, bold: true, color: 'FF2F63E6' }))
  r += 2
  s2.mergeCells(r, 1, r, lastCol)
  s2.getCell(r, 1).value = '※ 월 보험료는 각 담보 종류에 속한 특약들의 보험료 합계입니다(특약당 1회만 집계 — 통합 입원담보는 질병/일반 행에 합산). 납입면제·암진단 등 비교 대상이 아닌 담보는 제외되므로, 비교 담보 보험료 합은 전체 월 보험료보다 작습니다.'
  s2.getCell(r, 1).font = { name: font, size: 9, color: { argb: 'FF66718A' } }
  s2.getCell(r, 1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }

  // ③ 보험사별 상세
  const used = new Set<string>(['종합비교', '담보비교'])
  proposals.forEach((p, idx) => {
    const d = wb.addWorksheet(tsSheetName(p.insurer || `제안서${idx + 1}`, used), { views: [{ showGridLines: false }] })
    d.getColumn(1).width = 54
    d.getColumn(2).width = 16
    d.getColumn(3).width = 15
    d.mergeCells(1, 1, 1, 3)
    d.getCell(1, 1).value = p.product || p.insurer || `제안서 ${idx + 1}`
    d.getCell(1, 1).font = { name: font, size: 12, bold: true, color: { argb: 'FFFFFFFF' } }
    d.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    d.getCell(1, 1).fill = fill(NAVY)
    d.getRow(1).height = 28
    headRow(d, 3, ['담보명', '가입금액', '월 보험료(원)'])
    let rr = 4
    for (const row of p.rows) {
      put(d, rr, 1, row.name)
      put(d, rr, 2, row.amount, { align: 'center' })
      put(d, rr, 3, row.fee || 0, { align: 'right', num: true })
      rr++
    }
    put(d, rr, 1, '합계 (월 보험료)', { bold: true, bg: LITE })
    put(d, rr, 2, '', { bg: LITE })
    put(d, rr, 3, p.total || 0, { align: 'right', num: true, bold: true, color: 'FF2F63E6', bg: LITE })
  })

  const out = await wb.xlsx.writeBuffer()
  return new Blob([out], { type: XLSX_MIME })
}
