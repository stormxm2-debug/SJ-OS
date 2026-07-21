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
  /** 보장범위 카테고리 (보장분석표 기준 — 문안에서 그룹 헤더로 사용). */
  category?: string
}

/** 설계 조건 — v2. 전부 선택 입력 (있는 것만 문안에 실린다). */
export interface PlanConditions {
  /** 월 보험료 예산 (예: '월 10만원 내'). */
  budget?: string
  /** 납입기간 (예: '20년납'). */
  paymentTerm?: string
  /** 만기 (예: '100세'). */
  maturity?: string
  /** 갱신형태 (예: '비갱신 위주'). */
  renewal?: string
  /** 병력 고지 스냅샷 — 포함 시 문안 ■병력 고지 섹션으로. */
  medicalNotes?: string
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
  /** 요청 보험사(복수 = 비교견적). v1 데이터는 빈 배열. */
  insurers: string[]
  /** 계약자명 — null이면 피보험자 본인 계약. */
  policyholderName: string | null
  conditions: PlanConditions
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

/* ---------- 설계 조건 옵션 (v2) ---------- */

export const BUDGET_PRESETS = ['월 5만원 내', '월 10만원 내', '월 15만원 내', '월 20만원 내', '월 30만원 내'] as const
export const PAYMENT_TERM_OPTIONS = ['10년납', '15년납', '20년납', '30년납', '전기납'] as const
export const MATURITY_OPTIONS = ['80세', '90세', '100세', '종신'] as const
export const RENEWAL_OPTIONS = ['비갱신 위주', '갱신 포함 가성비', '상관없음'] as const

export interface CoverageGroup {
  category: string
  items: string[]
  /** true면 소액 담보(수술비·일당류) — 금액 칩을 만원 단위로 보여준다. */
  small?: boolean
}

/**
 * 특약 구성 — 사내 보장분석표(보장범위×담보내용) 분류 그대로.
 * (출처: '보장분석 이전이후 원본' 엑셀 — 카테고리·담보명 동일 유지)
 */
export const COVERAGE_GROUPS: CoverageGroup[] = [
  // 사망 4종: 일반사망(생보) · 질병사망(손보) · 상해사망 · 후유장해(3%) — 대표 지시
  { category: '사망', items: ['일반사망(생보)', '질병사망(손보)', '상해사망', '후유장해(3%)'] },
  { category: '암 진단비', items: ['일반암', '유사암', '항암방사선치료', '항암약물치료', '표적항암치료'] },
  { category: '뇌 진단비', items: ['뇌혈관 진단', '뇌졸중 진단', '뇌출혈 진단비'] },
  { category: '심장', items: ['허혈성 진단', '급성심근경색'] },
  { category: '입원비', items: ['간병인지원비', '간병인사용일당', '상해 입원비', '질병 입원비'], small: true },
  {
    category: '수술비',
    items: ['1~5종 수술비', '질병 수술비', '상해 수술비', '뇌수술비', '심장수술비'],
    small: true
  },
  { category: '암 수술비', items: ['암 수술비'], small: true },
  { category: '골절', items: ['골절 수술비', '깁스 치료비', '골절 진단비'], small: true },
  { category: '화상', items: ['화상 진단비'], small: true },
  { category: '실손의료비', items: ['실비'] },
  { category: '일배책', items: ['일상배상책임'] },
  // 운전자 3종 + 자부상(급수 구분 없이 단일) — 고액 담보라 small 아님
  { category: '운전자', items: ['변호사선임비용', '교통사고처리지원금', '형사합의금', '자부상(자동차부상치료비)'] },
  { category: '질병수술', items: ['N대수술'], small: true },
  { category: '치아', items: ['치아보장'], small: true }
]

/** 금액 빠른 선택 칩 — 진단비류(고액). */
export const AMOUNT_PRESETS = ['1,000만원', '2,000만원', '3,000만원', '5,000만원', '1억', '2억']

/** 금액 빠른 선택 칩 — 수술비·입원일당류(소액). */
export const AMOUNT_PRESETS_SMALL = ['10만원', '20만원', '30만원', '50만원', '100만원', '300만원', '500만원', '1,000만원']

/** 카테고리별 기본 금액·칩 세트. */
export function amountPresetsFor(category?: string): { presets: string[]; defaultAmount: string } {
  const group = COVERAGE_GROUPS.find((g) => g.category === category)
  if (group?.small) return { presets: AMOUNT_PRESETS_SMALL, defaultAmount: '30만원' }
  return { presets: AMOUNT_PRESETS, defaultAmount: '3,000만원' }
}

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
  /** v2 — 요청 보험사(복수), 매니저, 계약자, 설계 조건. 비우면 v1과 같은 문안. */
  insurers?: string[]
  managerName?: string
  policyholderName?: string
  conditions?: PlanConditions
}

