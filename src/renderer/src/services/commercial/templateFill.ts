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

// 기존 표와 수식은 그대로 두고 시트 아래에 요약 설명·최종 합계표·간병 페이백 안내를 덧붙인다.
function writeSummaryBlock(sheet: Worksheet, labelColumn: number, summary: SummaryRow[], notes: PaybackNote[], summaryLines: string[]): void {
  if (summary.length === 0 && notes.length === 0 && summaryLines.length === 0) return
  let rowNumber = sheet.rowCount + 2
  const put = (row: number, col: number, value: CellValue, bold = false): void => {
    const cell = sheet.getRow(row).getCell(col)
    cell.value = value
    if (bold) cell.font = { ...(cell.font ?? {}), bold: true }
  }

  if (summaryLines.length > 0) {
    put(rowNumber++, labelColumn, '요약 설명', true)
    for (const line of summaryLines) put(rowNumber++, labelColumn, line)
    rowNumber++
  }

  if (summary.length > 0) {
    put(rowNumber++, labelColumn, '최종 합계표 (하루 입원 시 받는 금액, 만원)', true)
    put(rowNumber, labelColumn, '상황', true)
    put(rowNumber, labelColumn + 1, '상해', true)
    put(rowNumber, labelColumn + 2, '질병', true)
    rowNumber++
    for (const row of summary) {
      put(rowNumber, labelColumn, row.label)
      put(rowNumber, labelColumn + 1, row.상해)
      put(rowNumber, labelColumn + 2, row.질병)
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

  writeSummaryBlock(sheet, layout.labelColumn, args.summary, args.paybackNotes, args.summaryLines ?? [])
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

// 양식 없이 바로 받는 정리 엑셀: '합계표' 시트(요약·회사별 비교·최종 합계표·페이백) + '담보목록' 시트.
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
  const bold = { bold: true }
  const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE8EEF7' } }
  const border = { style: 'thin' as const, color: { argb: 'FFBFC8D6' } }
  const boxed = { top: border, left: border, bottom: border, right: border }

  /* 합계표 */
  const sheet = workbook.addWorksheet('합계표')
  const lastCol = 1 + Math.max(args.matrix.length * 2, 3)
  sheet.getColumn(1).width = 26
  for (let c = 2; c <= lastCol; c++) sheet.getColumn(c).width = 12
  let r = 1
  sheet.getCell(r, 1).value = '가입제안서 담보 정리'
  sheet.getCell(r, 1).font = { bold: true, size: 14 }
  r += 2

  if (args.summaryLines.length > 0) {
    sheet.getCell(r, 1).value = '요약 설명'
    sheet.getCell(r, 1).font = bold
    r++
    for (const line of args.summaryLines) {
      sheet.mergeCells(r, 1, r, lastCol)
      const cell = sheet.getCell(r, 1)
      cell.value = line
      cell.alignment = { wrapText: true, vertical: 'top' }
      sheet.getRow(r).height = Math.max(18, Math.ceil(line.length / 70) * 16)
      r++
    }
    r++
  }

  if (args.matrix.length > 0) {
    sheet.getCell(r, 1).value = '회사별 비교 (월 보험료 낮은 순 · 일당 만원)'
    sheet.getCell(r, 1).font = bold
    r++
    const nameRow = r
    const sideRow = r + 1
    sheet.getCell(nameRow, 1).value = '항목'
    sheet.mergeCells(nameRow, 1, sideRow, 1)
    args.matrix.forEach((entry, i) => {
      const left = 2 + i * 2
      sheet.mergeCells(nameRow, left, nameRow, left + 1)
      sheet.getCell(nameRow, left).value = entry.company
      sheet.getCell(sideRow, left).value = '상해'
      sheet.getCell(sideRow, left + 1).value = '질병'
    })
    for (const row of [nameRow, sideRow]) {
      for (let c = 1; c <= 1 + args.matrix.length * 2; c++) {
        const cell = sheet.getCell(row, c)
        cell.font = bold
        cell.fill = headerFill
        cell.border = boxed
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      }
    }
    r = sideRow + 1
    const writeRow = (label: string, valueAt: (entry: MatrixEntry, side: Side) => number | string | undefined, numFmt?: string): void => {
      sheet.getCell(r, 1).value = label
      sheet.getCell(r, 1).font = bold
      sheet.getCell(r, 1).border = boxed
      args.matrix.forEach((entry, i) => {
        ;(['상해', '질병'] as Side[]).forEach((side, j) => {
          const cell = sheet.getCell(r, 2 + i * 2 + j)
          const value = valueAt(entry, side)
          if (value !== undefined && value !== '') cell.value = value
          if (numFmt) cell.numFmt = numFmt
          cell.border = boxed
          cell.alignment = { horizontal: 'center' }
        })
      })
      r++
    }
    for (const category of args.categories) writeRow(category, (entry, side) => entry.cells[category]?.[side])
    // 보험료는 회사당 두 칸을 합쳐 한 번만 적는다.
    const premiumRow = r
    writeRow('월 보험료(원)', (entry, side) => (side === '상해' && entry.premium !== null ? entry.premium : undefined), '#,##0')
    args.matrix.forEach((_, i) => sheet.mergeCells(premiumRow, 2 + i * 2, premiumRow, 3 + i * 2))
    r++
  }

  if (args.summary.length > 0) {
    sheet.getCell(r, 1).value = '최종 합계표 (하루 입원 시 받는 금액, 만원 · 전 보험사 합산)'
    sheet.getCell(r, 1).font = bold
    r++
    ;['상황', '상해', '질병', '합산 항목'].forEach((label, i) => {
      const cell = sheet.getCell(r, 1 + i)
      cell.value = label
      cell.font = bold
      cell.fill = headerFill
      cell.border = boxed
    })
    r++
    for (const row of args.summary) {
      sheet.getCell(r, 1).value = row.label
      sheet.getCell(r, 2).value = row.상해
      sheet.getCell(r, 3).value = row.질병
      sheet.getCell(r, 4).value = row.parts.join(' + ')
      for (let c = 1; c <= 4; c++) sheet.getCell(r, c).border = boxed
      r++
    }
    r++
  }

  if (args.paybackNotes.length > 0) {
    sheet.getCell(r, 1).value = '간병 페이백 안내'
    sheet.getCell(r, 1).font = bold
    r++
    for (const note of args.paybackNotes) {
      sheet.getCell(r, 1).value = note.company
      sheet.mergeCells(r, 2, r, lastCol)
      sheet.getCell(r, 2).value = note.text
      sheet.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' }
      sheet.getRow(r).height = Math.max(18, Math.ceil(note.text.length / 60) * 16)
      r++
    }
  }

  /* 담보목록 */
  const list = workbook.addWorksheet('담보목록')
  list.columns = [
    { header: '보험사', key: 'company', width: 12 },
    { header: '담보명', key: 'coverageName', width: 60 },
    { header: '가입금액', key: 'amount', width: 14 },
    { header: '납입기간·만기', key: 'term', width: 20 },
    { header: '보험료(원)', key: 'premium', width: 12 }
  ]
  list.getRow(1).font = bold
  for (const row of args.rows) {
    const digits = row.premium.replace(/[^\d]/g, '')
    const added = list.addRow({ ...row, premium: digits && /^[\d,\s원]+$/.test(row.premium) ? Number(digits) : row.premium })
    added.getCell('premium').numFmt = '#,##0'
  }
  list.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, args.rows.length + 1), column: 5 } }
  list.views = [{ state: 'frozen', ySplit: 1 }]

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
