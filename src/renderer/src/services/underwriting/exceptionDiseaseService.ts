import { getSupabaseClient, initSupabaseClient } from '../commercial/supabaseClient'

/**
 * 유병자 인수예외질환 검색 서비스 (underwriting_exceptions).
 *
 * 보험사 × 예외질환 × 인수기준(최소경과·치료기간·수술여부) × 가능상품구분을
 * 행 단위로 저장하고, 질환명 검색('&'로 최대 4개 AND 조합)과 보험사·상품구분
 * 필터를 제공한다. 전체 행을 한 번에 받아 클라이언트에서 필터링한다(수천 행
 * 규모까지 충분). RLS: 전 직원 읽기, owner/admin만 쓰기 — 인수 가이드와 동일.
 *
 * verified=false 행은 AI 참고용 시드(검수전 배지). 관리자가 저장하면 true.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type InsurerKind = 'N' | 'L' // 손보 / 생보

export const EXCEPTION_INSURERS: { name: string; kind: InsurerKind }[] = [
  // 손해보험
  { name: '삼성화재', kind: 'N' },
  { name: '현대해상', kind: 'N' },
  { name: 'DB손보', kind: 'N' },
  { name: 'KB손보', kind: 'N' },
  { name: '메리츠화재', kind: 'N' },
  { name: '한화손보', kind: 'N' },
  { name: '롯데손보', kind: 'N' },
  { name: '흥국화재', kind: 'N' },
  { name: '농협손보', kind: 'N' },
  { name: '하나손보', kind: 'N' },
  { name: 'AIG손보', kind: 'N' },
  // 생명보험
  { name: '삼성생명', kind: 'L' },
  { name: '한화생명', kind: 'L' },
  { name: '신한라이프', kind: 'L' },
  { name: '흥국생명', kind: 'L' },
  { name: '동양생명', kind: 'L' },
  { name: '라이나생명', kind: 'L' },
  { name: '농협생명', kind: 'L' },
  { name: 'ABL생명', kind: 'L' },
  { name: 'DB생명', kind: 'L' },
  { name: 'iM라이프', kind: 'L' },
  { name: '하나생명', kind: 'L' },
  { name: '메트라이프', kind: 'L' },
  { name: '미래에셋생명', kind: 'L' }
]

const INSURER_KIND = new Map(EXCEPTION_INSURERS.map((i) => [i.name, i.kind]))

/** 목록에 없는 보험사명은 이름으로 손보/생보를 추정한다 (자유 입력 허용). */
export function insurerKindOf(name: string): InsurerKind | undefined {
  const known = INSURER_KIND.get(name)
  if (known) return known
  if (/손보|화재|손해/.test(name)) return 'N'
  if (/생명|라이프/.test(name)) return 'L'
  return undefined
}

/** 관리자 입력 폼의 가능상품구분 제안 목록 (자유 입력도 허용). */
export const PRODUCT_CLASS_SUGGESTIONS: string[] = [
  '325',
  '335',
  '355',
  '345',
  '3N5',
  '간편 공통',
  '건강보험',
  '유병자실손'
]

export interface ExceptionRule {
  id: string
  insurer: string
  disease: string
  searchTerms: string[]
  minElapsed?: string
  treatmentPeriod?: string
  surgery?: string
  productClass: string
  note?: string
  verified: boolean
  updatedAt: string
}

export interface ExceptionRuleInput {
  insurer: string
  disease: string
  searchTerms: string[]
  minElapsed?: string
  treatmentPeriod?: string
  surgery?: string
  productClass: string
  note?: string
}

export type AdapterReason = 'not-configured' | 'no-session' | 'error'
export type AdapterResult<T> = { ok: true; data: T } | { ok: false; reason: AdapterReason; message: string }

