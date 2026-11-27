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

/** 시트 한 장(2차원 표)에서 헤더를 찾아 리드로 바꾼다. 인식할 행이 없으면 빈 배열. */
function parseGrid(grid: string[][]): { rows: LeadInput[]; headInfo: string; hasHeader: boolean } {
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
  const headInfo = headerRow >= 0 ? `헤더 인식(${headers[nameCol]}·${headers[phoneCol]})` : '헤더 없음(1열=이름, 2열=전화)'
  return { rows, headInfo, hasHeader: headerRow >= 0 }
}

/** 이름+전화(숫자만)가 같은 행은 첫 번째만 남긴다. */
export function dedupeLeads(rows: LeadInput[]): { rows: LeadInput[]; removed: number } {
  const seen = new Set<string>()
  const out: LeadInput[] = []
  let removed = 0
  for (const r of rows) {
    const key = `${r.name}:${(r.phone ?? '').replace(/\D/g, '')}`
    if (seen.has(key)) {
      removed += 1
      continue
    }
    seen.add(key)
    out.push(r)
  }
  return { rows: out, removed }
}

/**
 * 엑셀·CSV 한 파일을 읽는다. 시트가 여러 장이면 **모든 시트**를 읽어서 합친다
 * (시트마다 헤더를 따로 찾는다 — 이름·전화 열이 없는 시트는 건너뜀).
 */
export async function parseLeadFile(file: File): Promise<ParsedLeadFile> {
  let sheets: { name: string; grid: string[][] }[]
  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    if (wb.SheetNames.length === 0) return { ok: false, rows: [], error: '시트를 찾지 못했습니다.' }
    sheets = wb.SheetNames.map((name) => {
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' }) as unknown[][]
      return { name, grid: raw.map((r) => r.map((c) => String(c ?? '').trim())) }
    }).filter((s) => s.grid.length > 0)
  } catch {
    return { ok: false, rows: [], error: '파일을 읽지 못했습니다. 엑셀(.xlsx/.xls) 또는 CSV 파일인지 확인해 주세요.' }
  }

  const all: LeadInput[] = []
  let headInfo = ''
  let usedSheets = 0
  const parts = sheets.map((sh) => ({ sh, part: parseGrid(sh.grid) }))
  // 시트가 여러 장일 때, 이름·전화 헤더가 있는 시트가 하나라도 있으면 헤더 없는 시트(설명·표지 등)는 건너뛴다.
  const anyHeader = parts.some((x) => x.part.hasHeader)
  for (const { sh, part } of parts) {
    if (part.rows.length === 0) continue
    if (anyHeader && !part.hasHeader) continue
    usedSheets += 1
    if (!headInfo) headInfo = part.headInfo
    const origin = sheets.length > 1 ? `${file.name} · ${sh.name}` : file.name
    for (const r of part.rows) all.push({ ...r, source: file.name.slice(0, 60), origin })
  }

  const { rows: deduped, removed } = dedupeLeads(all)
  if (deduped.length === 0) {
    return { ok: false, rows: [], error: '판독된 데이터가 없습니다. 이름·전화 열이 있는 파일인지 확인해 주세요.' }
  }
  return {
    ok: true,
    rows: deduped,
    summary: `${deduped.length}건 판독${usedSheets > 1 ? ` · 시트 ${usedSheets}장` : ''} · ${headInfo}${removed > 0 ? ` · 중복 ${removed}건 제거` : ''}`
  }
}

export interface ParsedLeadFiles {
  ok: boolean
  rows: LeadInput[]
  summary?: string
  /** 파일별 결과(성공 건수 또는 실패 사유) */
  files: { name: string; count: number; error?: string }[]
  error?: string
}

/** 파일 여러 개를 한꺼번에 읽는다. 파일 사이 중복(이름+전화)도 한 건만 남긴다. */
export async function parseLeadFiles(files: File[]): Promise<ParsedLeadFiles> {
  const per: { name: string; count: number; error?: string }[] = []
  const all: LeadInput[] = []
  for (const file of files) {
    const res = await parseLeadFile(file)
    if (!res.ok) {
      per.push({ name: file.name, count: 0, error: res.error })
      continue
    }
    per.push({ name: file.name, count: res.rows.length })
    all.push(...res.rows)
  }
  if (all.length === 0) {
    return { ok: false, rows: [], files: per, error: per.length === 1 ? per[0].error ?? '판독된 데이터가 없습니다.' : '읽을 수 있는 파일이 없습니다. 이름·전화 열이 있는 엑셀 또는 CSV인지 확인해 주세요.' }
  }
  const { rows, removed } = dedupeLeads(all)
  const failed = per.filter((p) => p.error).length
  const summary =
    files.length === 1
      ? `${rows.length}건 판독`
      : `파일 ${files.length}개 · ${rows.length}건 판독${removed > 0 ? ` · 파일 사이 중복 ${removed}건 제거` : ''}${failed > 0 ? ` · 읽지 못한 파일 ${failed}개` : ''}`
  return { ok: true, rows, summary, files: per }
}
