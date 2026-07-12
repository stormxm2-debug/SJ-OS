import type { CustomerRecord } from '@shared/commercial/models'
import type { ScheduleWithCustomer } from './supabaseScheduleAdapter'
import { getSupabaseClient, initSupabaseClient } from './supabaseClient'
import { getBirthInfo, daysUntilBirthday } from './birthdayService'

/**
 * 소개 리퍼럴 엔진 — DB 구매 대신 자체생산 영업의 핵심 서비스.
 *
 * ① 골든타임: 계약·클로징·증권전달 직후(14일)와 생일(D-3)인 고객을 찾아
 *    "지금 소개를 요청하기 좋은 순간"으로 보여준다 (기존 데이터만 사용, DB 추가 조회 없음).
 * ② 소개 파이프라인: 요청함 → 소개받음 → 콜 → 상담 → 계약/무산 상태를 추적.
 * ③ 성과: 퍼널 통계 + FC별 리더보드(관리자).
 *
 * RLS: 직원 본인 것만 / 관리자 전체 (referrals 테이블). Supabase 미연결(데모)
 * 환경에서는 localStorage 폴백으로 동작해 UI 검증이 가능하다.
 */

export type ReferralStatus = 'asked' | 'received' | 'called' | 'consulted' | 'contracted' | 'failed'

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  asked: '요청함',
  received: '소개받음',
  called: '콜 완료',
  consulted: '상담',
  contracted: '계약',
  failed: '무산'
}

/** 파이프라인 진행 순서 (received 이후). 다음 단계 버튼 렌더링에 사용. */
export const REFERRAL_FLOW: ReferralStatus[] = ['received', 'called', 'consulted', 'contracted']

export function nextReferralStatus(status: ReferralStatus): ReferralStatus | null {
  const i = REFERRAL_FLOW.indexOf(status)
  if (i < 0 || i >= REFERRAL_FLOW.length - 1) return null
  return REFERRAL_FLOW[i + 1]
}

export interface Referral {
  id: string
  fcId: string
  fcName: string | null
  referrerCustomerId: string | null
  referrerName: string
  referredName: string | null
  referredPhone: string | null
  relation: string | null
  status: ReferralStatus
  memo: string | null
  askedAt: string | null
  receivedAt: string | null
  contractedAt: string | null
  createdAt: string
}

export interface ReferralAskInput {
  referrerCustomerId?: string
  referrerName: string
  memo?: string
}

export interface ReferralInput extends ReferralAskInput {
  referredName: string
  referredPhone?: string
  relation?: string
}

export type ReferralDataMode = 'supabase' | 'local'

export interface ReferralListResult {
  ok: boolean
  mode: ReferralDataMode
  referrals: Referral[]
  error?: string
}

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

const VALID_STATUS: ReferralStatus[] = ['asked', 'received', 'called', 'consulted', 'contracted', 'failed']

function mapReferral(r: Record<string, any>): Referral {
  const raw = String(r.status ?? 'asked') as ReferralStatus
  return {
    id: String(r.id),
    fcId: String(r.fc_id ?? ''),
    fcName: r.fc_name ?? null,
    referrerCustomerId: r.referrer_customer_id ?? null,
    referrerName: String(r.referrer_name ?? ''),
    referredName: r.referred_name ?? null,
    referredPhone: r.referred_phone ?? null,
    relation: r.relation ?? null,
    status: VALID_STATUS.includes(raw) ? raw : 'asked',
    memo: r.memo ?? null,
    askedAt: r.asked_at ?? null,
    receivedAt: r.received_at ?? null,
    contractedAt: r.contracted_at ?? null,
    createdAt: String(r.created_at ?? '')
  }
}

/* ---------- 데모/오프라인 localStorage 폴백 ---------- */

const LOCAL_KEY = 'sjos.referrals.v1'

function loadLocal(): Referral[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as Referral[]) : []
  } catch {
    return []
  }
}

