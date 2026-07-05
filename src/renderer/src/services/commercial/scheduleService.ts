import type { ScheduleEvent } from '@shared/commercial/models'
import type { ScheduleInput, ScheduleStatus, ScheduleType } from './scheduleValidation'
import { getBackendConfig } from './backendConfig'
import { customerRepository, scheduleRepository } from './services'
import { supabaseScheduleAdapter, type ScheduleWithCustomer } from './supabaseScheduleAdapter'
import { listConsultations, type ConsultationWithCustomer } from './consultationService'

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
