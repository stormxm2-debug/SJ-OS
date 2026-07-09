import type { ScheduleAiBrief, ScheduleEvent } from '@shared/commercial/models'
import type { ScheduleInput } from './scheduleValidation'
import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * Supabase schedule adapter — real queries against public.schedule_events.
 *
 * SECURITY: anon public client only (never service_role). RLS is the real access
 * boundary; client-side filtering is UX only. Never logs memo or customer PII.
 * staff_id is set to the auth user id on insert and is never client-overwritten.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const SELECT_COLS =
  'id, staff_id, customer_id, title, type, starts_at, ends_at, status, memo, location, manual_customer_name, ai_brief, created_at, updated_at, customer:customers(id, name, status, owner_staff_id, team_id)'

export type AdapterReason = 'not-configured' | 'no-session' | 'error'
export interface AdapterOk<T> {
  ok: true
  data: T
}
export interface AdapterErr {
  ok: false
  reason: AdapterReason
  message: string
}
export type AdapterResult<T> = AdapterOk<T> | AdapterErr

function err(reason: AdapterReason, message: string): AdapterErr {
  return { ok: false, reason, message }
}

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}
async function currentUserId(client: any): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession()
    return data?.session?.user?.id ?? null
  } catch {
    return null
  }
}

export interface ScheduleWithCustomer extends ScheduleEvent {
  customerName?: string
}

function mapRow(row: Record<string, unknown>): ScheduleWithCustomer {
  const cust = (row.customer as Record<string, unknown> | null) ?? null
  return {
    id: String(row.id),
    staffId: String(row.staff_id ?? ''),
    staffName: '',
    customerId: (row.customer_id as string | null) ?? undefined,
    title: String(row.title ?? ''),
    type: (row.type as ScheduleEvent['type']) ?? 'internal',
    startsAt: String(row.starts_at ?? ''),
    endsAt: (row.ends_at as string | null) ?? undefined,
    status: (row.status as ScheduleEvent['status']) ?? 'planned',
    memo: (row.memo as string | null) ?? undefined,
    location: (row.location as string | null) ?? undefined,
    manualCustomerName: (row.manual_customer_name as string | null) ?? undefined,
    aiBrief: (row.ai_brief as ScheduleAiBrief | null) ?? undefined,
    // 표시용 고객명: 고객관리 연결 이름 → 없으면 직접 입력 이름
    customerName: cust ? String(cust.name ?? '') : ((row.manual_customer_name as string | null) ?? undefined)
  }
}

function buildInsert(input: ScheduleInput, staffId: string): Record<string, unknown> {
  return {
    staff_id: staffId, // must equal auth.uid() (RLS enforces)
    customer_id: input.customerId?.trim() || null,
    manual_customer_name: input.manualCustomerName?.trim() || null,
    title: input.title.trim(),
    type: input.type,
    starts_at: input.startsAt,
    ends_at: input.endsAt?.trim() || null,
    status: input.status,
    memo: input.memo?.trim() || null,
    location: input.location?.trim() || null
  }
}

export const supabaseScheduleAdapter = {
  async listScheduleEvents(): Promise<AdapterResult<ScheduleWithCustomer[]>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
    const { data, error } = await client.from('schedule_events').select(SELECT_COLS).order('starts_at', { ascending: true })
    if (error) return err('error', '일정 목록을 불러오지 못했습니다.')
    return { ok: true, data: (data ?? []).map(mapRow) }
  },

  async getScheduleEvent(id: string): Promise<AdapterResult<ScheduleWithCustomer | null>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const { data, error } = await client.from('schedule_events').select(SELECT_COLS).eq('id', id).maybeSingle()
    if (error) return err('error', '일정을 불러오지 못했습니다.')
    return { ok: true, data: data ? mapRow(data) : null }
  },

  async createScheduleEvent(input: ScheduleInput): Promise<AdapterResult<ScheduleWithCustomer>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const userId = await currentUserId(client)
    if (!userId) return err('no-session', '로그인 세션이 없습니다.')
    const { data, error } = await client.from('schedule_events').insert(buildInsert(input, userId)).select(SELECT_COLS).single()
    if (error) return err('error', '일정 저장에 실패했습니다.')
    return { ok: true, data: mapRow(data) }
  },

  async updateScheduleEvent(id: string, input: Partial<ScheduleInput>): Promise<AdapterResult<ScheduleWithCustomer>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    // Allowed fields only — never staff_id from the renderer.
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (input.customerId !== undefined) patch.customer_id = input.customerId?.trim() || null
    if (input.manualCustomerName !== undefined) patch.manual_customer_name = input.manualCustomerName?.trim() || null
    if (input.title !== undefined) patch.title = input.title.trim()
    if (input.type !== undefined) patch.type = input.type
    if (input.startsAt !== undefined) patch.starts_at = input.startsAt
    if (input.endsAt !== undefined) patch.ends_at = input.endsAt?.trim() || null
    if (input.status !== undefined) patch.status = input.status
    if (input.memo !== undefined) patch.memo = input.memo?.trim() || null
    if (input.location !== undefined) patch.location = input.location?.trim() || null
    const { data, error } = await client.from('schedule_events').update(patch).eq('id', id).select(SELECT_COLS).single()
    if (error) return err('error', '일정 저장에 실패했습니다.')
    return { ok: true, data: mapRow(data) }
  },

  /**
   * 미팅 종료 처리 — 메모 저장 순간이 곧 종료시각. 상태 done + ends_at=now +
   * memo + (있으면) AI 분석 결과를 한 번에 기록한다.
   */
  async finishMeeting(id: string, memo: string, aiBrief?: ScheduleAiBrief): Promise<AdapterResult<ScheduleWithCustomer>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
    const patch: Record<string, unknown> = {
      memo: memo.trim() || null,
      ends_at: new Date().toISOString(),
      status: 'done',
      ai_brief: aiBrief ?? null,
      updated_at: new Date().toISOString()
    }
    const { data, error } = await client.from('schedule_events').update(patch).eq('id', id).select(SELECT_COLS).single()
    if (error) return err('error', '미팅 종료 처리에 실패했습니다.')
    return { ok: true, data: mapRow(data) }
  }
}