function saveLocal(rows: Referral[]): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(rows))
  } catch {
    /* 저장 실패(용량 등)는 조용히 무시 — 데모 폴백이므로 */
  }
}

function localId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/* ---------- CRUD ---------- */

interface Actor {
  id: string
  name: string
}

/** 소개 목록 (RLS: 직원 본인 것만 / 관리자 전체). 미연결 환경은 localStorage. */
export async function listReferrals(): Promise<ReferralListResult> {
  const client = await getClient()
  if (client && (await uid(client))) {
    try {
      const { data, error } = await client
        .from('referrals')
        .select(
          'id, fc_id, fc_name, referrer_customer_id, referrer_name, referred_name, referred_phone, relation, status, memo, asked_at, received_at, contracted_at, created_at'
        )
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) return { ok: false, mode: 'supabase', referrals: [], error: error.message }
      return { ok: true, mode: 'supabase', referrals: ((data as any[]) ?? []).map(mapReferral) }
    } catch {
      return { ok: false, mode: 'supabase', referrals: [], error: '소개 목록을 불러오지 못했습니다.' }
    }
  }
  return { ok: true, mode: 'local', referrals: loadLocal() }
}

/** 소개 '요청함' 기록 — 골든타임에서 요청 버튼을 누른 순간을 남긴다. */
export async function createReferralAsk(input: ReferralAskInput, actor: Actor): Promise<{ ok: boolean; error?: string }> {
  const referrerName = input.referrerName.trim()
  if (!referrerName) return { ok: false, error: '소개자 이름이 필요합니다.' }
  const nowIso = new Date().toISOString()
  const client = await getClient()
  if (client) {
    const me = await uid(client)
    if (me) {
      try {
        const { error } = await client.from('referrals').insert({
          fc_id: me,
          fc_name: actor.name || null,
          referrer_customer_id: input.referrerCustomerId ?? null,
          referrer_name: referrerName,
          status: 'asked',
          memo: input.memo?.trim() || null,
          asked_at: nowIso
        })
        if (error) return { ok: false, error: error.message }
        return { ok: true }
      } catch {
        return { ok: false, error: '요청 기록 저장 중 오류가 발생했습니다.' }
      }
    }
  }
  const rows = loadLocal()
  rows.unshift({
    id: localId(),
    fcId: actor.id,
    fcName: actor.name,
    referrerCustomerId: input.referrerCustomerId ?? null,
    referrerName,
    referredName: null,
    referredPhone: null,
    relation: null,
    status: 'asked',
    memo: input.memo?.trim() || null,
    askedAt: nowIso,
    receivedAt: null,
    contractedAt: null,
    createdAt: nowIso
  })
  saveLocal(rows)
  return { ok: true }
}

/** 소개받은 사람 기록 (status='received'부터 시작). */
export async function createReferral(input: ReferralInput, actor: Actor): Promise<{ ok: boolean; error?: string }> {
  const referrerName = input.referrerName.trim()
  const referredName = input.referredName.trim()
  if (!referrerName || !referredName) return { ok: false, error: '소개자와 소개받은 분 이름이 필요합니다.' }
  const nowIso = new Date().toISOString()
  const client = await getClient()
  if (client) {
    const me = await uid(client)
    if (me) {
      try {
        const { error } = await client.from('referrals').insert({
          fc_id: me,
          fc_name: actor.name || null,
          referrer_customer_id: input.referrerCustomerId ?? null,
          referrer_name: referrerName,
          referred_name: referredName,
          referred_phone: input.referredPhone?.trim() || null,
          relation: input.relation?.trim() || null,
          status: 'received',
          memo: input.memo?.trim() || null,
          received_at: nowIso
        })
        if (error) return { ok: false, error: error.message }
        return { ok: true }
      } catch {
        return { ok: false, error: '소개 저장 중 오류가 발생했습니다.' }
      }
    }
  }
  const rows = loadLocal()
  rows.unshift({
    id: localId(),
    fcId: actor.id,
    fcName: actor.name,
    referrerCustomerId: input.referrerCustomerId ?? null,
    referrerName,
    referredName,
    referredPhone: input.referredPhone?.trim() || null,
    relation: input.relation?.trim() || null,
    status: 'received',
    memo: input.memo?.trim() || null,
    askedAt: null,
    receivedAt: nowIso,
    contractedAt: null,
    createdAt: nowIso
  })
  saveLocal(rows)
  return { ok: true }
}

