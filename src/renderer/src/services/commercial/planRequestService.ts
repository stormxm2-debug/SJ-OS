import type { CustomerRecord } from '@shared/commercial/models'
import { getSupabaseClient, initSupabaseClient } from './supabaseClient'
import { parseRrn } from './customerValidation'

/**
 * 매니저 설계 요청서 — 고객 정보로 설계요청 문자를 자동 생성하고 이력을 추적한다.
 *
 * ① 인적사항 자동: 주민번호(rrn) → 생년월일·성별·보험연령(상령일 기준) 계산.
 * ② 문안 생성: 보험구분·특약 체크(가입금액)·운전여부·기타요청 → 문자 전문.
 * ③ 이력: plan_requests에 문안 스냅샷과 함께 저장, 상태 파이프라인
 *    (요청 → 설계받음 → 제안 → 계약/중단). RLS 본인+관리자. 데모는 localStorage.
 */

export type PlanRequestStatus = 'requested' | 'received' | 'proposed' | 'contracted' | 'dropped'

export const PLAN_STATUS_LABEL: Record<PlanRequestStatus, string> = {
  requested: '요청함',
  received: '설계받음',
  proposed: '제안함',
  contracted: '계약',
  dropped: '중단'
}

/** 상태 진행 순서 (dropped는 어디서든 가능한 종결). */
export const PLAN_STATUS_FLOW: PlanRequestStatus[] = ['requested', 'received', 'proposed', 'contracted']

export function nextPlanStatus(status: PlanRequestStatus): PlanRequestStatus | null {
  const i = PLAN_STATUS_FLOW.indexOf(status)
  if (i < 0 || i >= PLAN_STATUS_FLOW.length - 1) return null
  return PLAN_STATUS_FLOW[i + 1]
}

export interface CoverageItem {
  name: string
  /** 표시 문자열 그대로 (예: '5,000만원', '1억'). */
  amount: string
}

export interface PlanRequest {
  id: string
  fcId: string
  fcName: string | null
  customerId: string | null
  customerName: string
  insuranceKind: string
  coverages: CoverageItem[]
  driving: string | null
  extraRequest: string | null
  messageText: string
  managerName: string | null
  status: PlanRequestStatus
  createdAt: string
}

export const INSURANCE_KINDS = [
  '종합건강보험',
  '암보험',
  '뇌·심장(2대질환)',
  '운전자보험',
  '간편심사(유병자)',
  '어린이보험',
  '치아보험',
  '화재·일상배상',
  '기타'
] as const

export const DRIVING_OPTIONS = ['자가용 운전', '영업용 운전', '비운전', '미확인'] as const

/** 자주 쓰는 특약 프리셋 — 체크 후 금액만 고르면 된다. */
export const COVERAGE_PRESETS: string[] = [
  '일반암 진단비',
  '유사암 진단비',
  '뇌혈관질환 진단비',
  '허혈성심장질환 진단비',
  '뇌졸중 진단비',
  '급성심근경색 진단비',
  '질병 수술비',
  '상해 수술비',
  '질병 입원일당',
  '상해 입원일당',
  '표적항암약물치료비',
  '후유장해(3% 이상)'
]

/** 금액 빠른 선택 칩. */
export const AMOUNT_PRESETS = ['1,000만원', '2,000만원', '3,000만원', '5,000만원', '1억', '2만원', '3만원', '5만원']

/* ---------- 보험연령 (상령일) ---------- */

/**
 * 보험연령 = 만 나이, 단 생일로부터 6개월이 지났으면 +1 (상령일 규칙).
 * 생년월일 문자열(YYYY-MM-DD)이 없거나 형식이 다르면 null.
 */
