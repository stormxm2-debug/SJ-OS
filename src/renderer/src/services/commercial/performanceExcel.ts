import * as XLSX from 'xlsx'
import { normalizeKoreanPhoneNumber } from '@shared/phone'
import type { ExcelApplyRow, PerformanceInput, StaffDirectoryEntry } from './performanceRecordsService'
import { isValidMonth } from './performanceRecordsService'

/**
 * 실적 엑셀 업로드/양식 — 관리자 전용.
 *
 * 양식 열: 이름 | 휴대폰 | 월 | 생명보험 | 손해보험 | 단기납종신 | 계약건수
 *  - 금액은 원 단위 숫자(쉼표 허용). 월은 YYYY-MM (비우면 업로드 화면에서 선택한 월).
 *  - 직원 매칭: 휴대폰 번호(정규화) 우선, 없으면 이름(유일할 때만).
 * 파일은 브라우저 메모리에서만 파싱되며 서버로 원본이 전송되지 않는다.
 */

export interface ParsedExcelRow {
  rowNumber: number
  name: string
  phone: string
  month: string // '' = 기본 월 사용
  input: PerformanceInput
}

export interface MatchedExcelRow extends ExcelApplyRow {
  rowNumber: number
  name: string
  matchedBy: 'phone' | 'name'
}

export interface UnmatchedExcelRow {
  rowNumber: number
  name: string
  phone: string
  reason: string
}

export interface ExcelMatchResult {
  matched: MatchedExcelRow[]
  unmatched: UnmatchedExcelRow[]
}

const HEADER_ALIASES: Record<keyof Omit<ParsedExcelRow, 'rowNumber' | 'input'> | keyof PerformanceInput, string[]> = {
  name: ['이름', '성명', '직원'],
  phone: ['휴대폰', '전화', '연락처', '폰'],
  month: ['월', '년월', '기간'],
  life: ['생명'],
  nonLife: ['손해'],
  shortTerm: ['단기'],
  contractCount: ['계약']
}

function parseAmount(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v))
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,\s원₩]/g, ''))
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
  }
  return 0
}

function parseMonthCell(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}`
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    // 엑셀 날짜 일련번호 (1900 기준)
    const d = XLSX.SSF ? new Date(Math.round((v - 25569) * 86400 * 1000)) : null
    if (d && !Number.isNaN(d.getTime()) && d.getFullYear() > 2000) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }
    return ''
  }
  if (typeof v === 'string') {
    const s = v.trim().replace(/[./년\s]/g, '-').replace(/월$/, '').replace(/-+/g, '-').replace(/-$/, '')
    const m = s.match(/^(\d{4})-(\d{1,2})$/)
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}`
    const compact = s.match(/^(\d{4})(\d{2})$/)
    if (compact) return `${compact[1]}-${compact[2]}`
  }
  return ''
}

