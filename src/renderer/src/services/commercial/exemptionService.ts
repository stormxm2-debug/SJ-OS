import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * 면책기간 알람 서비스 (1단계). 각 고객 보험 가입 건의 보장개시일 + 면책기간을 기록.
 * 면책 종료일(waiting_end)은 DB 생성열로 자동 계산되고, 매일 pg_cron 이 임박/도래를
 * 점검해 담당 FC 에게 알림(exemption_alerts)을 만든다. 알람 수신은 NotificationCenter.
 * 테이블 미적용(42P01)이면 configured=false 로 '설정 전' 처리.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PolicyExemption {
  id: string
  customerId: string
  customerName: string
  staffId: string
  insurer: string
  productName?: string
  coverage?: string
  startDate: string
  waitingDays: number
  waitingEnd: string
  memo?: string
  source: 'manual' | 'ai'
}

export interface ExemptionInput {
  customerId: string
  insurer: string
  productName?: string
  coverage?: string
  startDate: string
  waitingDays: number
  memo?: string
}

/** 자주 쓰는 면책기간 프리셋. */
export const WAITING_PRESETS: { label: string; days: number }[] = [
  { label: '90일 (암 등 진단)', days: 90 },
  { label: '1년', days: 365 },
  { label: '2년 (자살 면책 등)', days: 730 },
  { label: '30일', days: 30 },
  { label: '180일', days: 180 }
]

/** 면책 상태 계산 (오늘 기준). */
export function exemptionStatus(waitingEnd: string): { key: 'ended' | 'soon' | 'active'; label: string; days: number } {
  const end = new Date(waitingEnd)
  const today = new Date()
  end.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  const days = Math.round((end.getTime() - today.getTime()) / 86400000)
  if (days <= 0) return { key: 'ended', label: '면책 종료', days }
  if (days <= 7) return { key: 'soon', label: `D-${days} 임박`, days }
  return { key: 'active', label: `D-${days}`, days }
}

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}
async function uid(client: any): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession()
    return data?.session?.user?.id ?? null
  } catch {
    return null
  }
}
function isMissingSetup(err: any): boolean {
  const code = String(err?.code ?? '')
  const msg = String(err?.message ?? '')
  return code === '42P01' || /relation .* does not exist|could not find the table/i.test(msg)
}

function mapRow(r: Record<string, any>): PolicyExemption {
  return {
    id: String(r.id),
    customerId: String(r.customer_id ?? ''),
    customerName: String(r.customer?.name ?? ''),
    staffId: String(r.staff_id ?? ''),
    insurer: String(r.insurer ?? ''),
    productName: (r.product_name as string | null) ?? undefined,
    coverage: (r.coverage as string | null) ?? undefined,
    startDate: String(r.start_date ?? ''),
    waitingDays: Number(r.waiting_days ?? 0),
    waitingEnd: String(r.waiting_end ?? ''),
    memo: (r.memo as string | null) ?? undefined,
    source: (r.source as 'manual' | 'ai') ?? 'manual'
  }
}

/** 내 담당(+관리자는 전체) 면책 기록 — 면책 종료일 오름차순. */
export async function listExemptions(): Promise<{ items: PolicyExemption[]; configured: boolean }> {
  const client = await getClient()
  if (!client) return { items: [], configured: false }
  const { data, error } = await client
    .from('policy_exemptions')
    .select('*, customer:customers(name)')
    .order('waiting_end', { ascending: true })
  if (error) {
    if (isMissingSetup(error)) return { items: [], configured: false }
    return { items: [], configured: true }
  }
  return { items: ((data ?? []) as Record<string, any>[]).map(mapRow), configured: true }
}

export async function createExemption(input: ExemptionInput): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const me = await uid(client)
  if (!me) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  if (!input.customerId) return { ok: false, error: '고객을 선택해주세요.' }
  if (!input.insurer.trim()) return { ok: false, error: '보험사를 입력해주세요.' }
  if (!input.startDate) return { ok: false, error: '보장개시일을 입력해주세요.' }
  const { error } = await client.from('policy_exemptions').insert({
    customer_id: input.customerId,
    staff_id: me,
    insurer: input.insurer.trim(),
    product_name: input.productName?.trim() || null,
    coverage: input.coverage?.trim() || null,
    start_date: input.startDate,
    waiting_days: input.waitingDays,
    memo: input.memo?.trim() || null,
    source: 'manual'
  })
  if (error) {
    if (isMissingSetup(error)) return { ok: false, error: '면책 알람이 아직 설정되지 않았습니다(테이블 미적용).' }
    return { ok: false, error: error.message ?? '저장에 실패했습니다.' }
  }
  return { ok: true }
}

export async function updateExemption(id: string, input: Partial<ExemptionInput>): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const patch: Record<string, any> = {}
  if (input.insurer !== undefined) patch.insurer = input.insurer.trim()
  if (input.productName !== undefined) patch.product_name = input.productName?.trim() || null
  if (input.coverage !== undefined) patch.coverage = input.coverage?.trim() || null
  if (input.startDate !== undefined) patch.start_date = input.startDate
  if (input.waitingDays !== undefined) patch.waiting_days = input.waitingDays
  if (input.memo !== undefined) patch.memo = input.memo?.trim() || null
  // 개시일/면책일수 변경 시 재알림 가능하도록 알림 플래그 초기화
  if (input.startDate !== undefined || input.waitingDays !== undefined) {
    patch.alerted_approaching = false
    patch.alerted_due = false
  }
  const { error } = await client.from('policy_exemptions').update(patch).eq('id', id)
  if (error) return { ok: false, error: error.message ?? '수정에 실패했습니다.' }
  return { ok: true }
}

export async function deleteExemption(id: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const { error } = await client.from('policy_exemptions').delete().eq('id', id)
  if (error) return { ok: false, error: error.message ?? '삭제에 실패했습니다.' }
  return { ok: true }
}
