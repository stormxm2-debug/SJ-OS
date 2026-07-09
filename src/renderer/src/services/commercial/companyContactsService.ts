import { getSupabaseClient, initSupabaseClient } from './supabaseClient'
import { INSURERS } from './registrationService'

/**
 * 보험사 매니저 연락처부 서비스.
 * 서버(company_contacts)에서 중앙 관리 — RLS: 조회=전 직원, 등록/수정/삭제=owner·admin.
 * 직원은 앱에서 바로 통화/문자하거나 vCard(.vcf)로 내 폰 주소록에 저장한다.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CompanyContact {
  id: string
  insurer: string
  managerName: string
  title: string
  phone: string
  officePhone?: string
  email?: string
  memo?: string
  sortOrder: number
  updatedAt: string
}

export interface CompanyContactDraft {
  insurer: string
  managerName: string
  title: string
  phone: string
  officePhone?: string
  email?: string
  memo?: string
}

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}

async function uid(client: any): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession()
    return data?.session?.user?.id ?? null
  } catch {
    return null
  }
}

function mapRow(r: Record<string, any>): CompanyContact {
  return {
    id: String(r.id),
    insurer: String(r.insurer ?? ''),
    managerName: String(r.manager_name ?? ''),
    title: String(r.title ?? '매니저'),
    phone: String(r.phone ?? ''),
    officePhone: (r.office_phone as string | null) ?? undefined,
    email: (r.email as string | null) ?? undefined,
    memo: (r.memo as string | null) ?? undefined,
    sortOrder: Number(r.sort_order ?? 0),
    updatedAt: String(r.updated_at ?? '')
  }
}

/** 보험사 목록(INSURERS) 순서 → 같은 회사 안에서는 sort_order → 이름 순. */
function insurerRank(insurer: string): number {
  const i = (INSURERS as readonly string[]).indexOf(insurer)
  return i === -1 ? INSURERS.length : i
}

export function sortContacts(items: CompanyContact[]): CompanyContact[] {
  return [...items].sort((a, b) => {
    const r = insurerRank(a.insurer) - insurerRank(b.insurer)
    if (r !== 0) return r
    if (a.insurer !== b.insurer) return a.insurer.localeCompare(b.insurer, 'ko')
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.managerName.localeCompare(b.managerName, 'ko')
  })
}

/** 매니저 연락처 전체 목록 (전 직원 조회 가능). */
export async function listCompanyContacts(): Promise<{ ok: boolean; items: CompanyContact[]; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, items: [], error: '서버 연결 후 사용할 수 있습니다.' }
  if (!(await uid(client))) return { ok: false, items: [], error: '로그인 후 사용할 수 있습니다.' }
  try {
    const { data, error } = await client.from('company_contacts').select('*').limit(500)
    if (error) return { ok: false, items: [], error: '연락처를 불러오지 못했습니다.' }
    return { ok: true, items: sortContacts(((data as any[]) ?? []).map(mapRow)) }
  } catch {
    return { ok: false, items: [], error: '연락처를 불러오지 못했습니다.' }
  }
}

function draftToRow(draft: CompanyContactDraft, me: string): Record<string, unknown> {
  return {
    insurer: draft.insurer.trim(),
    manager_name: draft.managerName.trim(),
    title: draft.title.trim() || '매니저',
    phone: draft.phone.trim(),
    office_phone: draft.officePhone?.trim() || null,
    email: draft.email?.trim() || null,
    memo: draft.memo?.trim() || null,
    updated_by: me
  }
}

/** 등록/수정 (owner·admin 전용 — RLS가 강제). id가 있으면 수정. */
export async function saveCompanyContact(
  draft: CompanyContactDraft,
  id?: string
): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const me = await uid(client)
  if (!me) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  if (!draft.insurer.trim()) return { ok: false, error: '보험사를 선택해주세요.' }
  if (!draft.managerName.trim()) return { ok: false, error: '매니저 이름을 입력해주세요.' }
  if (!draft.phone.trim()) return { ok: false, error: '휴대폰 번호를 입력해주세요.' }
  try {
    const row = draftToRow(draft, me)
    const q = id
      ? client.from('company_contacts').update(row).eq('id', id)
      : client.from('company_contacts').insert(row)
    const { error } = await q
    if (error) return { ok: false, error: '저장에 실패했습니다. (관리자만 등록·수정할 수 있습니다)' }
    return { ok: true }
  } catch {
    return { ok: false, error: '저장에 실패했습니다.' }
  }
}

/** 삭제 (owner·admin 전용 — RLS가 강제). */
export async function deleteCompanyContact(id: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  if (!(await uid(client))) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  try {
    const { error } = await client.from('company_contacts').delete().eq('id', id)
    if (error) return { ok: false, error: '삭제에 실패했습니다. (관리자만 삭제할 수 있습니다)' }
    return { ok: true }
  } catch {
    return { ok: false, error: '삭제에 실패했습니다.' }
  }
}

// ---------- 내 폰 저장 이력 (기기별 localStorage — '변경됨' 뱃지 기준) ----------

const SAVED_KEY = 'sj-contact-saved-v1'

function readSavedMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(SAVED_KEY)
    const obj: unknown = raw ? JSON.parse(raw) : {}
    return obj && typeof obj === 'object' ? (obj as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** 이 기기에서 해당 연락처를 마지막으로 폰에 저장한 시각(ISO). */
export function getSavedAt(contactId: string): string | undefined {
  return readSavedMap()[contactId]
}

/** 폰 저장 완료 표시 — 단건/전체 저장 후 호출. */
export function markSavedToPhone(contactIds: string[]): void {
  const map = readSavedMap()
  const now = new Date().toISOString()
  for (const id of contactIds) map[id] = now
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(map))
  } catch {
    /* 저장 실패(사파리 프라이빗 등)여도 앱은 계속 동작 */
  }
}

/** 서버에서 번호가 바뀐 뒤 아직 폰에 다시 저장하지 않은 상태인가? (저장한 적 없으면 false) */
export function isStaleOnPhone(c: CompanyContact): boolean {
  const savedAt = getSavedAt(c.id)
  if (!savedAt) return false
  return new Date(c.updatedAt).getTime() > new Date(savedAt).getTime()
}
