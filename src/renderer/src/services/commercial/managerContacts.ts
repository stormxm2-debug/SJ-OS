import * as XLSX from 'xlsx'
import { MANAGER_CONTACTS_SEED } from './managerContactsSeed'
import {
  managerContactsRemoteEnabled,
  remoteList,
  remoteReplaceAll,
  remoteSubscribe
} from './managerContactsAdapter'

/**
 * 매니저 연락처 — 보험사 설계매니저·부지점장·지점장 연락망.
 *
 * 첨부된 「설계매니저」 엑셀 양식을 자동 인식한다: 손보사/생보사 두 표가 좌우로
 * 나란히 있고, 각 표는 [구분, 보험사, 설계매니저, 연락처, 부지점장, 연락처, 지점장, 연락처]
 * 8개 열로 구성된다. 한 보험사에 설계매니저가 여러 명이면 아래 행에 이름만 이어진다.
 *
 * 데이터는 브라우저(localStorage)에만 저장되며 서버로 전송되지 않는다.
 */

export type Category = 'sonbo' | 'saengbo'

export interface Person {
  name: string
  phone: string
}

export interface CompanyContacts {
  no: string
  company: string
  vice: string
  vicePhone: string
  head: string
  headPhone: string
  managers: Person[]
}

export type ContactsData = Record<Category, CompanyContacts[]>

export interface ParseResult {
  data: ContactsData
  companies: number
  managers: number
}

const STORAGE_KEY = 'sj-os:manager-contacts:v1'

export const CATEGORY_LABEL: Record<Category, string> = {
  sonbo: '손해보험 (손보사)',
  saengbo: '생명보험 (생보사)'
}

export const CATEGORY_SHORT: Record<Category, string> = { sonbo: '손보사', saengbo: '생보사' }

function empty(): ContactsData {
  return { sonbo: [], saengbo: [] }
}

function clean(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v).trim()
  return s === '-' ? '' : s
}

function normalizeData(d: unknown): ContactsData {
  const src = (d ?? {}) as Partial<ContactsData>
  return {
    sonbo: Array.isArray(src.sonbo) ? src.sonbo : [],
    saengbo: Array.isArray(src.saengbo) ? src.saengbo : []
  }
}

/** 저장된 연락처를 읽는다. 없으면 시드 데이터를 최초 등록한다. */
export function loadContacts(): ContactsData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalizeData(JSON.parse(raw))
  } catch {
    /* ignore */
  }
  const seed = normalizeData(MANAGER_CONTACTS_SEED)
  saveContacts(seed)
  return seed
}

