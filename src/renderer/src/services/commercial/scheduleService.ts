import type { ScheduleAiBrief, ScheduleEvent } from '@shared/commercial/models'
import type { ScheduleInput, ScheduleStatus, ScheduleType } from './scheduleValidation'
import { getBackendConfig } from './backendConfig'
import { customerRepository, scheduleRepository } from './services'
import { supabaseScheduleAdapter, type ScheduleWithCustomer } from './supabaseScheduleAdapter'
import { listConsultations, type ConsultationWithCustomer } from './consultationService'
import { getFunctionsBaseUrl, getSupabaseAnonKey, getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * Unified schedule service. Routes to Supabase when configured + logged in, else to
 * the local-mock repository. Callers get a data-mode tag + Korean error and never
 * see raw SQL/tokens. Today/week/search filters are client-side UX only (RLS remains
 * authoritative). Never logs memos/PII.
 */

export type ScheduleDataMode = 'local-mock' | 'supabase' | 'not-configured' | 'no-session'

export interface ScheduleListResult {
  ok: boolean
  mode: ScheduleDataMode
  events: ScheduleWithCustomer[]
  error?: string
}
export interface ScheduleMutationResult {
  ok: boolean
  mode: ScheduleDataMode
  event?: ScheduleWithCustomer
  error?: string
}

function isSupabase(): boolean {
  return getBackendConfig().mode === 'supabase'
}

async function localWithNames(records: ScheduleEvent[]): Promise<ScheduleWithCustomer[]> {
  const customers = await customerRepository.list()
  const nameById = new Map(customers.map((c) => [c.id, c.name]))
  return records.map((r) => ({ ...r, customerName: r.customerId ? nameById.get(r.customerId) : undefined }))
}

export async function listScheduleEvents(): Promise<ScheduleListResult> {
  if (isSupabase()) {
    const res = await supabaseScheduleAdapter.listScheduleEvents()
    if (res.ok) return { ok: true, mode: 'supabase', events: res.data }
    return { ok: false, mode: res.reason === 'no-session' ? 'no-session' : res.reason === 'not-configured' ? 'not-configured' : 'supabase', events: [], error: res.message }
  }
  const items = await scheduleRepository.list()
  return { ok: true, mode: 'local-mock', events: await localWithNames(items) }
}

export async function createScheduleEvent(input: ScheduleInput): Promise<ScheduleMutationResult> {
  if (isSupabase()) {
    const res = await supabaseScheduleAdapter.createScheduleEvent(input)
    if (res.ok) return { ok: true, mode: 'supabase', event: res.data }
    return { ok: false, mode: res.reason === 'no-session' ? 'no-session' : 'supabase', error: res.message }
  }
  const record: ScheduleEvent = {
    id: `e-local-${new Date().toISOString()}-${Math.floor(Math.random() * 1000)}`,
    staffId: 'local',
    staffName: '로컬 사용자',
    customerId: input.customerId?.trim() || undefined,
    title: input.title.trim(),
    type: input.type,
    startsAt: input.startsAt,
    endsAt: input.endsAt?.trim() || undefined,
    status: input.status,
    memo: input.memo?.trim() || undefined
  }
  const saved = await scheduleRepository.create(record)
  const [withName] = await localWithNames([saved])
  return { ok: true, mode: 'local-mock', event: withName }
}

export async function updateScheduleEvent(id: string, input: Partial<ScheduleInput>): Promise<ScheduleMutationResult> {
  if (isSupabase()) {
    const res = await supabaseScheduleAdapter.updateScheduleEvent(id, input)
    if (res.ok) return { ok: true, mode: 'supabase', event: res.data }
    return { ok: false, mode: 'supabase', error: res.message }
  }
  const patch: Partial<ScheduleEvent> = {}
  if (input.customerId !== undefined) patch.customerId = input.customerId?.trim() || undefined
  if (input.title !== undefined) patch.title = input.title.trim()
  if (input.type !== undefined) patch.type = input.type
  if (input.startsAt !== undefined) patch.startsAt = input.startsAt
  if (input.endsAt !== undefined) patch.endsAt = input.endsAt?.trim() || undefined
  if (input.status !== undefined) patch.status = input.status
  if (input.memo !== undefined) patch.memo = input.memo?.trim() || undefined
  const saved = await scheduleRepository.update(id, patch)
  if (!saved) return { ok: false, mode: 'local-mock', error: '일정 저장에 실패했습니다.' }
  const [withName] = await localWithNames([saved])
  return { ok: true, mode: 'local-mock', event: withName }
}

export async function updateScheduleStatus(id: string, status: ScheduleStatus): Promise<ScheduleMutationResult> {
  return updateScheduleEvent(id, { status })
}

/**
 * 미팅 종료 — 메모 저장 순간이 곧 종료시각 (status done + endsAt=now + memo + AI 분석).
 */
export async function finishMeeting(id: string, memo: string, aiBrief?: ScheduleAiBrief): Promise<ScheduleMutationResult> {
  if (isSupabase()) {
    const res = await supabaseScheduleAdapter.finishMeeting(id, memo, aiBrief)
    if (res.ok) return { ok: true, mode: 'supabase', event: res.data }
    return { ok: false, mode: 'supabase', error: res.message }
  }
  const saved = await scheduleRepository.update(id, {
    memo: memo.trim() || undefined,
    endsAt: new Date().toISOString(),
    status: 'done',
    aiBrief
  })
  if (!saved) return { ok: false, mode: 'local-mock', error: '미팅 종료 처리에 실패했습니다.' }
  const [withName] = await localWithNames([saved])
  return { ok: true, mode: 'local-mock', event: withName }
}

/** Edge Function 인증: 로그인 세션 토큰(없으면 anon). 값은 절대 로깅하지 않음. */
async function functionsBearer(): Promise<string | undefined> {
  const anon = getSupabaseAnonKey()
  try {
    await initSupabaseClient()
    const client = getSupabaseClient() as {
      auth?: { getSession: () => Promise<{ data?: { session?: { access_token?: string } } }> }
    } | null
    const { data } = (await client?.auth?.getSession()) ?? {}
    return data?.session?.access_token ?? anon
  } catch {
    return anon
  }
}

/** AI 한줄 등록 파싱 결과. */
export interface ParsedSchedule {
  type: string
  customerName?: string
  date: string // YYYY-MM-DD
  time: string // HH:mm
  location?: string
}

/**
 * 자연어 한 줄("내일 2시 김민준 2차만남 강남역") → 일정 구조로 해석 (parse-schedule
 * edge function). 고객 목록을 함께 보내 이름 매칭 정확도를 높인다. 실패 시 error.
 */
export async function requestScheduleParse(
  text: string,
  customerNames: string[]
): Promise<{ ok: boolean; parsed?: ParsedSchedule; error?: string }> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, error: 'AI 등록은 서버 연결 후 사용할 수 있습니다.' }
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][now.getDay()]
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 35000)
  try {
    const token = (await functionsBearer()) ?? anon
    const res = await fetch(`${base}/parse-schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, today, weekday, customers: customerNames.slice(0, 300) }),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as {
      success?: boolean
      error?: string
      parsed?: { type?: unknown; customerName?: unknown; date?: unknown; time?: unknown; location?: unknown }
    } | null
    if (!res.ok || !data?.success || !data.parsed) {
      return { ok: false, error: data?.error ?? 'AI가 문장을 해석하지 못했습니다. 다시 써주세요.' }
    }
    const p = data.parsed
    return {
      ok: true,
      parsed: {
        type: String(p.type ?? 'meeting'),
        customerName: p.customerName ? String(p.customerName) : undefined,
        date: String(p.date ?? today),
        time: String(p.time ?? '10:00'),
        location: p.location ? String(p.location) : undefined
      }
    }
  } catch {
    return { ok: false, error: 'AI 해석 중 오류가 발생했습니다. 다시 시도해 주세요.' }
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * 미팅 메모 → AI 비서 분석 (요약·할일·다음 일정 제안). 실패/미설정 시 undefined —
 * 분석이 없어도 미팅 종료 처리는 계속된다. 메모 원문은 분석에만 쓰이고 저장은
 * schedule_events.memo 한 곳뿐.
 */
export async function requestMeetingBrief(args: {
  memo: string
  typeLabel: string
  customerName?: string
}): Promise<ScheduleAiBrief | undefined> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon || !args.memo.trim()) return undefined
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 45000)
  try {
    const token = (await functionsBearer()) ?? anon
    const res = await fetch(`${base}/meeting-brief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify(args),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as {
      success?: boolean
      brief?: { summary?: unknown; todos?: unknown; next?: { type?: unknown; suggestion?: unknown } | null }
    } | null
    if (!res.ok || !data?.success || !data.brief) return undefined
    const b = data.brief
    const summary = String(b.summary ?? '').trim()
    if (!summary) return undefined
    return {
      summary,
      todos: Array.isArray(b.todos) ? b.todos.map((t) => String(t)).filter(Boolean).slice(0, 6) : [],
      next:
        b.next && String(b.next.suggestion ?? '').trim()
          ? { type: String(b.next.type ?? 'meeting'), suggestion: String(b.next.suggestion).trim() }
          : undefined
    }
  } catch {
    return undefined
  } finally {
    window.clearTimeout(timer)
  }
}