/** 업로드된 엑셀(.xlsx/.xls/.csv) 파일 → 행 파싱. 실패 시 빈 배열 + 사유. */
export async function parseExcelFile(file: File): Promise<{ rows: ParsedExcelRow[]; error?: string }> {
  let wb: XLSX.WorkBook
  try {
    const buf = await file.arrayBuffer()
    wb = XLSX.read(buf, { cellDates: true })
  } catch {
    return { rows: [], error: '엑셀 파일을 읽지 못했습니다. (.xlsx 형식인지 확인하세요)' }
  }
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return { rows: [], error: '엑셀에 시트가 없습니다.' }
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: '' }) as unknown[][]

  // 헤더 행 찾기 ('이름' 계열 포함된 첫 행)
  const headerIdx = grid.findIndex((row) => row.some((c) => typeof c === 'string' && HEADER_ALIASES.name.some((a) => c.includes(a))))
  if (headerIdx < 0) return { rows: [], error: '헤더 행(이름/휴대폰/월…)을 찾지 못했습니다. 양식 파일을 사용하세요.' }
  const header = grid[headerIdx].map((c) => String(c ?? ''))

  const colOf = (key: keyof typeof HEADER_ALIASES): number =>
    header.findIndex((h) => HEADER_ALIASES[key].some((a) => h.includes(a)))
  const cols = {
    name: colOf('name'),
    phone: colOf('phone'),
    month: colOf('month'),
    life: colOf('life'),
    nonLife: colOf('nonLife'),
    shortTerm: colOf('shortTerm'),
    contractCount: colOf('contractCount')
  }
  if (cols.name < 0) return { rows: [], error: "'이름' 열이 없습니다." }

  const rows: ParsedExcelRow[] = []
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i]
    const name = String(r[cols.name] ?? '').trim()
    const phone = cols.phone >= 0 ? String(r[cols.phone] ?? '').trim() : ''
    const input: PerformanceInput = {
      life: cols.life >= 0 ? parseAmount(r[cols.life]) : 0,
      nonLife: cols.nonLife >= 0 ? parseAmount(r[cols.nonLife]) : 0,
      shortTerm: cols.shortTerm >= 0 ? parseAmount(r[cols.shortTerm]) : 0,
      contractCount: cols.contractCount >= 0 ? parseAmount(r[cols.contractCount]) : 0
    }
    if (!name && !phone) continue // 빈 행
    // 금액이 전부 0이어도 행은 유지 (명단만 채운 양식에서 0 반영을 원할 수 있음)
    rows.push({
      rowNumber: i + 1,
      name,
      phone,
      month: cols.month >= 0 ? parseMonthCell(r[cols.month]) : '',
      input
    })
  }
  return { rows }
}

/** 파싱된 행 ↔ 직원 디렉토리 매칭 (휴대폰 우선, 이름은 유일할 때만). */
export function matchExcelRows(
  parsed: ParsedExcelRow[],
  directory: StaffDirectoryEntry[],
  defaultMonth: string
): ExcelMatchResult {
  const byPhone = new Map(directory.map((d) => [d.normalizedPhone, d]))
  const byName = new Map<string, StaffDirectoryEntry[]>()
  for (const d of directory) {
    const list = byName.get(d.name) ?? []
    list.push(d)
    byName.set(d.name, list)
  }

  const matched: MatchedExcelRow[] = []
  const unmatched: UnmatchedExcelRow[] = []

  for (const row of parsed) {
    const month = row.month || defaultMonth
    if (!isValidMonth(month)) {
      unmatched.push({ rowNumber: row.rowNumber, name: row.name, phone: row.phone, reason: `월 형식 오류 (${row.month || '빈칸'})` })
      continue
    }
    let dir: StaffDirectoryEntry | undefined
    let matchedBy: 'phone' | 'name' = 'phone'
    if (row.phone) {
      const norm = normalizeKoreanPhoneNumber(row.phone)
      if (norm.ok && norm.value) dir = byPhone.get(norm.value)
    }
    if (!dir && row.name) {
      const candidates = byName.get(row.name) ?? []
      if (candidates.length === 1) {
        dir = candidates[0]
        matchedBy = 'name'
      } else if (candidates.length > 1) {
        unmatched.push({ rowNumber: row.rowNumber, name: row.name, phone: row.phone, reason: '동명이인 — 휴대폰 번호를 적어주세요' })
        continue
      }
    }
    if (!dir) {
      unmatched.push({ rowNumber: row.rowNumber, name: row.name, phone: row.phone, reason: '등록된 직원을 찾지 못함 (계정 미생성 또는 번호/이름 불일치)' })
      continue
    }
    matched.push({ rowNumber: row.rowNumber, name: dir.name, matchedBy, staffId: dir.profileId, teamId: dir.teamId, month, input: row.input })
  }
  return { matched, unmatched }
}

/** 실적 양식 다운로드 — 등록 직원 명단이 미리 채워진 .xlsx. */
export function downloadTemplate(directory: StaffDirectoryEntry[], month: string): void {
  const header = ['이름', '휴대폰', '월', '생명보험', '손해보험', '단기납종신', '계약건수']
  const body = directory.map((d) => [d.name, d.normalizedPhone.replace('+82', '0'), month, 0, 0, 0, 0])
  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  ws['!cols'] = [{ wch: 10 }, { wch: 15 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '실적')
  XLSX.writeFile(wb, `SJ실적양식_${month}.xlsx`)
}
