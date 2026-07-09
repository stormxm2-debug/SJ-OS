import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * 고객등록(보험사) 요청 서비스.
 * 직원이 고객+보험사들을 골라 요청 → 관리자 전용 창에서 완료/반려 → 완료 시
 * customers.registered_insurers에 병합되고, 실시간 UPDATE 이벤트로 요청 직원에게
 * 알림이 간다. RLS: 조회=본인+관리자, 생성=본인, 처리=관리자.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 보험사 선택지 (주요 12개사 + 기타). */
export const INSURERS = [
  '삼성화재',
  '삼성생명',
  '한화생명',
  '교보생명',
  '메리츠화재',
  '현대해상',
  'DB손해보험',
  'KB손해보험',
  '흥국화재',
  '롯데손해보험',
  'NH농협손해보험',
  '라이나생명',
  '기타'
] as const

export type RegistrationStatus = 'requested' | 'done' | 'rejected'

export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  requested: '대기',
  done: '완료',
  rejected: '반려'
}

export interface CustomerRegistration {
  id: string
  customerId: string
  customerName: string
  staffId: string
  staffName: string
  insurers: string[]
  status: RegistrationStatus
  note?: string
  requestedAt: string
  processedAt?: string
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

const COLS =
  'id, customer_id, staff_id, insurers, status, note, requested_at, processed_at, customer:customers(id, name), staff:profiles(id, name)'

function mapRow(r: Record<string, any>): CustomerRegistration {
  const cust = (r.customer as Record<string, any> | null) ?? null
  const staff = (r.staff as Record<string, any> | null) ?? null
  return {
    id: String(r.id),
    customerId: String(r.customer_id ?? ''),
    customerName: cust ? String(cust.name ?? '') : '',
    staffId: String(r.staff_id ?? ''),
    staffName: staff ? String(staff.name ?? '') : '',
    insurers: Array.isArray(r.insurers) ? (r.insurers as string[]) : [],
    status: (r.status as RegistrationStatus) ?? 'requested',
    note: (r.note as string | null) ?? undefined,
    requestedAt: String(r.requested_at ?? ''),
    processedAt: (r.processed_at as string | null) ?? undefined
  }
}

/** 요청 목록 (RLS: 본인 것 / 관리자는 전체). */
export async function listRegistrations(): Promise<{ ok: boolean; items: CustomerRegistration[]; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, items: [], error: '서버 연결 후 사용할 수 있습니다.' }
  if (!(await uid(client))) return { ok: false, items: [], error: '로그인 후 사용할 수 있습니다.' }
  try {
    const { data, error } = await client
      .from('customer_registrations')
      .select(COLS)
      .order('requested_at', { ascending: false })
      .limit(200)
    if (error) return { ok: false, items: [], error: '등록 요청을 불러오지 못했습니다.' }
    return { ok: true, items: ((data as any[]) ?? []).map(mapRow) }
  } catch {
    return { ok: false, items: [], error: '등록 요청을 불러오지 못했습니다.' }
  }
}

/** 고객등록 요청 생성 (직원). */
export async function createRegistration(customerId: string, insurers: string[]): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const me = await uid(client)
  if (!me) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  if (insurers.length === 0) return { ok: false, error: '등록할 보험사를 선택해주세요.' }
  try {
    const { error } = await client.from('customer_registrations').insert({
      customer_id: customerId,
      staff_id: me,
      insurers
    })
    if (error) return { ok: false, error: '요청 저장에 실패했습니다.' }
    return { ok: true }
  } catch {
    return { ok: false, error: '요청 저장에 실패했습니다.' }
  }
}

/**
 * 관리자 처리: 완료 시 고객의 registered_insurers에 병합(중복 제거) 후 상태 갱신.
 * 반려 시 상태만. UPDATE 이벤트가 요청 직원에게 실시간 알림으로 전달된다.
 */
export async function processRegistration(
  reg: CustomerRegistration,
  action: 'done' | 'rejected',
  note?: string
): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const me = await uid(client)
  if (!me) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  try {
    if (action === 'done') {
      const { data: cust } = await client.from('customers').select('registered_insurers').eq('id', reg.customerId).maybeSingle()
      const existing: string[] = Array.isArray(cust?.registered_insurers) ? cust.registered_insurers : []
      const merged = [...new Set([...existing, ...reg.insurers])]
      const { error: cErr } = await client.from('customers').update({ registered_insurers: merged, updated_at: new Date().toISOString() }).eq('id', reg.customerId)
      if (cErr) return { ok: false, error: '고객 보험사 반영에 실패했습니다.' }
    }
    const { error } = await client
      .from('customer_registrations')
      .update({ status: action, note: note?.trim() || null, processed_at: new Date().toISOString(), processed_by: me })
      .eq('id', reg.id)
    if (error) return { ok: false, error: '처리 상태 저장에 실패했습니다.' }
    return { ok: true }
  } catch {
    return { ok: false, error: '처리 중 오류가 발생했습니다.' }
  }
}
