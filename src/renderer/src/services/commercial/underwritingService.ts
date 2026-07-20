import { getSupabaseClient, initSupabaseClient, getSupabaseConfigStatus } from './supabaseClient'

/**
 * 고지의무(인수기준) 조회·관리 — public.underwriting_diseases / underwriting_rules.
 *
 * 팀 공유(Supabase). 조회는 전 직원, 수정(규칙 입력·질병 추가)은 대표·관리자(RLS).
 * 보험사별 인수기준은 임의 생성하지 않으며, 미입력은 '확인 필요'로 표시된다.
 * 모든 규칙은 verified 플래그로 검증 여부를 구분한다(미검증 = 참고용).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type UwStatus = 'standard' | 'simplified' | 'loading' | 'exclusion' | 'decline' | 'unknown'

export interface UwStatusMeta {
  label: string
  /** Tailwind(리맵) 색상 계열 키. */
  tone: 'emerald' | 'blue' | 'amber' | 'orange' | 'rose' | 'slate'
}

export const UW_STATUS: Record<UwStatus, UwStatusMeta> = {
  standard: { label: '정상 인수', tone: 'emerald' },
  simplified: { label: '간편심사', tone: 'blue' },
  loading: { label: '할증', tone: 'amber' },
  exclusion: { label: '부담보', tone: 'orange' },
  decline: { label: '거절', tone: 'rose' },
  unknown: { label: '확인 필요', tone: 'slate' }
}

export const UW_STATUS_ORDER: UwStatus[] = ['standard', 'simplified', 'loading', 'exclusion', 'decline', 'unknown']

/** 표시 순서: 손해보험 먼저, 생명보험 나중. */
export const INSURERS: string[] = [
  '삼성화재',
  '현대해상',
  'DB손해보험',
  'KB손해보험',
  '메리츠화재',
  '흥국화재',
  '롯데손해보험',
  'NH농협손해보험',
  '삼성생명',
  '한화생명',
  '교보생명',
  '라이나생명'
]

export interface UwRule {
  status: UwStatus
  note: string
  verified: boolean
}

export interface UwDisease {
  id: string
  name: string
  aliases: string[]
  category: string
  generalNote: string
  sortOrder: number
  /** 보험사명 → 규칙. 없는 보험사는 '확인 필요'로 간주. */
  rules: Record<string, UwRule>
}

export function underwritingEnabled(): boolean {
  return getSupabaseConfigStatus().isConfigured
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

/** 규칙에 없는 보험사는 '확인 필요'로 채워 12개 전체를 반환. */
export function ruleFor(d: UwDisease, insurer: string): UwRule {
  return d.rules[insurer] ?? { status: 'unknown', note: '', verified: false }
}

export function verifiedCount(d: UwDisease): number {
  return INSURERS.reduce((n, ins) => n + (d.rules[ins]?.verified ? 1 : 0), 0)
}

/** 전체 질병 + 규칙을 불러와 질병 단위로 묶는다. */
export async function listUnderwriting(): Promise<UwDisease[]> {
  const client = await getClient()
  if (!client) throw new Error('Supabase 설정이 없습니다.')
  const [{ data: diseases, error: de }, { data: rules, error: re }] = await Promise.all([
    client
      .from('underwriting_diseases')
      .select('id, name, aliases, category, general_note, sort_order')
      .order('sort_order', { ascending: true }),
    client.from('underwriting_rules').select('disease_id, insurer, status, note, verified')
  ])
  if (de || re) throw new Error('고지의무 데이터를 불러오지 못했습니다.')

  const byDisease: Record<string, Record<string, UwRule>> = {}
  for (const r of (rules ?? []) as any[]) {
    const did = String(r.disease_id)
    if (!byDisease[did]) byDisease[did] = {}
    const status: UwStatus = (UW_STATUS as any)[r.status] ? (r.status as UwStatus) : 'unknown'
    byDisease[did][String(r.insurer)] = {
      status,
      note: r.note ?? '',
      verified: !!r.verified
    }
  }
  return ((diseases ?? []) as any[]).map((d) => ({
    id: String(d.id),
    name: String(d.name ?? ''),
    aliases: Array.isArray(d.aliases) ? (d.aliases as string[]) : [],
    category: String(d.category ?? '기타'),
    generalNote: d.general_note ?? '',
    sortOrder: Number(d.sort_order ?? 0),
    rules: byDisease[String(d.id)] ?? {}
  }))
}

/** 규칙 저장(질병×보험사 1건 upsert). 대표·관리자만 성공(RLS). */
export async function upsertRule(
  diseaseId: string,
  insurer: string,
  value: UwRule
): Promise<void> {
  const client = await getClient()
  if (!client) throw new Error('Supabase 설정이 없습니다.')
  const userId = await currentUserId(client)
  const row = {
    disease_id: diseaseId,
    insurer,
    status: value.status,
    note: value.note?.trim() || null,
    verified: value.verified,
    updated_by: userId,
    updated_at: new Date().toISOString()
  }
  const { error } = await client
    .from('underwriting_rules')
    .upsert(row, { onConflict: 'disease_id,insurer' })
  if (error) throw new Error(permMsg(error, '규칙'))
}

/** 질병 추가. 대표·관리자만 성공(RLS). */
export async function addDisease(input: {
  name: string
  category: string
  aliases: string[]
  generalNote: string
}): Promise<void> {
  const client = await getClient()
  if (!client) throw new Error('Supabase 설정이 없습니다.')
  // 정렬 맨 뒤로
  const { data: maxRow } = await client
    .from('underwriting_diseases')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextSort = (maxRow?.sort_order ?? 0) + 10
  const { error } = await client.from('underwriting_diseases').insert({
    name: input.name.trim(),
    category: input.category.trim() || '기타',
    aliases: input.aliases,
    general_note: input.generalNote.trim() || null,
    sort_order: nextSort
  })
  if (error) throw new Error(permMsg(error, '질병'))
}

function permMsg(error: any, what: string): string {
  const m = String(error?.message ?? '')
  if (/row-level security|permission|policy/i.test(m)) {
    return `${what} 수정 권한이 없습니다. 대표·관리자만 변경할 수 있습니다.`
  }
  return `${what} 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.`
}

/** 다른 사용자의 변경을 실시간 반영. */
export function subscribeUnderwriting(onChange: () => void): () => void {
  const client = getSupabaseClient() as any
  if (!client?.channel) return () => {}
  const channel = client
    .channel('underwriting-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'underwriting_rules' }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'underwriting_diseases' }, () => onChange())
    .subscribe()
  return () => {
    try {
      client.removeChannel(channel)
    } catch {
      /* ignore */
    }
  }
}
