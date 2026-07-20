import * as XLSX from 'xlsx'
import type { LeadInput } from './leadService'

/**
 * DB 파일 판독 — 구매/수집한 DB 엑셀(.xlsx/.xls)·CSV를 읽어 배정 가능한
 * 리드 목록으로 바꾼다.
 *
 * - 첫 5행 안에서 헤더 행을 자동 탐지: "이름/성명/고객" 열 + "전화/연락/휴대/핸드폰" 열.
 * - 그 외 열(지역·나이·비고 등)은 "헤더:값" 형태로 메모에 합쳐 보존한다.
 * - 헤더가 없으면 1열=이름, 2열=전화, 나머지=메모로 취급.
 * - 전화번호는 숫자만 추출해 010-XXXX-XXXX로 정규화(01로 시작 10~11자리일 때).
 * - 파일 안 중복(같은 이름+전화)은 1건만 남기고 제거 건수를 보고한다.
 */

export interface ParsedLeadFile {
  ok: boolean
  rows: LeadInput[]
  /** 사람이 읽는 판독 요약 (예: '32행 판독 · 중복 2건 제거'). */
  summary?: string
  error?: string
}

const NAME_HEADER = /이름|성명|고객|명단|姓名|name/i
const PHONE_HEADER = /전화|연락|휴대|핸드폰|폰|번호|mobile|phone|tel/i
/** 메모로 안 옮기는 열 (이름·전화 자체). */

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (/^01\d{8,9}$/.test(digits)) {
    return digits.length === 11
      ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
      : `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return raw.trim()
}

export async function parseLeadFile(file: File): Promise<ParsedLeadFile> {
  let grid: string[][]
  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const sheetName = wb.SheetNames[0]
    if (!sheetName) return { ok: false, rows: [], error: '시트를 찾지 못했습니다.' }
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' }) as unknown[][]
    grid = raw.map((r) => r.map((c) => String(c ?? '').trim()))
  } catch {
    return { ok: false, rows: [], error: '파일을 읽지 못했습니다. 엑셀(.xlsx/.xls) 또는 CSV 파일인지 확인해 주세요.' }
  }

  // 헤더 행 탐지 (앞 5행): 이름 열 + 전화 열이 함께 있는 첫 행.
  let headerRow = -1
  let nameCol = -1
  let phoneCol = -1
  for (let r = 0; r < Math.min(5, grid.length); r += 1) {
    const row = grid[r]
    const n = row.findIndex((c) => NAME_HEADER.test(c))
    const p = row.findIndex((c) => PHONE_HEADER.test(c))
    if (n >= 0 && p >= 0 && n !== p) {
      headerRow = r
      nameCol = n
      phoneCol = p
      break
    }
  }

  const headers = headerRow >= 0 ? grid[headerRow] : []
  const dataRows = grid.slice(headerRow + 1)
  if (headerRow < 0) {
    // 헤더 없음 — 1열 이름, 2열 전화 가정.
    nameCol = 0
    phoneCol = 1
  }

  const rows: LeadInput[] = []
  for (const row of dataRows) {
    const name = (row[nameCol] ?? '').trim()
    if (!name || NAME_HEADER.test(name)) continue // 빈 행·중간 반복 헤더 스킵
    const phoneRaw = (row[phoneCol] ?? '').trim()
    const phone = phoneRaw ? normalizePhone(phoneRaw) : undefined
    // 나머지 열 → 메모 ("헤더:값" 보존, 헤더 없으면 값만)
    const memoParts: string[] = []
    row.forEach((cell, idx) => {
      if (idx === nameCol || idx === phoneCol) return
      const v = cell.trim()
      if (!v) return
      const h = (headers[idx] ?? '').trim()
      memoParts.push(h ? `${h}: ${v}` : v)
    })
    rows.push({ name, phone, memo: memoParts.length > 0 ? memoParts.join(' / ').slice(0, 500) : undefined })
  }

  // 파일 내 중복(이름+전화) 제거.
  const seen = new Set<string>()
  const deduped: LeadInput[] = []
  let dupCount = 0
  for (const r of rows) {
    const key = `${r.name}:${(r.phone ?? '').replace(/\D/g, '')}`
    if (seen.has(key)) {
      dupCount += 1
      continue
    }
    seen.add(key)
    deduped.push(r)
  }

  if (deduped.length === 0) {
    return { ok: false, rows: [], error: '판독된 데이터가 없습니다. 이름·전화 열이 있는 파일인지 확인해 주세요.' }
  }
  const headInfo = headerRow >= 0 ? `헤더 인식(${headers[nameCol]}·${headers[phoneCol]})` : '헤더 없음(1열=이름, 2열=전화)'
  return {
    ok: true,
    rows: deduped,
    summary: `${deduped.length}건 판독 · ${headInfo}${dupCount > 0 ? ` · 중복 ${dupCount}건 제거` : ''}`
  }
}