/** 참고 UX(설계요청 문자) 포맷 그대로 — 매니저에게 바로 보내는 전문. */
export function buildPlanRequestMessage(input: PlanMessageInput): string {
  const lines: string[] = ['[매니저 설계 요청서]', '']

  // ■ 요청 대상 (v2 — 보험사·매니저를 지정했을 때만)
  const insurers = (input.insurers ?? []).filter(Boolean)
  const manager = input.managerName?.trim()
  if (insurers.length > 0 || manager) {
    lines.push('■ 요청 대상')
    if (insurers.length > 0) lines.push(`- 보험사: ${insurers.join(', ')}${insurers.length > 1 ? ' (비교견적 부탁드립니다)' : ''}`)
    if (manager) lines.push(`- 매니저: ${manager}`)
    lines.push('')
  }

  const policyholder = input.policyholderName?.trim()
  lines.push('■ 고객 정보')
  if (policyholder) lines.push(`- 계약자: ${policyholder}`)
  lines.push(`- ${policyholder ? '피보험자' : '성함'}: ${input.customerName}${input.gender ? ` (${input.gender})` : ''}`)
  lines.push(
    `- 생년월일: ${input.birthDate ?? '(미입력)'} (보험연령: ${input.insAge !== null ? `${input.insAge}세` : '계산불가'})`
  )
  lines.push(`- 운전 여부: ${input.driving}`)
  lines.push('')

  // ■ 설계 조건 (v2 — 하나라도 입력했을 때만)
  const cond = input.conditions ?? {}
  const condLines: string[] = []
  if (cond.budget?.trim()) condLines.push(`- 보험료 예산: ${cond.budget.trim()}`)
  const term = [cond.paymentTerm?.trim(), cond.maturity?.trim() ? `${cond.maturity.trim()}만기` : undefined].filter(Boolean).join(' · ')
  if (term) condLines.push(`- 납입/만기: ${term}`)
  if (cond.renewal?.trim()) condLines.push(`- 갱신형태: ${cond.renewal.trim()}`)
  if (condLines.length > 0) {
    lines.push('■ 설계 조건')
    lines.push(...condLines)
    lines.push('')
  }

  lines.push('■ 요청 보험')
  lines.push(`- 구분: ${input.insuranceKind}`)
  lines.push('')
  lines.push('■ 요청 특약 및 가입금액')
  if (input.coverages.length === 0) {
    lines.push('- (특약 미지정 — 추천 구성 부탁드립니다)')
  } else {
    // 보장분석표와 같은 보장범위 그룹으로 출력 (카테고리 없는 항목은 뒤에 평문).
    let lastCategory: string | undefined
    for (const c of input.coverages) {
      if (c.category && c.category !== lastCategory) {
        lines.push(`[${c.category}]`)
        lastCategory = c.category
      }
      lines.push(`- ${c.name}: ${c.amount}`)
    }
  }
  lines.push('')

  // ■ 병력 고지 (v2 — 포함을 선택했을 때만. 간편심사 요청의 필수 정보)
  if (cond.medicalNotes?.trim()) {
    lines.push('■ 병력 고지')
    for (const ln of cond.medicalNotes.trim().split(/\r?\n/)) lines.push(`- ${ln.trim()}`)
    lines.push('')
  }

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
  const cond = r.conditions && typeof r.conditions === 'object' && !Array.isArray(r.conditions) ? r.conditions : {}
  return {
    id: String(r.id),
    fcId: String(r.fc_id ?? ''),
    fcName: r.fc_name ?? null,
    customerId: r.customer_id ?? null,
    customerName: String(r.customer_name ?? ''),
    insuranceKind: String(r.insurance_kind ?? ''),
    coverages: cov
      .map((c: any) => ({
        name: String(c?.name ?? ''),
        amount: String(c?.amount ?? ''),
        category: c?.category ? String(c.category) : undefined
      }))
      .filter((c: CoverageItem) => c.name),
    driving: r.driving ?? null,
    extraRequest: r.extra_request ?? null,
    messageText: String(r.message_text ?? ''),
    managerName: r.manager_name ?? null,
    insurers: Array.isArray(r.insurers) ? r.insurers.map((x: any) => String(x)).filter(Boolean) : [],
    policyholderName: r.policyholder_name ?? null,
    conditions: {
      budget: cond.budget ? String(cond.budget) : undefined,
      paymentTerm: cond.paymentTerm ? String(cond.paymentTerm) : undefined,
      maturity: cond.maturity ? String(cond.maturity) : undefined,
      renewal: cond.renewal ? String(cond.renewal) : undefined,
      medicalNotes: cond.medicalNotes ? String(cond.medicalNotes) : undefined
    },
    status: VALID_STATUS.includes(raw) ? raw : 'requested',
    createdAt: String(r.created_at ?? '')
  }
}

