import type { CustomerAttachment, CustomerRecord, CustomerStatus } from '@shared/commercial/models'
import type { CustomerInput } from './customerValidation'
import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * Supabase customer adapter — real queries against public.customers.
 *
 * SECURITY: anon public client only (never service_role). RLS is the real access
 * boundary; any client-side filtering is UX only. Never logs customer
 * phone/birth/address/memo. owner_staff_id is set to the auth user id on insert and
 * is never overwritten from the renderer on update; team_id is not client-settable
 * on update.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const SELECT_COLS =
  'id, owner_staff_id, team_id, name, phone, birth_date, address, source, status, tags, memo, rrn, medical_history, height_cm, weight_kg, household_id, relation, attachments, registered_insurers, created_at, updated_at'

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

function mapRow(row: Record<string, unknown>): CustomerRecord {
  return {
    id: String(row.id),
    ownerStaffId: String(row.owner_staff_id ?? ''),
    ownerStaffName: '', // resolved via profiles elsewhere; not needed for display here
    teamId: (row.team_id as string | null) ?? undefined,
    name: String(row.name ?? ''),
    phone: (row.phone as string | null) ?? undefined,
    birthDate: (row.birth_date as string | null) ?? undefined,
    address: (row.address as string | null) ?? undefined,
    source: (row.source as string | null) ?? undefined,
    status: (row.status as CustomerStatus) ?? 'new',
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    memo: (row.memo as string | null) ?? undefined,
    rrn: (row.rrn as string | null) ?? undefined,
    medicalHistory: (row.medical_history as string | null) ?? undefined,
    heightCm: row.height_cm != null ? Number(row.height_cm) : undefined,
    weightKg: row.weight_kg != null ? Number(row.weight_kg) : undefined,
    householdId: (row.household_id as string | null) ?? undefined,
    relation: (row.relation as string | null) ?? undefined,
    attachments: Array.isArray(row.attachments) ? (row.attachments as CustomerAttachment[]) : [],
    registeredInsurers: Array.isArray(row.registered_insurers) ? (row.registered_insurers as string[]) : [],
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? '')
  }
}

export const supabaseCustomerAdapter = {
  async listCustomers(): Promise<AdapterResult<CustomerRecord[]>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
    const { data, error } = await client.from('customers').select(SELECT_COLS).order('updated_at', { ascending: false })
    if (error) return err('error', '고객 목록을 불러오지 못했습니다.')
    return { ok: true, data: (data ?? []).map(mapRow) }
  },

  async getCustomer(id: string): Promise<AdapterResult<CustomerRecord | null>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const { data, error } = await client.from('customers').select(SELECT_COLS).eq('id', id).maybeSingle()
    if (error) return err('error', '고객 정보를 불러오지 못했습니다.')
    return { ok: true, data: data ? mapRow(data) : null }
  },

  async createCustomer(input: CustomerInput): Promise<AdapterResult<CustomerRecord>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    const userId = await currentUserId(client)
    if (!userId) return err('no-session', '로그인 세션이 없습니다.')
    // team_id from the current profile (best-effort).
    let teamId: string | null = null
    try {
      const { data: prof } = await client.from('profiles').select('team_id').eq('id', userId).maybeSingle()
      teamId = (prof?.team_id as string | null) ?? null
    } catch {
      teamId = null
    }
    const row = {
      owner_staff_id: userId, // must equal auth.uid() (RLS enforces)
      team_id: teamId,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      birth_date: input.birthDate?.trim() || null,
      address: input.address?.trim() || null,
      source: input.source?.trim() || null,
      status: input.status,
      tags: input.tags,
      memo: input.memo?.trim() || null,
      rrn: input.rrn?.trim() || null,
      medical_history: input.medicalHistory?.trim() || null,
      height_cm: input.heightCm || null,
      weight_kg: input.weightKg || null,
      household_id: input.householdId || null,
      relation: input.relation?.trim() || null,
      attachments: input.attachments ?? []
    }
    const { data, error } = await client.from('customers').insert(row).select(SELECT_COLS).single()
    if (error) return err('error', '고객 저장에 실패했습니다.')
    return { ok: true, data: mapRow(data) }
  },

  async updateCustomer(id: string, input: Partial<CustomerInput>): Promise<AdapterResult<CustomerRecord>> {
    const client = await getClient()
    if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
    // Allowed fields only — never owner_staff_id / team_id from the renderer.
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (input.name !== undefined) patch.name = input.name.trim()
    if (input.phone !== undefined) patch.phone = input.phone?.trim() || null
    if (input.birthDate !== undefined) patch.birth_date = input.birthDate?.trim() || null
    if (input.address !== undefined) patch.address = input.address?.trim() || null
    if (input.source !== undefined) patch.source = input.source?.trim() || null
    if (input.status !== undefined) patch.status = input.status
    if (input.tags !== undefined) patch.tags = input.tags
    if (input.memo !== undefined) patch.memo = input.memo?.trim() || null
    if (input.rrn !== undefined) patch.rrn = input.rrn?.trim() || null
    if (input.medicalHistory !== undefined) patch.medical_history = input.medicalHistory?.trim() || null
    if (input.heightCm !== undefined) patch.height_cm = input.heightCm || null
    if (input.weightKg !== undefined) patch.weight_kg = input.weightKg || null
    if (input.householdId !== undefined) patch.household_id = input.householdId || null
    if (input.relation !== undefined) patch.relation = input.relation?.trim() || null
    if (input.attachments !== undefined) patch.attachments = input.attachments
    const { data, error } = await client.from('customers').update(patch).eq('id', id).select(SELECT_COLS).single()
    if (error) return err('error', '고객 저장에 실패했습니다.')
    return { ok: true, data: mapRow(data) }
  },

  async updateCustomerStatus(id: string, status: CustomerStatus): Promise<AdapterResult<CustomerRecord>> {
    return this.updateCustomer(id, { status } as Partial<CustomerInput>)
  }
}
