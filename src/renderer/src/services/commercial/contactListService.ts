import type { CustomerRecord, ConsultationRecord } from '@shared/commercial/models'
import type { ScheduleWithCustomer } from './supabaseScheduleAdapter'
import type { Referral } from './referralService'
import { getSupabaseClient, initSupabaseClient } from './supabaseClient'
import { getBirthInfo, daysUntilBirthday } from './birthdayService'

/**
 * 오늘의 접촉 리스트 — 자체생산 영업 2단계.
 *
 * 매일 아침 "오늘 연락할 고객"을 이유와 함께 자동 추출한다 (전부 기존 데이터 재사용):
 * ① 소개 첫 콜 대기: 소개받았는데 아직 콜 전 (referrals.received)
 * ② 생일: 오늘~D-7 (주민번호/생년월일 자동 계산)
 * ③ 소개 리마인드: 소개 요청 후 7일+ 무응답 소개자
 * ④ 90일 무접촉: 마지막 접촉(접촉로그·완료 일정·상담기록 통합)이 90일 이상 지난 고객
 *
 * [연락함] 원탭 기록은 contact_logs 테이블(RLS 본인+관리자)에 남고, 그 즉시
 * 무접촉 계산의 근거가 된다. Supabase 미연결(데모)에서는 localStorage 폴백.
 */

export type ContactChannel = 'call' | 'kakao' | 'sms'

export const CONTACT_CHANNEL_LABEL: Record<ContactChannel, string> = {
  call: '전화',
  kakao: '카톡',
  sms: '문자'
}

export interface ContactLog {
  id: string
  fcId: string
  fcName: string | null
  customerId: string | null
  customerName: string
  channel: ContactChannel
  reason: string | null
  note: string | null
  contactedAt: string
}

export interface ContactLogInput {
  customerId?: string
  customerName: string
  channel: ContactChannel
  reason?: string
  note?: string
}

export type ContactDataMode = 'supabase' | 'local'

export interface ContactLogListResult {
  ok: boolean
  mode: ContactDataMode
  logs: ContactLog[]
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

function mapLog(r: Record<string, any>): ContactLog {
  const ch = String(r.channel ?? 'call')
  return {
    id: String(r.id),
    fcId: String(r.fc_id ?? ''),
    fcName: r.fc_name ?? null,
    customerId: r.customer_id ?? null,
    customerName: String(r.customer_name ?? ''),
    channel: ch === 'kakao' || ch === 'sms' ? ch : 'call',
    reason: r.reason ?? null,
    note: r.note ?? null,
    contactedAt: String(r.contacted_at ?? '')
  }
}

/* ---------- 데모/오프라인 localStorage 폴백 ---------- */

const LOCAL_KEY = 'sjos.contactlogs.v1'

function loadLocal(): ContactLog[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as ContactLog[]) : []
  } catch {
    return []
  }
}

function saveLocal(rows: ContactLog[]): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(rows))
  } catch {
    /* 데모 폴백 — 저장 실패는 조용히 무시 */
  }
}

function localId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/* ---------- CRUD ---------- */

/** 접촉로그 목록 (최근순, 최대 1000 — RLS: 본인/관리자 전체). */
export async function listContactLogs(): Promise<ContactLogListResult> {
  const client = await getClient()
  if (client && (await uid(client))) {
    try {
      const { data, error } = await client
        .from('contact_logs')
        .select('id, fc_id, fc_name, customer_id, customer_name, channel, reason, note, contacted_at')
        .order('contacted_at', { ascending: false })
        .limit(1000)
      if (error) return { ok: false, mode: 'supabase', logs: [], error: error.message }
      return { ok: true, mode: 'supabase', logs: ((data as any[]) ?? []).map(mapLog) }
    } catch {
      return { ok: false, mode: 'supabase', logs: [], error: '접촉 기록을 불러오지 못했습니다.' }
    }
  }
  return { ok: true, mode: 'local', logs: loadLocal() }
}

/** [연락함] 원탭 기록. */
export async function logContact(input: ContactLogInput, actor: { id: string; name: string }): Promise<{ ok: boolean; error?: string }> {
  const customerName = input.customerName.trim()
  if (!customerName) return { ok: false, error: '고객 이름이 필요합니다.' }
  const nowIso = new Date().toISOString()
  const client = await getClient()
  if (client) {
    const me = await uid(client)
    if (me) {
      try {
        const { error } = await client.from('contact_logs').insert({
          fc_id: me,
          fc_name: actor.name || null,
          customer_id: input.customerId ?? null,
          customer_name: customerName,
          channel: input.channel,
          reason: input.reason ?? null,
          note: input.note?.trim() || null,
          contacted_at: nowIso
        })
        if (error) return { ok: false, error: error.message }
        return { ok: true }
      } catch {
        return { ok: false, error: '접촉 기록 저장 중 오류가 발생했습니다.' }
      }
    }
  }
  const rows = loadLocal()
  rows.unshift({
    id: localId(),
    fcId: actor.id,
    fcName: actor.name,
    customerId: input.customerId ?? null,
    customerName,
    channel: input.channel,
    reason: input.reason ?? null,
    note: input.note?.trim() || null,
    contactedAt: nowIso
  })
  saveLocal(rows)
  return { ok: true }
}