export function insuranceAge(birthDate: string | undefined, now: Date = new Date()): number | null {
  if (!birthDate) return null
  const m = birthDate.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const by = Number(m[1])
  const bm = Number(m[2])
  const bd = Number(m[3])
  let age = now.getFullYear() - by
  const hadBirthday = now.getMonth() + 1 > bm || (now.getMonth() + 1 === bm && now.getDate() >= bd)
  if (!hadBirthday) age -= 1
  if (age < 0 || age > 130) return null
  // 상령일: 생일 + 6개월 경과 시 +1
  const half = new Date(now.getFullYear(), bm - 1 + 6, bd)
  if (!hadBirthday) half.setFullYear(half.getFullYear() - 1)
  if (now.getTime() >= half.getTime()) age += 1
  return age
}

/** 고객 레코드 → 인적사항(생년월일·성별·보험연령). rrn 우선, 없으면 birthDate. */
export function customerProfileInfo(c: CustomerRecord): { birthDate?: string; gender?: '남' | '여'; insAge: number | null } {
  const rrn = parseRrn(c.rrn)
  const birthDate = rrn?.birthDate ?? c.birthDate
  return { birthDate, gender: rrn?.gender, insAge: insuranceAge(birthDate) }
}

/* ---------- 문안 생성 ---------- */

export interface PlanMessageInput {
  customerName: string
  gender?: '남' | '여'
  birthDate?: string
  insAge: number | null
  driving: string
  insuranceKind: string
  coverages: CoverageItem[]
  extraRequest: string
}

/** 참고 UX(설계요청 문자) 포맷 그대로 — 매니저에게 바로 보내는 전문. */
export function buildPlanRequestMessage(input: PlanMessageInput): string {
  const lines: string[] = ['[매니저 설계 요청서]', '']
  lines.push('■ 고객 정보')
  lines.push(`- 성함: ${input.customerName}${input.gender ? ` (${input.gender})` : ''}`)
  lines.push(
    `- 생년월일: ${input.birthDate ?? '(미입력)'} (보험연령: ${input.insAge !== null ? `${input.insAge}세` : '계산불가'})`
  )
  lines.push(`- 운전 여부: ${input.driving}`)
  lines.push('')
  lines.push('■ 요청 보험')
  lines.push(`- 구분: ${input.insuranceKind}`)
  lines.push('')
  lines.push('■ 요청 특약 및 가입금액')
  if (input.coverages.length === 0) {
    lines.push('- (특약 미지정 — 추천 구성 부탁드립니다)')
  } else {
    for (const c of input.coverages) lines.push(`- ${c.name}: ${c.amount}`)
  }
  lines.push('')
  lines.push('■ 기타 요청사항')
  lines.push(`- ${input.extraRequest.trim() || '최저 보험료 및 가성비 좋은 플랜으로 설계 부탁드립니다.'}`)
  return lines.join('\n')
}

/* ---------- CRUD (Supabase + 데모 localStorage 폴백) ---------- */

/* eslint-disable @typescript-eslint/no-explicit-any */

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}

async function uid(client: any): Promise<string | null> {
  try {
    const { data } = await client.auth.getUser()
    return data?.user?.id ?? null
  } catch {
    return null
  }
}

const VALID_STATUS: PlanRequestStatus[] = ['requested', 'received', 'proposed', 'contracted', 'dropped']

function mapRow(r: Record<string, any>): PlanRequest {
  const raw = String(r.status ?? 'requested') as PlanRequestStatus
  const cov = Array.isArray(r.coverages) ? r.coverages : []
  return {
    id: String(r.id),
    fcId: String(r.fc_id ?? ''),
    fcName: r.fc_name ?? null,
    customerId: r.customer_id ?? null,
    customerName: String(r.customer_name ?? ''),
    insuranceKind: String(r.insurance_kind ?? ''),
    coverages: cov.map((c: any) => ({ name: String(c?.name ?? ''), amount: String(c?.amount ?? '') })).filter((c: CoverageItem) => c.name),
    driving: r.driving ?? null,
    extraRequest: r.extra_request ?? null,
    messageText: String(r.message_text ?? ''),
    managerName: r.manager_name ?? null,
    status: VALID_STATUS.includes(raw) ? raw : 'requested',
    createdAt: String(r.created_at ?? '')
  }
}

