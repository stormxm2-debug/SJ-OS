import type { ConsultationRecord } from '@shared/commercial/models'
import type { ConsultationInput } from './consultationValidation'
import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * Supabase consultation adapter — real queries against public.consultations.
 *
 * SECURITY: anon public client only (never service_role). RLS is the real access
 * boundary; client-side filtering is UX only. Never logs summary/next_action or
 * customer PII. staff_id is set to the auth user id on insert and is never
 * client-overwritten on update.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const SELECT_COLS =
  'id, customer_id, staff_id, consultation_type, status, summary, next_action, scheduled_at, completed_at, created_at, updated_at, customer:customers(id, name, status, owner_staff_id, team_id)'

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

export interface ConsultationWithCustomer extends ConsultationRecord {
  customerName?: string
}

function mapRow(row: Record<string, unknown>): ConsultationWithCustomer {
  const cust = (row.customer as Record<string, unknown> | null) ?? null
  return {
    id: String(row.id),
    customerId: String(row.customer_id ?? ''),
    staffId: String(row.staff_id ?? ''),
    staffName: '',
    consultationType: (row.consultation_type as ConsultationRecord['consultationType']) ?? 'first',
    status: (row.status as ConsultationRecord['status']) ?? 'planned',
    summary: String(row.summary ?? ''),
    nextAction: (row.next_action as string | null) ?? undefined,
    scheduledAt: (row.scheduled_at as string | null) ?? undefined,
    completedAt: (row.completed_at as string | null) ?? undefined,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    customerName: cust ? String(cust.name ?? '') : undefined
  }
}

function buildInsert(input: ConsultationInput, staffId: string): Record<string, unknown> {
  return {
    customer_id: input.customerId,
    staff_id: staffId, // must equal auth.uid() (RLS enforces)
    consultation_type: input.consultationType,
    status: input.status,
    summary: input.summary?.trim() || null,
    next_action: input.nextAction?.trim() || null,
    scheduled_at: input.scheduledAt?.trim() || null,
    completed_at: input.completedAt?.trim() || null
  }
}

export const supabaseConsultationAdapter = {
  async listConsultations(): Promise<AdapterResult<ConsultationWithCustomer[]>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
    const { data, error } = await client
      .from('consultations')
      .select(SELECT_COLS)
      .order('scheduled_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })
    if (error) return err('error', '상담기록 목록을 불러오지 못했습니다.')
    return { ok: true, data: (data ?? []).map(mapRow) }
  },

  async listConsultationsByCustomer(customerId: string): Promise<AdapterResult<ConsultationWithCustomer[]>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const { data, error } = await client
      .from('consultations')
      .select(SELECT_COLS)
      .eq('customer_id', customerId)
      .order('updated_at', { ascending: false })
    if (error) return err('error', '상담기록 목록을 불러오지 못했습니다.')
    return { ok: true, data: (data ?? []).map(mapRow) }
  },

  async getConsultation(id: string): Promise<AdapterResult<ConsultationWithCustomer | null>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const { data, error } = await client.from('consultations').select(SELECT_COLS).eq('id', id).maybeSingle()
    if (error) return err('error', '상담기록을 불러오지 못했습니다.')
    return { ok: true, data: data ? mapRow(data) : null }
  },

  async createConsultation(input: ConsultationInput): Promise<AdapterResult<ConsultationWithCustomer>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const userId = await currentUserId(client)
    if (!userId) return err('no-session', '로그인 세션이 없습니다.')
    const { data, error } = await client.from('consultations').insert(buildInsert(input, userId)).select(SELECT_COLS).single()
    if (error) return err('error', '상담기록 저장에 실패했습니다.')
    return { ok: true, data: mapRow(data) }
  },

  async updateConsultation(id: string, input: Partial<ConsultationInput>): Promise<AdapterResult<ConsultationWithCustomer>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    // Allowed fields only — never customer_id/staff_id from the renderer.
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (input.consultationType !== undefined) patch.consultation_type = input.consultationType
    if (input.status !== undefined) patch.status = input.status
    if (input.summary !== undefined) patch.summary = input.summary?.trim() || null
    if (input.nextAction !== undefined) patch.next_action = input.nextAction?.trim() || null
    if (input.scheduledAt !== undefined) patch.scheduled_at = input.scheduledAt?.trim() || null
    if (input.completedAt !== undefined) patch.completed_at = input.completedAt?.trim() || null
    const { data, error } = await client.from('consultations').update(patch).eq('id', id).select(SELECT_COLS).single()
    if (error) return err('error', '상담기록 저장에 실패했습니다.')
    return { ok: true, data: mapRow(data) }
  }
}
