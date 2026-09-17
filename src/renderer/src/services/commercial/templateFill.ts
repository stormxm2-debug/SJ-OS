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

// 기존 표와 수식은 그대로 두고 시트 아래에 최종 합계표와 간병 페이백 안내를 덧붙인다.
function writeSummaryBlock(sheet: Worksheet, labelColumn: number, summary: SummaryRow[], notes: PaybackNote[]): void {
  if (summary.length === 0 && notes.length === 0) return
  let rowNumber = sheet.rowCount + 2
  const put = (row: number, col: number, value: CellValue, bold = false): void => {
    const cell = sheet.getRow(row).getCell(col)
    cell.value = value
    if (bold) cell.font = { ...(cell.font ?? {}), bold: true }
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

  writeSummaryBlock(sheet, layout.labelColumn, args.summary, args.paybackNotes)
  // 총보험료·입원일당 합계 같은 수식이 엑셀을 열 때 바로 다시 계산되도록 한다.
  workbook.calcProperties = { ...workbook.calcProperties, fullCalcOnLoad: true }

  const out = await workbook.xlsx.writeBuffer()
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  return { blob, sheetName: sheet.name, skippedCompanies }
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