const LOCAL_KEY = 'sjos.planrequests.v1'

function loadLocal(): PlanRequest[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? (arr as PlanRequest[]) : []
  } catch {
    return []
  }
}

function saveLocal(rows: PlanRequest[]): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(rows))
  } catch {
    /* 데모 폴백 — 저장 실패는 조용히 무시 */
  }
}

export type PlanDataMode = 'supabase' | 'local'

export async function listPlanRequests(): Promise<{ ok: boolean; mode: PlanDataMode; requests: PlanRequest[]; error?: string }> {
  const client = await getClient()
  if (client && (await uid(client))) {
    try {
      const { data, error } = await client
        .from('plan_requests')
        .select('id, fc_id, fc_name, customer_id, customer_name, insurance_kind, coverages, driving, extra_request, message_text, manager_name, status, created_at')
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) return { ok: false, mode: 'supabase', requests: [], error: error.message }
      return { ok: true, mode: 'supabase', requests: ((data as any[]) ?? []).map(mapRow) }
    } catch {
      return { ok: false, mode: 'supabase', requests: [], error: '요청 이력을 불러오지 못했습니다.' }
    }
  }
  return { ok: true, mode: 'local', requests: loadLocal() }
}

export interface CreatePlanRequestInput {
  customerId?: string
  customerName: string
  insuranceKind: string
  coverages: CoverageItem[]
  driving: string
  extraRequest: string
  messageText: string
  managerName?: string
}

export async function createPlanRequest(
  input: CreatePlanRequestInput,
  actor: { id: string; name: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!input.customerName.trim()) return { ok: false, error: '고객 이름이 필요합니다.' }
  const client = await getClient()
  if (client) {
    const me = await uid(client)
    if (me) {
      try {
        const { error } = await client.from('plan_requests').insert({
          fc_id: me,
          fc_name: actor.name || null,
          customer_id: input.customerId ?? null,
          customer_name: input.customerName.trim(),
          insurance_kind: input.insuranceKind,
          coverages: input.coverages,
          driving: input.driving || null,
          extra_request: input.extraRequest.trim() || null,
          message_text: input.messageText,
          manager_name: input.managerName?.trim() || null
        })
        if (error) return { ok: false, error: error.message }
        return { ok: true }
      } catch {
        return { ok: false, error: '요청 저장 중 오류가 발생했습니다.' }
      }
    }
  }
  const rows = loadLocal()
  rows.unshift({
    id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    fcId: actor.id,
    fcName: actor.name,
    customerId: input.customerId ?? null,
    customerName: input.customerName.trim(),
    insuranceKind: input.insuranceKind,
    coverages: input.coverages,
    driving: input.driving || null,
    extraRequest: input.extraRequest.trim() || null,
    messageText: input.messageText,
    managerName: input.managerName?.trim() || null,
    status: 'requested',
    createdAt: new Date().toISOString()
  })
  saveLocal(rows)
  return { ok: true }
}

export async function updatePlanRequestStatus(id: string, status: PlanRequestStatus): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (client && (await uid(client))) {
    try {
      const { error } = await client.from('plan_requests').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) return { ok: false, error: error.message }
      return { ok: true }
    } catch {
      return { ok: false, error: '상태 변경 중 오류가 발생했습니다.' }
    }
  }
  const rows = loadLocal()
  const row = rows.find((r) => r.id === id)
  if (!row) return { ok: false, error: '대상을 찾지 못했습니다.' }
  row.status = status
  saveLocal(rows)
  return { ok: true }
}

export async function deletePlanRequest(id: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (client && (await uid(client))) {
    try {
      const { error } = await client.from('plan_requests').delete().eq('id', id)
      if (error) return { ok: false, error: error.message }
      return { ok: true }
    } catch {
      return { ok: false, error: '삭제 중 오류가 발생했습니다.' }
    }
  }
  saveLocal(loadLocal().filter((r) => r.id !== id))
  return { ok: true }
}