/** Read-only scheduled consultations (상담 예정) for display alongside schedules. */
export async function listScheduledConsultations(): Promise<ConsultationWithCustomer[]> {
  const res = await listConsultations()
  if (!res.ok) return []
  return res.consultations.filter((c) => !!c.scheduledAt && c.status !== 'cancelled')
}

// --- client-side UX filters (RLS still authoritative) ----------------------

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
export function filterToday(events: ScheduleWithCustomer[]): ScheduleWithCustomer[] {
  const now = new Date()
  const s = startOfDay(now)
  const e = s + 24 * 60 * 60 * 1000
  return events.filter((ev) => {
    const t = Date.parse(ev.startsAt)
    return !Number.isNaN(t) && t >= s && t < e
  })
}
export function filterThisWeek(events: ScheduleWithCustomer[]): ScheduleWithCustomer[] {
  const now = new Date()
  const day = now.getDay() // 0 Sun
  const monday = startOfDay(now) - ((day + 6) % 7) * 24 * 60 * 60 * 1000
  const nextMonday = monday + 7 * 24 * 60 * 60 * 1000
  return events.filter((ev) => {
    const t = Date.parse(ev.startsAt)
    return !Number.isNaN(t) && t >= monday && t < nextMonday
  })
}
export function searchScheduleEvents(
  events: ScheduleWithCustomer[],
  query: string,
  status?: ScheduleStatus | 'all',
  type?: ScheduleType | 'all'
): ScheduleWithCustomer[] {
  const q = query.trim().toLowerCase()
  return events.filter((ev) => {
    if (status && status !== 'all' && ev.status !== status) return false
    if (type && type !== 'all' && ev.type !== type) return false
    if (!q) return true
    return ev.title.toLowerCase().includes(q) || (ev.customerName ?? '').toLowerCase().includes(q)
  })
}

export type { ScheduleWithCustomer }
