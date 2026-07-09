import type { ConsultationRecord } from '@shared/commercial/models'
import type { ConsultationInput, ConsultationStatus } from './consultationValidation'
import { getBackendConfig } from './backendConfig'
import { consultationRepository, customerRepository } from './services'
import { supabaseConsultationAdapter, type ConsultationWithCustomer } from './supabaseConsultationAdapter'
import { getFunctionsBaseUrl, getSupabaseAnonKey, getSupabaseClient, initSupabaseClient } from './supabaseClient'

/** AI 상담 코치 분석 결과 (consult-coach edge function). */
export interface ConsultCoach {
  needs: string
  approach: string
  nextAction: string
  next?: { type: string; suggestion: string }
}

async function coachBearer(): Promise<string | undefined> {
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

/**
 * 상담 요약 → AI 코치 (니즈·추천 접근·다음 액션·다음 일정 제안). 고객 정보와 과거
 * 상담 이력을 함께 보내 맞춤 조언을 받는다. 실패 시 error — 저장 흐름과는 무관.
 */
export async function requestConsultCoach(args: {
  summary: string
  typeLabel: string
  customer?: { name: string; age?: number; gender?: string; medicalHistory?: string; familyCount?: number }
  history?: string[]
}): Promise<{ ok: boolean; coach?: ConsultCoach; error?: string }> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, error: 'AI 코치는 서버 연결 후 사용할 수 있습니다.' }
  if (!args.summary.trim()) return { ok: false, error: '상담 요약을 먼저 입력해주세요.' }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 45000)
  try {
    const token = (await coachBearer()) ?? anon
    const res = await fetch(`${base}/consult-coach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify(args),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as {
      success?: boolean
      error?: string
      coach?: { needs?: unknown; approach?: unknown; nextAction?: unknown; next?: { type?: unknown; suggestion?: unknown } | null }
    } | null
    if (!res.ok || !data?.success || !data.coach) return { ok: false, error: data?.error ?? 'AI 분석에 실패했습니다.' }
    const c = data.coach
    return {
      ok: true,
      coach: {
        needs: String(c.needs ?? ''),
        approach: String(c.approach ?? ''),
        nextAction: String(c.nextAction ?? ''),
        next:
          c.next && String(c.next.suggestion ?? '').trim()
            ? { type: String(c.next.type ?? 'meeting'), suggestion: String(c.next.suggestion) }
            : undefined
      }
    }
  } catch {
    return { ok: false, error: 'AI 분석 중 오류가 발생했습니다. 다시 시도해 주세요.' }
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * Unified consultation service. Routes to Supabase when configured + logged in,
 * else to the local-mock repository. Callers get a data-mode tag + Korean error and
 * never see raw SQL/tokens. Client-side filter/today/pending are UX only (RLS
 * remains the authority). Never logs summaries/PII.
 */

export type ConsultationDataMode = 'local-mock' | 'supabase' | 'not-configured' | 'no-session'

export interface ConsultationListResult {
  ok: boolean
  mode: ConsultationDataMode
  consultations: ConsultationWithCustomer[]
  error?: string
}
export interface ConsultationMutationResult {
  ok: boolean
  mode: ConsultationDataMode
  consultation?: ConsultationWithCustomer
  error?: string
}

function isSupabase(): boolean {
  return getBackendConfig().mode === 'supabase'
}

async function localWithNames(records: ConsultationRecord[]): Promise<ConsultationWithCustomer[]> {
  const customers = await customerRepository.list()
  const nameById = new Map(customers.map((c) => [c.id, c.name]))
  return records.map((r) => ({ ...r, customerName: nameById.get(r.customerId) }))
}

export async function listConsultations(): Promise<ConsultationListResult> {
  if (isSupabase()) {
    const res = await supabaseConsultationAdapter.listConsultations()
    if (res.ok) return { ok: true, mode: 'supabase', consultations: res.data }
    return { ok: false, mode: res.reason === 'no-session' ? 'no-session' : res.reason === 'not-configured' ? 'not-configured' : 'supabase', consultations: [], error: res.message }
  }
  const items = await consultationRepository.list()
  return { ok: true, mode: 'local-mock', consultations: await localWithNames(items) }
}

export async function createConsultation(input: ConsultationInput): Promise<ConsultationMutationResult> {
  if (isSupabase()) {
    const res = await supabaseConsultationAdapter.createConsultation(input)
    if (res.ok) return { ok: true, mode: 'supabase', consultation: res.data }
    return { ok: false, mode: res.reason === 'no-session' ? 'no-session' : 'supabase', error: res.message }
  }
  const now = new Date().toISOString()
  const record: ConsultationRecord = {
    id: `s-local-${now}-${Math.floor(Math.random() * 1000)}`,
    customerId: input.customerId,
    staffId: 'local',
    staffName: '로컬 사용자',
    consultationType: input.consultationType,
    status: input.status,
    summary: input.summary?.trim() || '',
    nextAction: input.nextAction?.trim() || undefined,
    scheduledAt: input.scheduledAt?.trim() || undefined,
    completedAt: input.completedAt?.trim() || undefined,
    createdAt: now,
    updatedAt: now
  }
  const saved = await consultationRepository.create(record)
  const [withName] = await localWithNames([saved])
  return { ok: true, mode: 'local-mock', consultation: withName }
}

export async function updateConsultation(id: string, input: Partial<ConsultationInput>): Promise<ConsultationMutationResult> {
  if (isSupabase()) {
    const res = await supabaseConsultationAdapter.updateConsultation(id, input)
    if (res.ok) return { ok: true, mode: 'supabase', consultation: res.data }
    return { ok: false, mode: 'supabase', error: res.message }
  }
  const patch: Partial<ConsultationRecord> = { updatedAt: new Date().toISOString() }
  if (input.consultationType !== undefined) patch.consultationType = input.consultationType
  if (input.status !== undefined) patch.status = input.status
  if (input.summary !== undefined) patch.summary = input.summary?.trim() || ''
  if (input.nextAction !== undefined) patch.nextAction = input.nextAction?.trim() || undefined
  if (input.scheduledAt !== undefined) patch.scheduledAt = input.scheduledAt?.trim() || undefined
  if (input.completedAt !== undefined) patch.completedAt = input.completedAt?.trim() || undefined
  const saved = await consultationRepository.update(id, patch)
  if (!saved) return { ok: false, mode: 'local-mock', error: '상담기록 저장에 실패했습니다.' }
  const [withName] = await localWithNames([saved])
  return { ok: true, mode: 'local-mock', consultation: withName }
}

export async function updateConsultationStatus(id: string, status: ConsultationStatus): Promise<ConsultationMutationResult> {
  const completedAt = status === 'completed' ? new Date().toISOString() : undefined
  return updateConsultation(id, { status, completedAt })
}

// --- client-side UX filters (RLS still authoritative) ----------------------

function isToday(iso?: string): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export function filterToday(list: ConsultationWithCustomer[]): ConsultationWithCustomer[] {
  return list.filter((c) => isToday(c.scheduledAt))
}
export function filterPendingNextActions(list: ConsultationWithCustomer[]): ConsultationWithCustomer[] {
  return list.filter((c) => !!c.nextAction && c.status !== 'cancelled' && (!c.completedAt || c.status === 'planned'))
}
export function searchConsultations(
  list: ConsultationWithCustomer[],
  query: string,
  status?: ConsultationStatus | 'all',
  type?: ConsultationInput['consultationType'] | 'all'
): ConsultationWithCustomer[] {
  const q = query.trim().toLowerCase()
  return list.filter((c) => {
    if (status && status !== 'all' && c.status !== status) return false
    if (type && type !== 'all' && c.consultationType !== type) return false
    if (!q) return true
    return (c.customerName ?? '').toLowerCase().includes(q)
  })
}

export type { ConsultationWithCustomer }
