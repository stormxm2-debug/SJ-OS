import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * 직원 복지 — 본인·가족 생일. 직원이 본인/가족의 이름·관계·주민번호 앞자리(생년월일)를
 * 등록하면, 관리자가 전 직원분을 모아보고 생일 3일 전~당일에 관리자에게만 알림이 간다.
 * 🔒 주민번호는 앞 6~7자리(생년월일)만 저장·조회한다.
 * 테이블 미적용(42P01)=configured:false 로 조용히 처리.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const FAMILY_RELATIONS = ['본인', '배우자', '자녀', '부모', '형제자매', '기타'] as const
export type FamilyRelation = (typeof FAMILY_RELATIONS)[number]

export interface FamilyBirthday {
  id: string
  staffId: string
  staffName: string
  name: string
  relation: FamilyRelation
  rrnFront: string
}

export interface FamilyBirthdayInput {
  name: string
  relation: FamilyRelation
  rrnFront: string
}

/** 주민번호 앞자리(6~7숫자) → 생일 정보. 6자리면 나이·연도 없이 월/일만. */
export function birthdayInfo(rrnFront: string): { md: string; label: string; daysUntil: number; age?: number } | null {
  const d = (rrnFront ?? '').replace(/\D/g, '')
  if (d.length < 6) return null
  const mm = Number(d.slice(2, 4))
  const dd = Number(d.slice(4, 6))
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const md = `${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`

  // 다가오는 생일까지 남은 일수
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let next = new Date(today.getFullYear(), mm - 1, dd)
  if (Number.isNaN(next.getTime())) return { md, label: `${mm}월 ${dd}일`, daysUntil: 999 }
  if (next < today) next = new Date(today.getFullYear() + 1, mm - 1, dd)
  const daysUntil = Math.round((next.getTime() - today.getTime()) / 86400000)

  // 나이(7자리로 세기 판별 가능할 때만)
  let age: number | undefined
  if (d.length >= 7) {
    const yy = Number(d.slice(0, 2))
    const s = Number(d[6])
    const century = s === 9 || s === 0 ? 1800 : s === 1 || s === 2 || s === 5 || s === 6 ? 1900 : 2000
    const year = century + yy
    let a = today.getFullYear() - year
    if (today.getMonth() + 1 < mm || (today.getMonth() + 1 === mm && today.getDate() < dd)) a -= 1
    if (a >= 0 && a <= 130) age = a
  }
  return { md, label: `${mm}월 ${dd}일`, daysUntil, age }
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
function isMissingSetup(err: any): boolean {
  const code = String(err?.code ?? '')
  const msg = String(err?.message ?? '')
  return code === '42P01' || /relation .* does not exist|could not find the table/i.test(msg)
}

function mapRow(r: Record<string, any>): FamilyBirthday {
  return {
    id: String(r.id),
    staffId: String(r.staff_id ?? ''),
    staffName: String(r.staff?.name ?? ''),
    name: String(r.name ?? ''),
    relation: (r.relation as FamilyRelation) ?? '기타',
    rrnFront: String(r.rrn_front ?? '')
  }
}

/** 내가 등록한 본인·가족 생일. configured=false 면 설정 전. */
export async function listMyFamilyBirthdays(): Promise<{ items: FamilyBirthday[]; configured: boolean }> {
  const client = await getClient()
  if (!client) return { items: [], configured: false }
  const me = await uid(client)
  if (!me) return { items: [], configured: true }
  const { data, error } = await client
    .from('staff_family_birthdays')
    .select('*, staff:profiles(name)')
    .eq('staff_id', me)
    .order('relation', { ascending: true })
  if (error) {
    if (isMissingSetup(error)) return { items: [], configured: false }
    return { items: [], configured: true }
  }
  return { items: ((data ?? []) as Record<string, any>[]).map(mapRow), configured: true }
}

/** 관리자 — 전 직원 본인·가족 생일 (RLS로 관리자만 전체 조회). */
export async function listAllFamilyBirthdays(): Promise<{ items: FamilyBirthday[]; configured: boolean }> {
  const client = await getClient()
  if (!client) return { items: [], configured: false }
  const { data, error } = await client
    .from('staff_family_birthdays')
    .select('*, staff:profiles(name)')
    .order('created_at', { ascending: false })
  if (error) {
    if (isMissingSetup(error)) return { items: [], configured: false }
    return { items: [], configured: true }
  }
  return { items: ((data ?? []) as Record<string, any>[]).map(mapRow), configured: true }
}

export async function createFamilyBirthday(input: FamilyBirthdayInput): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const me = await uid(client)
  if (!me) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  const front = input.rrnFront.replace(/\D/g, '')
  if (!input.name.trim()) return { ok: false, error: '이름을 입력해주세요.' }
  if (front.length < 6 || front.length > 7) return { ok: false, error: '주민번호 앞자리(생년월일 6자리)를 정확히 입력해주세요.' }
  if (!birthdayInfo(front)) return { ok: false, error: '생년월일이 올바르지 않습니다.' }
  const { error } = await client.from('staff_family_birthdays').insert({
    staff_id: me,
    name: input.name.trim(),
    relation: input.relation,
    rrn_front: front
  })
  if (error) {
    if (isMissingSetup(error)) return { ok: false, error: '생일 복지가 아직 설정되지 않았습니다(테이블 미적용).' }
    return { ok: false, error: error.message ?? '저장에 실패했습니다.' }
  }
  return { ok: true }
}

export async function deleteFamilyBirthday(id: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const { error } = await client.from('staff_family_birthdays').delete().eq('id', id)
  if (error) return { ok: false, error: error.message ?? '삭제에 실패했습니다.' }
  return { ok: true }
}

// ── 로그인 게이트 열기 신호 (메뉴에서 수동으로도 열 수 있게) ────────────────────
type GateListener = () => void
const gateListeners = new Set<GateListener>()
export function openFamilyBirthdayGate(): void {
  gateListeners.forEach((fn) => fn())
}
export function subscribeFamilyBirthdayGate(fn: GateListener): () => void {
  gateListeners.add(fn)
  return () => {
    gateListeners.delete(fn)
  }
}
