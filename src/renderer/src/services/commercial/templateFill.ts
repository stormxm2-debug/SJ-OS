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