/**
 * '요청함' 건을 실제 소개받음으로 전환 — 소개받은 분 정보를 채우고 received로 올린다.
 */
export async function convertAskToReceived(
  id: string,
  input: { referredName: string; referredPhone?: string; relation?: string }
): Promise<{ ok: boolean; error?: string }> {
  const referredName = input.referredName.trim()
  if (!referredName) return { ok: false, error: '소개받은 분 이름이 필요합니다.' }
  const patch = {
    referred_name: referredName,
    referred_phone: input.referredPhone?.trim() || null,
    relation: input.relation?.trim() || null,
    status: 'received',
    received_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
  const client = await getClient()
  if (client && (await uid(client))) {
    try {
      const { error } = await client.from('referrals').update(patch).eq('id', id)
      if (error) return { ok: false, error: error.message }
      return { ok: true }
    } catch {
      return { ok: false, error: '전환 처리 중 오류가 발생했습니다.' }
    }
  }
  const rows = loadLocal()
  const row = rows.find((r) => r.id === id)
  if (!row) return { ok: false, error: '대상을 찾지 못했습니다.' }
  row.referredName = referredName
  row.referredPhone = input.referredPhone?.trim() || null
  row.relation = input.relation?.trim() || null
  row.status = 'received'
  row.receivedAt = new Date().toISOString()
  saveLocal(rows)
  return { ok: true }
}

/** 상태 변경 — contracted로 올라가면 contracted_at을 기록한다(월별 성과 기준). */
export async function updateReferralStatus(id: string, status: ReferralStatus): Promise<{ ok: boolean; error?: string }> {
  const nowIso = new Date().toISOString()
  const patch: Record<string, unknown> = { status, updated_at: nowIso }
  if (status === 'contracted') patch.contracted_at = nowIso
  if (status === 'received') patch.received_at = nowIso
  const client = await getClient()
  if (client && (await uid(client))) {
    try {
      const { error } = await client.from('referrals').update(patch).eq('id', id)
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
  if (status === 'contracted') row.contractedAt = nowIso
  if (status === 'received') row.receivedAt = nowIso
  saveLocal(rows)
  return { ok: true }
}

/** 소개 삭제 (본인 것만 — RLS가 실제 경계). */
export async function deleteReferral(id: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (client && (await uid(client))) {
    try {
      const { error } = await client.from('referrals').delete().eq('id', id)
      if (error) return { ok: false, error: error.message }
      return { ok: true }
    } catch {
      return { ok: false, error: '삭제 중 오류가 발생했습니다.' }
    }
  }
  saveLocal(loadLocal().filter((r) => r.id !== id))
  return { ok: true }
}

/* ---------- 골든타임 (순수 계산 — 추가 DB 조회 없음) ---------- */

export type GoldenReason = 'contract' | 'delivery' | 'closing' | 'birthday'

export const GOLDEN_REASON_LABEL: Record<GoldenReason, string> = {
  contract: '계약 체결',
  delivery: '증권 전달',
  closing: '클로징',
  birthday: '생일'
}

/** 낮을수록 우선(더 강한 골든타임). */
const REASON_PRIORITY: Record<GoldenReason, number> = { contract: 0, delivery: 1, closing: 2, birthday: 3 }

export interface GoldenMoment {
  customer: CustomerRecord
  reason: GoldenReason
  /** 사람이 읽는 근거 문구 (예: "3일 전 증권 전달 완료", "생일 D-2"). */
  detail: string
  /** 최근 90일 내 이미 소개 요청한 고객 여부. */
  alreadyAsked: boolean
}

const GOLDEN_EVENT_WINDOW_DAYS = 14
const BIRTHDAY_WINDOW_DAYS = 3
const ASKED_COOLDOWN_DAYS = 90

const GOLDEN_EVENT_TYPES: Record<string, GoldenReason> = {
  contract: 'contract',
  delivery: 'delivery',
  closing: 'closing'
}

function daysAgoLabel(iso: string, now: Date): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const days = Math.floor((now.getTime() - t) / 86400000)
  if (days <= 0) return '오늘'
  if (days === 1) return '어제'
  return `${days}일 전`
}

/**
 * 소개 요청 골든타임 고객 목록 — 만족도가 가장 높은 순간의 고객을 뽑는다.
 * ① 최근 14일 내 완료(done)된 계약/증권전달/클로징 일정의 고객 (본인 일정만)
 * ② 생일 D-0 ~ D-3 고객
 * 고객당 가장 강한 근거 1개만 남기고, 최근 90일 내 요청 이력은 배지로 표시한다.
 */
export function computeGoldenMoments(
  customers: CustomerRecord[],
  events: ScheduleWithCustomer[],
  referrals: Referral[],
  staffId: string,
  now: Date = new Date()
): GoldenMoment[] {
  const byId = new Map(customers.map((c) => [c.id, c]))
  const picked = new Map<string, GoldenMoment>()

  const consider = (customer: CustomerRecord, reason: GoldenReason, detail: string): void => {
    const prev = picked.get(customer.id)
    if (prev && REASON_PRIORITY[prev.reason] <= REASON_PRIORITY[reason]) return
    picked.set(customer.id, { customer, reason, detail, alreadyAsked: false })
  }

  // ① 최근 완료된 골든 이벤트 (내 일정 × 고객관리 연결 고객만)
  const windowStart = now.getTime() - GOLDEN_EVENT_WINDOW_DAYS * 86400000
  for (const ev of events) {
    if (ev.staffId !== staffId || ev.status !== 'done' || !ev.customerId) continue
    const reason = GOLDEN_EVENT_TYPES[ev.type]
    if (!reason) continue
    const whenIso = ev.endsAt ?? ev.startsAt
    const t = Date.parse(whenIso)
    if (!Number.isFinite(t) || t < windowStart || t > now.getTime() + 86400000) continue
    const customer = byId.get(ev.customerId)
    if (!customer) continue
    consider(customer, reason, `${daysAgoLabel(whenIso, now)} ${GOLDEN_REASON_LABEL[reason]} 완료`)
  }

  // ② 생일 임박 고객
  for (const c of customers) {
    const info = getBirthInfo(c)
    if (!info) continue
    const dDay = daysUntilBirthday(info.month, info.day, now)
    if (dDay > BIRTHDAY_WINDOW_DAYS) continue
    consider(c, 'birthday', dDay === 0 ? '오늘 생일 🎂' : `생일 D-${dDay}`)
  }

  // 최근 90일 내 소개 요청 이력 배지
  const cooldownStart = now.getTime() - ASKED_COOLDOWN_DAYS * 86400000
  const askedCustomerIds = new Set<string>()
  const askedNames = new Set<string>()
  for (const r of referrals) {
    const t = Date.parse(r.askedAt ?? r.createdAt)
    if (!Number.isFinite(t) || t < cooldownStart) continue
    if (r.referrerCustomerId) askedCustomerIds.add(r.referrerCustomerId)
    if (r.referrerName) askedNames.add(r.referrerName)
  }
  for (const m of picked.values()) {
    m.alreadyAsked = askedCustomerIds.has(m.customer.id) || askedNames.has(m.customer.name)
  }

  return [...picked.values()].sort(
    (a, b) => REASON_PRIORITY[a.reason] - REASON_PRIORITY[b.reason] || a.customer.name.localeCompare(b.customer.name, 'ko')
  )
}

/* ---------- 성과 통계 (순수 계산) ---------- */

export interface ReferralFunnel {
  asked: number
  received: number
  called: number
  consulted: number
  contracted: number
  failed: number
  /** 소개받음(received 이상) 건수. */
  totalReceived: number
  /** 소개→계약 전환율(%). 소개받음 0건이면 null. */
  conversionPct: number | null
}

/** 파이프라인 단계는 누적 개념 — 예: contracted 1건은 received/called/consulted에도 포함. */
export function referralFunnel(rows: Referral[]): ReferralFunnel {
  const stageIndex = (s: ReferralStatus): number => REFERRAL_FLOW.indexOf(s)
  let asked = 0
  let failed = 0
  const cum = [0, 0, 0, 0] // received, called, consulted, contracted
  for (const r of rows) {
    if (r.status === 'asked') {
      asked += 1
      continue
    }
    if (r.status === 'failed') {
      failed += 1
      cum[0] += 1 // 무산 건도 소개는 받았던 것
      continue
    }
    const idx = stageIndex(r.status)
    for (let i = 0; i <= idx; i += 1) cum[i] += 1
  }
  const totalReceived = cum[0]
  return {
    asked,
    received: cum[0],
    called: cum[1],
    consulted: cum[2],
    contracted: cum[3],
    failed,
    totalReceived,
    conversionPct: totalReceived > 0 ? Math.round((cum[3] / totalReceived) * 100) : null
  }
}

export interface FcReferralStat {
  fcId: string
  fcName: string
  received: number
  contracted: number
  conversionPct: number | null
}

/** FC별 소개 성과 (관리자 리더보드) — 소개받음 많은 순. */
export function fcLeaderboard(rows: Referral[]): FcReferralStat[] {
  const map = new Map<string, FcReferralStat>()
  for (const r of rows) {
    if (r.status === 'asked') continue
    const key = r.fcId
    const cur = map.get(key) ?? { fcId: key, fcName: r.fcName ?? '이름없음', received: 0, contracted: 0, conversionPct: null }
    cur.received += 1
    if (r.status === 'contracted') cur.contracted += 1
    if (r.fcName) cur.fcName = r.fcName
    map.set(key, cur)
  }
  const out = [...map.values()]
  for (const s of out) s.conversionPct = s.received > 0 ? Math.round((s.contracted / s.received) * 100) : null
  return out.sort((a, b) => b.received - a.received || b.contracted - a.contracted || a.fcName.localeCompare(b.fcName, 'ko'))
}

/** 이번 달(로컬 기준) 생성/전환 집계 — 헤더 칩용. */
export function monthlyCounts(rows: Referral[], now: Date = new Date()): { received: number; contracted: number } {
  const y = now.getFullYear()
  const m = now.getMonth()
  const inMonth = (iso: string | null): boolean => {
    if (!iso) return false
    const d = new Date(Date.parse(iso))
    return d.getFullYear() === y && d.getMonth() === m
  }
  let received = 0
  let contracted = 0
  for (const r of rows) {
    if (inMonth(r.receivedAt ?? (r.status !== 'asked' ? r.createdAt : null))) received += 1
    if (r.status === 'contracted' && inMonth(r.contractedAt ?? r.createdAt)) contracted += 1
  }
  return { received, contracted }
}

/* ---------- 카톡 문안 ---------- */

/** 고객에게 보내도 되는 정중한 소개 요청 문안 (부담 없는 톤). */
export function buildReferralAskMessage(customerName: string, staffName?: string): string {
  return [
    `${customerName}님, 안녕하세요. SJ INVEST${staffName ? ` ${staffName}` : ''}입니다.`,
    '',
    '늘 믿고 맡겨 주셔서 진심으로 감사드립니다.',
    '',
    '혹시 주변에 보험 점검이나 보장 상담이 필요한 분이 계시면 편하게 소개해 주세요.',
    '소개해 주신 분께는 부담 드리지 않고, 무료 보장분석부터 꼼꼼히 도와드리겠습니다.',
    '',
    '항상 건강하시고, 필요하실 땐 언제든 연락 주세요. 감사합니다.'
  ].join('\n')
}
