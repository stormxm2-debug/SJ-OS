/**
 * 개발 요청함 서비스 — 경영 회의실 '대표 결정 안건' 등을 개발 요청으로 모아 관리.
 * 대표/관리자만 접근(RLS is_owner_or_admin()).
 */
import { initSupabaseClient, getSupabaseClient } from './supabaseClient'
import { getBackendConfig } from './backendConfig'

/* eslint-disable @typescript-eslint/no-explicit-any */

export type DevStatus = 'new' | 'doing' | 'done'
export const DEV_STATUS_LABEL: Record<DevStatus, string> = { new: '접수', doing: '진행', done: '완료' }

export interface DevRequest {
  id: string
  title: string
  detail: string
  source: string
  sourceRef: string
  status: DevStatus
  createdAt: string
}

export const DEV_RT_TABLES = ['dev_requests']

export function isSupabaseMode(): boolean {
  return getBackendConfig().mode === 'supabase'
}

async function sb(): Promise<any | null> {
  if (getBackendConfig().mode !== 'supabase') return null
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}

function mapRow(r: any): DevRequest {
  return {
    id: r.id,
    title: r.title ?? '',
    detail: r.detail ?? '',
    source: r.source ?? '',
    sourceRef: r.source_ref ?? '',
    status: (['new', 'doing', 'done'].includes(r.status) ? r.status : 'new') as DevStatus,
    createdAt: r.created_at
  }
}

export async function createRequest(input: {
  title: string
  detail?: string
  source?: string
  sourceRef?: string
}): Promise<DevRequest | null> {
  const c = await sb()
  if (!c) throw new Error('전산(서버) 연동이 필요합니다.')
  const { data, error } = await c
    .from('dev_requests')
    .insert({
      title: input.title.slice(0, 500),
      detail: input.detail ?? null,
      source: input.source ?? null,
      source_ref: input.sourceRef ?? null
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return mapRow(data)
}

export async function listRequests(): Promise<DevRequest[]> {
  const c = await sb()
  if (!c) return []
  const { data, error } = await c
    .from('dev_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data || []).map(mapRow)
}

export async function updateStatus(id: string, status: DevStatus): Promise<void> {
  const c = await sb()
  if (!c) return
  const { error } = await c.from('dev_requests').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteRequest(id: string): Promise<void> {
  const c = await sb()
  if (!c) return
  const { error } = await c.from('dev_requests').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