/* ---------- 오늘의 접촉 리스트 계산 (순수 함수) ---------- */

export type ContactReason = 'referral-call' | 'birthday' | 'referral-remind' | 'dormant'

export const CONTACT_REASON_LABEL: Record<ContactReason, string> = {
  'referral-call': '소개 첫 콜',
  birthday: '생일',
  'referral-remind': '소개 리마인드',
  dormant: '무접촉'
}

/** 낮을수록 리스트 상단 (더 급한 연락). */
const REASON_PRIORITY: Record<ContactReason, number> = {
  'referral-call': 0,
  birthday: 1,
  'referral-remind': 2,
  dormant: 3
}

export interface ContactItem {
  /** 리스트 key — 고객은 customer:<id>, 소개 건은 referral:<id>. */
  key: string
  kind: 'customer' | 'referral'
  customerId?: string
  referralId?: string
  name: string
  phone?: string
  reason: ContactReason
  /** 사람이 읽는 근거 (예: "마지막 접촉 112일 전", "생일 D-2"). */
  detail: string
  priority: number
}

const DORMANT_DAYS = 90
const BIRTHDAY_WINDOW_DAYS = 7
const REFERRAL_REMIND_MIN_DAYS = 7
const REFERRAL_REMIND_MAX_DAYS = 60

function daysBetween(iso: string, now: Date): number | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.floor((now.getTime() - t) / 86400000)
}