function err<T = never>(reason: AdapterReason, message: string): AdapterResult<T> {
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

const COLS = 'id, insurer, disease, search_terms, min_elapsed, treatment_period, surgery, product_class, note, verified, updated_at'

function mapRule(r: Record<string, any>): ExceptionRule {
  return {
    id: String(r.id),
    insurer: String(r.insurer ?? ''),
    disease: String(r.disease ?? ''),
    searchTerms: Array.isArray(r.search_terms) ? (r.search_terms as string[]) : [],
    minElapsed: (r.min_elapsed as string | null) ?? undefined,
    treatmentPeriod: (r.treatment_period as string | null) ?? undefined,
    surgery: (r.surgery as string | null) ?? undefined,
    productClass: String(r.product_class ?? ''),
    note: (r.note as string | null) ?? undefined,
    verified: Boolean(r.verified),
    updatedAt: String(r.updated_at ?? '')
  }
}

/** 전체 기준 행 로드 (보험사·질환 순). */
export async function listExceptions(): Promise<AdapterResult<ExceptionRule[]>> {
  const client = await getClient()
  if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
  if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
  try {
    const { data, error } = await client
      .from('underwriting_exceptions')
      .select(COLS)
      .order('insurer', { ascending: true })
      .order('disease', { ascending: true })
    if (error) return err('error', '예외질환 기준을 불러오지 못했습니다.')
    return { ok: true, data: ((data as any[]) ?? []).map(mapRule) }
  } catch {
    return err('error', '예외질환 기준을 불러오지 못했습니다.')
  }
}

function toRow(input: ExceptionRuleInput, uid: string): Record<string, any> {
  return {
    insurer: input.insurer.trim(),
    disease: input.disease.trim(),
    search_terms: input.searchTerms.map((s) => s.trim()).filter(Boolean),
    min_elapsed: input.minElapsed?.trim() || null,
    treatment_period: input.treatmentPeriod?.trim() || null,
    surgery: input.surgery?.trim() || null,
    product_class: input.productClass.trim(),
    note: input.note?.trim() || null,
    verified: true, // 관리자 입력/저장 = 검수 완료
    updated_by: uid,
    updated_at: new Date().toISOString()
  }
}

function validateInput(input: ExceptionRuleInput): string | null {
  if (!input.insurer.trim()) return '보험사를 선택해주세요.'
  if (!input.disease.trim()) return '예외질환명을 입력해주세요.'
  if (!input.productClass.trim()) return '가능상품구분을 입력해주세요.'
  return null
}

/** 관리자: 기준 행 추가 (RLS: owner/admin). */
export async function addException(input: ExceptionRuleInput): Promise<AdapterResult<void>> {
  const client = await getClient()
  if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
  const uid = await currentUserId(client)
  if (!uid) return err('no-session', '로그인 세션이 없습니다.')
  const invalid = validateInput(input)
  if (invalid) return err('error', invalid)
  try {
    const { error } = await client.from('underwriting_exceptions').insert(toRow(input, uid))
    if (error) return err('error', '기준 추가에 실패했습니다 (관리자 권한 필요).')
    return { ok: true, data: undefined }
  } catch {
    return err('error', '기준 추가에 실패했습니다.')
  }
}

/** 관리자: 기준 행 수정 — 저장 시 verified=true (검수 완료). */
export async function updateException(id: string, input: ExceptionRuleInput): Promise<AdapterResult<void>> {
  const client = await getClient()
  if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
  const uid = await currentUserId(client)
  if (!uid) return err('no-session', '로그인 세션이 없습니다.')
  const invalid = validateInput(input)
  if (invalid) return err('error', invalid)
  try {
    const { error } = await client.from('underwriting_exceptions').update(toRow(input, uid)).eq('id', id)
    if (error) return err('error', '기준 수정에 실패했습니다 (관리자 권한 필요).')
    return { ok: true, data: undefined }
  } catch {
    return err('error', '기준 수정에 실패했습니다.')
  }
}

/** 관리자: 기준 행 삭제. */
export async function deleteException(id: string): Promise<AdapterResult<void>> {
  const client = await getClient()
  if (!client) return err('not-configured', 'Supabase 설정이 없습니다.')
  if (!(await currentUserId(client))) return err('no-session', '로그인 세션이 없습니다.')
  try {
    const { error } = await client.from('underwriting_exceptions').delete().eq('id', id)
    if (error) return err('error', '기준 삭제에 실패했습니다 (관리자 권한 필요).')
    return { ok: true, data: undefined }
  } catch {
    return err('error', '기준 삭제에 실패했습니다.')
  }
}

// --- 검색 (클라이언트 필터) ----------------------------------------------------

export const MAX_SEARCH_TERMS = 4

/** '충수염&복막염' → ['충수염','복막염'] (공백 정리, 최대 4개). */
export function parseSearchTerms(query: string): string[] {
  return query
    .split('&')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TERMS)
}

function normalize(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

/** 질환명 또는 검색 별칭에 검색어가 부분 일치하는지. */
export function ruleMatchesTerm(rule: ExceptionRule, term: string): boolean {
  const t = normalize(term)
  if (!t) return false
  if (normalize(rule.disease).includes(t)) return true
  return rule.searchTerms.some((a) => normalize(a).includes(t))
}

export interface ExceptionFilter {
  terms: string[]
  /** 'all' | 'N'(손보 전체) | 'L'(생보 전체) | 보험사명 */
  insurer: string
  /** 'all' | 가능상품구분 값 */
  productClass: string
}

/** 검색어(OR)·보험사·상품구분 필터 적용. 검색어가 없으면 전체. */
export function filterRules(rules: ExceptionRule[], f: ExceptionFilter): ExceptionRule[] {
  return rules.filter((r) => {
    if (f.insurer === 'N' || f.insurer === 'L') {
      if (insurerKindOf(r.insurer) !== f.insurer) return false
    } else if (f.insurer !== 'all' && r.insurer !== f.insurer) {
      return false
    }
    if (f.productClass !== 'all' && r.productClass !== f.productClass) return false
    if (f.terms.length === 0) return true
    return f.terms.some((t) => ruleMatchesTerm(r, t))
  })
}

/**
 * 여러 질환을 동시에 보유한 고객용: 검색어 전부에 대해 기준 행이 있는 보험사
 * 목록 (필터 적용 후 기준). 이 보험사들만 모든 질환을 예외 인정한다.
 */
export function insurersCoveringAllTerms(filtered: ExceptionRule[], terms: string[]): string[] {
  if (terms.length < 2) return []
  const byInsurer = new Map<string, Set<number>>()
  for (const r of filtered) {
    terms.forEach((t, i) => {
      if (!ruleMatchesTerm(r, t)) return
      let set = byInsurer.get(r.insurer)
      if (!set) {
        set = new Set()
        byInsurer.set(r.insurer, set)
      }
      set.add(i)
    })
  }
  return [...byInsurer.entries()].filter(([, set]) => set.size === terms.length).map(([name]) => name)
}

/** 데이터에 존재하는 가능상품구분 목록 (필터 select 구성용). */
export function distinctProductClasses(rules: ExceptionRule[]): string[] {
  return [...new Set(rules.map((r) => r.productClass).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'))
}
