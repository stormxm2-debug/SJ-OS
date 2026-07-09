import type { CustomerRecord, CustomerStatus } from '@shared/commercial/models'
import type { CustomerInput } from './customerValidation'
import { getBackendConfig } from './backendConfig'
import { customerRepository } from './services'
import { supabaseCustomerAdapter } from './supabaseCustomerAdapter'

/**
 * Unified customer service. Routes to Supabase when configured + logged in, else to
 * the local-mock repository. Callers get a data-mode tag + Korean error message and
 * never see raw SQL/tokens. Client-side search/filter is UX only (RLS is authority).
 */

export type CustomerDataMode = 'local-mock' | 'supabase' | 'not-configured' | 'no-session'

export interface CustomerListResult {
  ok: boolean
  mode: CustomerDataMode
  customers: CustomerRecord[]
  error?: string
}
export interface CustomerMutationResult {
  ok: boolean
  mode: CustomerDataMode
  customer?: CustomerRecord
  error?: string
}

function isSupabase(): boolean {
  return getBackendConfig().mode === 'supabase'
}

export async function listCustomers(): Promise<CustomerListResult> {
  if (isSupabase()) {
    const res = await supabaseCustomerAdapter.listCustomers()
    if (res.ok) return { ok: true, mode: 'supabase', customers: res.data }
    return { ok: false, mode: res.reason === 'no-session' ? 'no-session' : res.reason === 'not-configured' ? 'not-configured' : 'supabase', customers: [], error: res.message }
  }
  const items = await customerRepository.list()
  return { ok: true, mode: 'local-mock', customers: items }
}

export async function createCustomer(input: CustomerInput): Promise<CustomerMutationResult> {
  if (isSupabase()) {
    const res = await supabaseCustomerAdapter.createCustomer(input)
    if (res.ok) return { ok: true, mode: 'supabase', customer: res.data }
    return { ok: false, mode: res.reason === 'no-session' ? 'no-session' : 'supabase', error: res.message }
  }
  const now = new Date().toISOString()
  const record: CustomerRecord = {
    id: `c-local-${now}-${Math.floor(Math.random() * 1000)}`,
    ownerStaffId: 'local',
    ownerStaffName: '로컬 사용자',
    name: input.name.trim(),
    phone: input.phone?.trim() || undefined,
    birthDate: input.birthDate?.trim() || undefined,
    address: input.address?.trim() || undefined,
    source: input.source?.trim() || undefined,
    status: input.status,
    tags: input.tags,
    memo: input.memo?.trim() || undefined,
    rrn: input.rrn?.trim() || undefined,
    medicalHistory: input.medicalHistory?.trim() || undefined,
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    householdId: input.householdId,
    relation: input.relation,
    attachments: input.attachments ?? [],
    registeredInsurers: [],
    createdAt: now,
    updatedAt: now
  }
  const saved = await customerRepository.create(record)
  return { ok: true, mode: 'local-mock', customer: saved }
}

export async function updateCustomer(id: string, input: Partial<CustomerInput>): Promise<CustomerMutationResult> {
  if (isSupabase()) {
    const res = await supabaseCustomerAdapter.updateCustomer(id, input)
    if (res.ok) return { ok: true, mode: 'supabase', customer: res.data }
    return { ok: false, mode: 'supabase', error: res.message }
  }
  const patch: Partial<CustomerRecord> = { updatedAt: new Date().toISOString() }
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.phone !== undefined) patch.phone = input.phone?.trim() || undefined
  if (input.birthDate !== undefined) patch.birthDate = input.birthDate?.trim() || undefined
  if (input.address !== undefined) patch.address = input.address?.trim() || undefined
  if (input.source !== undefined) patch.source = input.source?.trim() || undefined
  if (input.status !== undefined) patch.status = input.status
  if (input.tags !== undefined) patch.tags = input.tags
  if (input.memo !== undefined) patch.memo = input.memo?.trim() || undefined
  if (input.rrn !== undefined) patch.rrn = input.rrn?.trim() || undefined
  if (input.medicalHistory !== undefined) patch.medicalHistory = input.medicalHistory?.trim() || undefined
  if (input.heightCm !== undefined) patch.heightCm = input.heightCm
  if (input.weightKg !== undefined) patch.weightKg = input.weightKg
  if (input.householdId !== undefined) patch.householdId = input.householdId
  if (input.relation !== undefined) patch.relation = input.relation
  if (input.attachments !== undefined) patch.attachments = input.attachments
  const saved = await customerRepository.update(id, patch)
  return saved ? { ok: true, mode: 'local-mock', customer: saved } : { ok: false, mode: 'local-mock', error: '고객 저장에 실패했습니다.' }
}

export async function updateCustomerStatus(id: string, status: CustomerStatus): Promise<CustomerMutationResult> {
  return updateCustomer(id, { status })
}

/** Client-side search/filter (UX only). */
export function filterCustomers(customers: CustomerRecord[], query: string, status?: CustomerStatus | 'all', tag?: string): CustomerRecord[] {
  const q = query.trim().toLowerCase()
  return customers.filter((c) => {
    if (status && status !== 'all' && c.status !== status) return false
    if (tag && !c.tags.includes(tag)) return false
    if (!q) return true
    return c.name.toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q)
  })
}
