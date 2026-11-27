import { getSupabaseClient, initSupabaseClient } from './supabaseClient'
import { sendRegistrationPush } from '@renderer/services/push/webPush'

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

/**
 * 고객등록 체크박스 전용 — 국내 손해보험사 전체 (+기타).
 * 대표 지시(2026-11-21): 고객등록 시 손해보험사를 전부 노출한다(생명보험사 제외).
 * ⚠ 공유 목록 INSURERS(팩스·면제·인수심사·급여·연락처 정렬 등)는 건드리지 않는다.
 */
export const REGISTRATION_INSURERS = [
  '삼성화재',
  '현대해상',
  'DB손해보험',
  'KB손해보험',
  '메리츠화재',
  '한화손해보험',
  '롯데손해보험',
  '흥국화재',
  'NH농협손해보험',
  'MG손해보험',
  '하나손해보험',
  'AXA손해보험',
  '캐롯손해보험',
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
  /** FC가 입력한 고객 정보 — 총무가 보험사 전산에 등록할 때 보는 값 (현재 고객 카드 기준). */
  customer?: RegistrationCustomerInfo
}

export interface RegistrationCustomerInfo {
  phone?: string
  rrn?: string
  birthDate?: string
  address?: string
  medicalHistory?: string
  heightCm?: number
  weightKg?: number
  relation?: string
  memo?: string
  source?: string
  attachmentCount: number
  attachments: { path: string; name: string; kind: 'image' | 'pdf' | 'audio' }[]
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
  'id, customer_id, staff_id, insurers, status, note, requested_at, processed_at, customer:customers(id, name, phone, rrn, birth_date, address, medical_history, height_cm, weight_kg, relation, memo, source, attachments), staff:profiles(id, name)'

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
    processedAt: (r.processed_at as string | null) ?? undefined,
    customer: cust
      ? {
          phone: (cust.phone as string | null) ?? undefined,
          rrn: (cust.rrn as string | null) ?? undefined,
          birthDate: (cust.birth_date as string | null) ?? undefined,
          address: (cust.address as string | null) ?? undefined,
          medicalHistory: (cust.medical_history as string | null) ?? undefined,
          heightCm: cust.height_cm != null ? Number(cust.height_cm) : undefined,
          weightKg: cust.weight_kg != null ? Number(cust.weight_kg) : undefined,
          relation: (cust.relation as string | null) ?? undefined,
          memo: (cust.memo as string | null) ?? undefined,
          source: (cust.source as string | null) ?? undefined,
          attachmentCount: Array.isArray(cust.attachments) ? cust.attachments.length : 0,
          attachments: Array.isArray(cust.attachments) ? (cust.attachments as RegistrationCustomerInfo['attachments']) : []
        }
      : undefined
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
export async function createRegistration(customerId: string, insurers: string[]): Promise<{ ok: boolean; error?: string; id?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const me = await uid(client)
  if (!me) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  if (insurers.length === 0) return { ok: false, error: '등록할 보험사를 선택해주세요.' }
  try {
    const { data, error } = await client
      .from('customer_registrations')
      .insert({
        customer_id: customerId,
        staff_id: me,
        insurers
      })
      .select('id')
      .single()
    if (error) return { ok: false, error: '요청 저장에 실패했습니다.' }
    const id = data?.id ? String(data.id) : ''
    if (id) void sendRegistrationPush(id, 'new')
    return { ok: true, id }
  } catch {
    return { ok: false, error: '요청 저장에 실패했습니다.' }
  }
}

/**
 * 처리 되돌리기: 완료·반려를 다시 '대기'로 되돌린다(다시 처리할 수 있게).
 * 이미 고객 카드에 반영된 보험사는 그대로 남는다(지우지 않음).
 */
export async function reopenRegistration(reg: CustomerRegistration): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  try {
    const { error } = await client
      .from('customer_registrations')
      .update({ status: 'requested', processed_at: null, processed_by: null })
      .eq('id', reg.id)
    if (error) return { ok: false, error: '되돌리기에 실패했습니다.' }
    return { ok: true }
  } catch {
    return { ok: false, error: '되돌리기 중 오류가 발생했습니다.' }
  }
}

/**
 * 총무 메모 저장 (상태는 그대로 — 대기·완료·반려 모두 가능). 저장되면 UPDATE 이벤트가 요청 FC 본인에게
 * "총무 메모 도착" 알림으로 전달되어, FC가 다시 연락을 받을 수 있다.
 */
export async function saveRegistrationNote(reg: CustomerRegistration, note: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const text = note.trim()
  if (!text) return { ok: false, error: '메모 내용을 입력해주세요.' }
  try {
    const { error } = await client.from('customer_registrations').update({ note: text }).eq('id', reg.id)
    if (error) return { ok: false, error: '메모 저장에 실패했습니다.' }
    void sendRegistrationPush(reg.id, 'memo')
    return { ok: true }
  } catch {
    return { ok: false, error: '메모 저장 중 오류가 발생했습니다.' }
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
      // 처리 메모를 따로 넘긴 경우에만 덮어쓴다 — 기존 총무 메모가 완료/반려 시 지워지지 않게.
      .update({
        status: action,
        ...(note?.trim() ? { note: note.trim() } : {}),
        processed_at: new Date().toISOString(),
        processed_by: me
      })
      .eq('id', reg.id)
    if (error) return { ok: false, error: '처리 상태 저장에 실패했습니다.' }
    void sendRegistrationPush(reg.id, action)
    return { ok: true }
  } catch {
    return { ok: false, error: '처리 중 오류가 발생했습니다.' }
  }
}