const LOCAL_KEY = 'sjos.planrequests.v1'

function loadLocal(): PlanRequest[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY)
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    // v1 시절 저장분에는 v2 필드가 없다 — 기본값으로 보정.
    return (arr as PlanRequest[]).map((r) => ({
      ...r,
      insurers: Array.isArray(r.insurers) ? r.insurers : [],
      policyholderName: r.policyholderName ?? null,
      conditions: r.conditions ?? {}
    }))
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
      const V1_COLS = 'id, fc_id, fc_name, customer_id, customer_name, insurance_kind, coverages, driving, extra_request, message_text, manager_name, status, created_at'
      let { data, error } = await client
        .from('plan_requests')
        .select(`${V1_COLS}, insurers, policyholder_name, conditions`)
        .order('created_at', { ascending: false })
        .limit(300)
      // v2 컬럼이 아직 서버에 없으면(증분 SQL 미적용) v1 컬럼만으로 재시도 — 저장 쪽 폴백과 대칭.
      if (error && /column|schema/i.test(error.message ?? '')) {
        ;({ data, error } = await client
          .from('plan_requests')
          .select(V1_COLS)
          .order('created_at', { ascending: false })
          .limit(300))
      }
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
  insurers?: string[]
  policyholderName?: string
  conditions?: PlanConditions
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
      const base = {
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
      }
      try {
        const { error } = await client.from('plan_requests').insert({
          ...base,
          insurers: input.insurers ?? [],
          policyholder_name: input.policyholderName?.trim() || null,
          conditions: input.conditions ?? {}
        })
        if (!error) return { ok: true }
        // v2 컬럼이 아직 서버에 없으면(증분 SQL 미적용) v1 형식으로 재시도 —
        // 배포 순서가 바뀌어도 저장 자체는 실패하지 않게 한다. 문안 스냅샷에는
        // 어차피 전체 내용이 들어 있어 정보 유실은 문자 필드 검색뿐이다.
        if (/column|schema/i.test(error.message ?? '')) {
          const retry = await client.from('plan_requests').insert(base)
          if (!retry.error) return { ok: true }
          return { ok: false, error: retry.error.message }
        }
        return { ok: false, error: error.message }
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
    insurers: input.insurers ?? [],
    policyholderName: input.policyholderName?.trim() || null,
    conditions: input.conditions ?? {},
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

/* ---------- 자주 쓰는 특약 세트 (개인 템플릿) ---------- */

export interface PlanTemplate {
  id: string
  name: string
  insuranceKind: string
  coverages: CoverageItem[]
  driving: string | null
  conditions: PlanConditions
}

const TPL_LOCAL_KEY = 'sjos.plantemplates.v1'

function loadLocalTemplates(): PlanTemplate[] {
  try {
    const raw = window.localStorage.getItem(TPL_LOCAL_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? (arr as PlanTemplate[]) : []
  } catch {
    return []
  }
}

function saveLocalTemplates(rows: PlanTemplate[]): void {
  try {
    window.localStorage.setItem(TPL_LOCAL_KEY, JSON.stringify(rows))
  } catch {
    /* 데모 폴백 — 저장 실패는 조용히 무시 */
  }
}

function mapTemplateRow(r: Record<string, any>): PlanTemplate {
  const cov = Array.isArray(r.coverages) ? r.coverages : []
  const cond = r.conditions && typeof r.conditions === 'object' && !Array.isArray(r.conditions) ? r.conditions : {}
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    insuranceKind: String(r.insurance_kind ?? ''),
    coverages: cov
      .map((c: any) => ({
        name: String(c?.name ?? ''),
        amount: String(c?.amount ?? ''),
        category: c?.category ? String(c.category) : undefined
      }))
      .filter((c: CoverageItem) => c.name),
    driving: r.driving ?? null,
    conditions: cond as PlanConditions
  }
}

/**
 * 템플릿 목록 — 로그인 시 서버(plan_request_templates, 본인만), 아니면 localStorage.
 * 서버 테이블이 아직 없으면(증분 SQL 미적용) localStorage로 조용히 폴백한다.
 */
export async function listPlanTemplates(): Promise<PlanTemplate[]> {
  const client = await getClient()
  if (client && (await uid(client))) {
    try {
      const { data, error } = await client
        .from('plan_request_templates')
        .select('id, name, insurance_kind, coverages, driving, conditions')
        .order('created_at', { ascending: false })
        .limit(50)
      if (!error) return ((data as any[]) ?? []).map(mapTemplateRow)
    } catch {
      /* 아래 로컬 폴백 */
    }
  }
  return loadLocalTemplates()
}

export async function savePlanTemplate(input: Omit<PlanTemplate, 'id'>): Promise<{ ok: boolean; error?: string }> {
  if (!input.name.trim()) return { ok: false, error: '세트 이름을 입력해 주세요.' }
  const client = await getClient()
  if (client) {
    const me = await uid(client)
    if (me) {
      try {
        const { error } = await client.from('plan_request_templates').insert({
          fc_id: me,
          name: input.name.trim(),
          insurance_kind: input.insuranceKind,
          coverages: input.coverages,
          driving: input.driving,
          conditions: input.conditions
        })
        if (!error) return { ok: true }
        /* 테이블 미존재 등 — 아래 로컬 폴백 */
      } catch {
        /* 아래 로컬 폴백 */
      }
    }
  }
  const rows = loadLocalTemplates()
  rows.unshift({ ...input, name: input.name.trim(), id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` })
  saveLocalTemplates(rows)
  return { ok: true }
}

export async function deletePlanTemplate(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!id.startsWith('local-')) {
    const client = await getClient()
    if (client && (await uid(client))) {
      try {
        const { error } = await client.from('plan_request_templates').delete().eq('id', id)
        if (error) return { ok: false, error: error.message }
        return { ok: true }
      } catch {
        return { ok: false, error: '삭제 중 오류가 발생했습니다.' }
      }
    }
  }
  saveLocalTemplates(loadLocalTemplates().filter((r) => r.id !== id))
  return { ok: true }
}