function isSameLocalDay(iso: string, now: Date): boolean {
  const d = new Date(Date.parse(iso))
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export interface ContactListInputs {
  customers: CustomerRecord[]
  events: ScheduleWithCustomer[]
  consultations: ConsultationRecord[]
  referrals: Referral[]
  logs: ContactLog[]
  staffId: string
  now?: Date
}

export interface ContactListResultComputed {
  /** 오늘 연락할 목록 (우선순위순). */
  todo: ContactItem[]
  /** 오늘 이미 연락 완료한 로그. */
  doneToday: ContactLog[]
}

/**
 * 오늘의 접촉 리스트 — 고객당 가장 급한 사유 1개만 남긴다.
 * 오늘 이미 접촉로그가 있는 고객은 todo에서 빠지고 완료 목록으로 내려간다.
 */
export function computeContactList(inputs: ContactListInputs): ContactListResultComputed {
  const { customers, events, consultations, referrals, logs, staffId } = inputs
  const now = inputs.now ?? new Date()

  // 고객별 마지막 접촉일: 접촉로그 + 내 완료 일정 + 내 상담기록 중 가장 최근.
  const lastTouch = new Map<string, number>()
  const touch = (customerId: string | null | undefined, iso: string | null | undefined): void => {
    if (!customerId || !iso) return
    const t = Date.parse(iso)
    if (!Number.isFinite(t)) return
    const prev = lastTouch.get(customerId)
    if (prev === undefined || t > prev) lastTouch.set(customerId, t)
  }
  for (const l of logs) touch(l.customerId, l.contactedAt)
  for (const ev of events) {
    if (ev.staffId !== staffId || ev.status !== 'done') continue
    touch(ev.customerId, ev.endsAt ?? ev.startsAt)
  }
  for (const c of consultations) {
    if (c.staffId !== staffId || c.status === 'cancelled') continue
    touch(c.customerId, c.completedAt ?? c.scheduledAt ?? c.createdAt)
  }

  // 오늘 이미 연락한 대상 (고객 id + 이름 — 고객 미연결 로그는 이름으로 매칭).
  const doneToday = logs.filter((l) => isSameLocalDay(l.contactedAt, now))
  const doneCustomerIds = new Set(doneToday.map((l) => l.customerId).filter(Boolean) as string[])
  const doneNames = new Set(doneToday.map((l) => l.customerName))

  const picked = new Map<string, ContactItem>()
  const consider = (item: ContactItem): void => {
    const prev = picked.get(item.key)
    if (prev && prev.priority <= item.priority) return
    picked.set(item.key, item)
  }

  // ① 소개 첫 콜 대기 (received 상태 — 아직 콜 전)
  for (const r of referrals) {
    if (r.fcId !== staffId || r.status !== 'received' || !r.referredName) continue
    const d = daysBetween(r.receivedAt ?? r.createdAt, now)
    consider({
      key: `referral:${r.id}`,
      kind: 'referral',
      referralId: r.id,
      name: r.referredName,
      phone: r.referredPhone ?? undefined,
      reason: 'referral-call',
      detail: d === null || d <= 0 ? '오늘 소개받음 — 첫 콜 대기' : `소개받은 지 ${d}일 — 첫 콜 대기`,
      priority: REASON_PRIORITY['referral-call']
    })
  }

  // ③ 소개 리마인드 (요청 후 7~60일 무응답 소개자)
  for (const r of referrals) {
    if (r.fcId !== staffId || r.status !== 'asked') continue
    const d = daysBetween(r.askedAt ?? r.createdAt, now)
    if (d === null || d < REFERRAL_REMIND_MIN_DAYS || d > REFERRAL_REMIND_MAX_DAYS) continue
    const key = r.referrerCustomerId ? `customer:${r.referrerCustomerId}` : `referral:${r.id}`
    const customer = r.referrerCustomerId ? customers.find((c) => c.id === r.referrerCustomerId) : undefined
    consider({
      key,
      kind: customer ? 'customer' : 'referral',
      customerId: customer?.id,
      referralId: r.id,
      name: customer?.name ?? r.referrerName,
      phone: customer?.phone,
      reason: 'referral-remind',
      detail: `소개 요청 ${d}일째 — 부담 없는 안부 겸 리마인드`,
      priority: REASON_PRIORITY['referral-remind']
    })
  }

  // ②·④ 내 고객: 생일 / 무접촉
  for (const c of customers) {
    const info = getBirthInfo(c)
    if (info) {
      const dDay = daysUntilBirthday(info.month, info.day, now)
      if (dDay <= BIRTHDAY_WINDOW_DAYS) {
        consider({
          key: `customer:${c.id}`,
          kind: 'customer',
          customerId: c.id,
          name: c.name,
          phone: c.phone,
          reason: 'birthday',
          detail: dDay === 0 ? '오늘 생일 🎂' : `생일 D-${dDay}`,
          priority: REASON_PRIORITY.birthday
        })
      }
    }
    const last = lastTouch.get(c.id) ?? Date.parse(c.createdAt)
    if (Number.isFinite(last)) {
      const days = Math.floor((now.getTime() - last) / 86400000)
      if (days >= DORMANT_DAYS) {
        consider({
          key: `customer:${c.id}`,
          kind: 'customer',
          customerId: c.id,
          name: c.name,
          phone: c.phone,
          reason: 'dormant',
          detail: `마지막 접촉 ${days}일 전`,
          priority: REASON_PRIORITY.dormant
        })
      }
    }
  }

  // 오늘 이미 연락한 대상 제외
  const todo = [...picked.values()].filter((item) => {
    if (item.customerId && doneCustomerIds.has(item.customerId)) return false
    if (doneNames.has(item.name)) return false
    return true
  })

  todo.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, 'ko'))
  return { todo, doneToday }
}

/* ---------- 통계 (순수 함수) ---------- */

/** 이번 달 내 접촉 건수. */
export function monthlyContactCount(logs: ContactLog[], staffId: string, now: Date = new Date()): number {
  const y = now.getFullYear()
  const m = now.getMonth()
  return logs.filter((l) => {
    if (l.fcId !== staffId) return false
    const d = new Date(Date.parse(l.contactedAt))
    return d.getFullYear() === y && d.getMonth() === m
  }).length
}

export interface StaffContactStat {
  fcId: string
  fcName: string
  todayCount: number
  monthCount: number
}

/** 직원별 접촉 현황 (관리자 카드) — 오늘 건수 많은 순. */
export function staffContactStats(logs: ContactLog[], now: Date = new Date()): StaffContactStat[] {
  const y = now.getFullYear()
  const m = now.getMonth()
  const map = new Map<string, StaffContactStat>()
  for (const l of logs) {
    const d = new Date(Date.parse(l.contactedAt))
    const inMonth = d.getFullYear() === y && d.getMonth() === m
    if (!inMonth) continue
    const cur = map.get(l.fcId) ?? { fcId: l.fcId, fcName: l.fcName ?? '이름없음', todayCount: 0, monthCount: 0 }
    cur.monthCount += 1
    if (isSameLocalDay(l.contactedAt, now)) cur.todayCount += 1
    if (l.fcName) cur.fcName = l.fcName
    map.set(l.fcId, cur)
  }
  return [...map.values()].sort((a, b) => b.todayCount - a.todayCount || b.monthCount - a.monthCount || a.fcName.localeCompare(b.fcName, 'ko'))
}