export function saveContacts(data: ContactsData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

/** 저장 위치: Supabase(팀 공유) 설정 시 'shared', 아니면 브라우저 'local'. */
export type StorageMode = 'shared' | 'local'

export function contactsStorageMode(): StorageMode {
  return managerContactsRemoteEnabled() ? 'shared' : 'local'
}

/**
 * 팀 공유(Supabase) 설정이면 서버에서, 아니면 브라우저 localStorage 에서 불러온다.
 * 서버 조회 실패 시(네트워크/세션 없음) 로컬 캐시로 폴백한다.
 */
export async function loadContactsAsync(): Promise<ContactsData> {
  if (contactsStorageMode() === 'shared') {
    try {
      return await remoteList()
    } catch {
      return loadContacts()
    }
  }
  return loadContacts()
}

/** 팀 공유면 서버에 원자적으로 교체 저장, 아니면 localStorage 에 저장한다. */
export async function saveContactsAsync(data: ContactsData): Promise<void> {
  if (contactsStorageMode() === 'shared') {
    await remoteReplaceAll(data)
    // 로컬에도 캐시(오프라인/재접속 시 폴백용)
    saveContacts(data)
    return
  }
  saveContacts(data)
}

/** 팀 공유 모드에서 다른 사용자의 변경을 실시간 구독한다. 로컬 모드면 no-op. */
export function subscribeContacts(onChange: () => void): () => void {
  if (contactsStorageMode() !== 'shared') return () => {}
  return remoteSubscribe(onChange)
}

export function countContacts(d: ContactsData): { companies: number; managers: number; leaders: number } {
  let companies = 0
  let managers = 0
  let leaders = 0
  for (const cat of ['sonbo', 'saengbo'] as Category[]) {
    companies += d[cat].length
    for (const co of d[cat]) {
      managers += co.managers.length
      if (co.vice) leaders++
      if (co.head) leaders++
    }
  }
  return { companies, managers, leaders }
}

function detectCategory(titleRow: unknown[], start: number, idx: number): Category {
  let joined = ''
  for (let i = start; i < start + 8 && i < titleRow.length; i++) joined += clean(titleRow[i])
  if (/손보|손해/.test(joined)) return 'sonbo'
  if (/생보|생명/.test(joined)) return 'saengbo'
  return idx === 0 ? 'sonbo' : 'saengbo'
}

function parseSheet(rows: unknown[][], result: ContactsData): void {
  // 헤더 행: '설계매니저' 가 들어있는 행
  let hr = -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some((c) => clean(c) === '설계매니저')) {
      hr = i
      break
    }
  }
  if (hr === -1) return

  const header = rows[hr]
  const blocks: number[] = []
  for (let c = 0; c < header.length; c++) if (clean(header[c]) === '구분') blocks.push(c)
  if (blocks.length === 0) {
    for (let c = 0; c < header.length; c++) if (clean(header[c]) === '설계매니저') blocks.push(Math.max(0, c - 2))
  }

  const titleRow = hr > 0 ? rows[hr - 1] : []

  blocks.forEach((start, idx) => {
    const category = detectCategory(titleRow, start, idx)
    const list = result[category]
    let cur: CompanyContacts | null = null
    for (let r = hr + 1; r < rows.length; r++) {
      const row = rows[r]
      const no = clean(row[start + 0])
      const company = clean(row[start + 1])
      const mgr = clean(row[start + 2])
      const mgrPhone = clean(row[start + 3])
      const vice = clean(row[start + 4])
      const vicePhone = clean(row[start + 5])
      const head = clean(row[start + 6])
      const headPhone = clean(row[start + 7])

      if (company) {
        cur = { no, company, vice, vicePhone, head, headPhone, managers: [] }
        list.push(cur)
        if (mgr) cur.managers.push({ name: mgr, phone: mgrPhone })
      } else if (mgr && cur) {
        // 같은 보험사에 매니저가 여러 명인 연속 행
        cur.managers.push({ name: mgr, phone: mgrPhone })
        if (vice && !cur.vice) {
          cur.vice = vice
          cur.vicePhone = vicePhone
        }
        if (head && !cur.head) {
          cur.head = head
          cur.headPhone = headPhone
        }
      }
    }
  })
}

/** 엑셀 파일(ArrayBuffer)을 파싱해 매니저 연락처 데이터로 변환한다. */
export function parseWorkbook(buf: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buf, { type: 'array' })
  const data = empty()
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1,
      raw: false,
      defval: ''
    }) as unknown[][]
    parseSheet(rows, data)
  }
  const c = countContacts(data)
  return { data, companies: c.companies, managers: c.managers }
}

/** 업로드 데이터를 기존 데이터에 병합한다(보험사 단위, 매니저 중복 제거). */
export function mergeContacts(base: ContactsData, incoming: ContactsData): ContactsData {
  const out = normalizeData(JSON.parse(JSON.stringify(base)))
  for (const cat of ['sonbo', 'saengbo'] as Category[]) {
    for (const inc of incoming[cat]) {
      const existing = out[cat].find((x) => x.company === inc.company)
      if (!existing) {
        out[cat].push(JSON.parse(JSON.stringify(inc)))
        continue
      }
      if (inc.vice && !existing.vice) {
        existing.vice = inc.vice
        existing.vicePhone = inc.vicePhone
      }
      if (inc.head && !existing.head) {
        existing.head = inc.head
        existing.headPhone = inc.headPhone
      }
      for (const m of inc.managers) {
        if (!existing.managers.some((e) => e.name === m.name && e.phone === m.phone)) {
          existing.managers.push(m)
        }
      }
    }
  }
  return out
}

/** 현재 데이터를 엑셀 파일로 내보낸다(브라우저 다운로드). */
export function exportContacts(data: ContactsData): void {
  const rows: (string | number)[][] = [
    ['구분', 'No', '보험사', '설계매니저', '연락처', '부지점장', '연락처', '지점장', '연락처']
  ]
  for (const cat of ['sonbo', 'saengbo'] as Category[]) {
    for (const co of data[cat]) {
      const mgrs = co.managers.length ? co.managers : [{ name: '', phone: '' }]
      mgrs.forEach((m, i) => {
        rows.push([
          i === 0 ? CATEGORY_SHORT[cat] : '',
          i === 0 ? co.no : '',
          i === 0 ? co.company : '',
          m.name,
          m.phone,
          i === 0 ? co.vice : '',
          i === 0 ? co.vicePhone : '',
          i === 0 ? co.head : '',
          i === 0 ? co.headPhone : ''
        ])
      })
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '매니저연락처')
  XLSX.writeFile(wb, '매니저연락처.xlsx')
}
