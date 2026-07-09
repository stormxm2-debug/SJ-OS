import { getSupabaseClient, initSupabaseClient } from '../commercial/supabaseClient'
import { INSURERS } from '../commercial/registrationService'

/**
 * 예외질병 인수 가이드 서비스.
 * 질병 × 보험사 인수 기준(underwriting_diseases / underwriting_rules)을 읽고,
 * 관리자는 질병 추가·삭제와 회사별 기준 수정을 할 수 있다 (RLS: 전 직원 읽기,
 * owner/admin만 쓰기). 관리자가 저장한 기준은 verified=true(검수 완료)로 표시된다.
 */

/** 분류표 열 — 고객등록과 같은 12개사 (기타 제외). */
export const UNDERWRITING_INSURERS: string[] = INSURERS.filter((i) => i !== '기타')

export type UnderwritingStatus = 'standard' | 'simplified' | 'exclusion' | 'loading' | 'decline' | 'unknown'

export const UNDERWRITING_STATUS_ORDER: UnderwritingStatus[] = [
  'standard',
  'simplified',
  'exclusion',
  'loading',
  'decline',
  'unknown'
]

export const UNDERWRITING_STATUS_LABEL: Record<UnderwritingStatus, string> = {
  standard: '표준인수',
  simplified: '유병자플랜',
  exclusion: '부담보',
  loading: '할증',
  decline: '거절',
  unknown: '미입력'
}

/** 매트릭스 표 셀용 축약 라벨. */
export const UNDERWRITING_STATUS_SHORT: Record<UnderwritingStatus, string> = {
  standard: '표준',
  simplified: '유병',
  exclusion: '부담',
  loading: '할증',
  decline: '거절',
  unknown: '－'
}

/**
 * 설계사 관점의 제한 강도 (낮을수록 유리). 할증(보험료↑) < 부담보(보장 제외) <
 * 유병자플랜(상품 자체 변경) < 거절 순으로 제한적이라고 본다. unknown은 집계 제외.
 */
export const UNDERWRITING_SEVERITY: Record<UnderwritingStatus, number> = {
  standard: 0,
  loading: 1,
  exclusion: 2,
  simplified: 3,
  decline: 4,
  unknown: -1
}

export interface UnderwritingRule {
  id: string
  insurer: string
  status: UnderwritingStatus
  note?: string
  verified: boolean
}

export interface UnderwritingDisease {
  id: string
  name: string
  category: string
  aliases: string[]
  sortOrder: number
  /** insurer명 → 기준. 없는 회사는 미입력으로 취급. */
  rules: Record<string, UnderwritingRule>
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

const STATUSES: UnderwritingStatus[] = ['standard', 'simplified', 'exclusion', 'loading', 'decline', 'unknown']

function mapDisease(r: Record<string, any>): UnderwritingDisease {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    category: String(r.category ?? '기타'),
    aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [],
    sortOrder: Number(r.sort_order ?? 0),
    rules: {}
  }
}

function mapRule(r: Record<string, any>): UnderwritingRule & { diseaseId: string } {
  const raw = String(r.status ?? 'unknown') as UnderwritingStatus
  return {
    diseaseId: String(r.disease_id ?? ''),
    id: String(r.id),
    insurer: String(r.insurer ?? ''),
    status: STATUSES.includes(raw) ? raw : 'unknown',
    note: (r.note as string | null) ?? undefined,
    verified: Boolean(r.verified)
  }
}

// 고객 병력 매칭 등 화면 밖 소비자를 위한 짧은 캐시 (고객 카드를 열 때마다
// 전체 표를 다시 받지 않도록). 관리자 편집 후에는 listUnderwriting이 갱신한다.
let cache: { at: number; items: UnderwritingDisease[] } | null = null
const CACHE_TTL_MS = 5 * 60_000

/** 캐시 우선 로드 — 병력 매칭처럼 최신성이 덜 중요한 곳에서 사용. */
export async function listUnderwritingCached(): Promise<{ ok: boolean; items: UnderwritingDisease[]; error?: string }> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return { ok: true, items: cache.items }
  return listUnderwriting()
}

/** 전체 분류표 로드 (질병 + 회사별 기준). 데이터가 작아 한 번에 가져온다. */
export async function listUnderwriting(): Promise<{ ok: boolean; items: UnderwritingDisease[]; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, items: [], error: '서버 연결 후 사용할 수 있습니다.' }
  if (!(await uid(client))) return { ok: false, items: [], error: '로그인 후 사용할 수 있습니다.' }
  try {
    const [dRes, rRes] = await Promise.all([
      client.from('underwriting_diseases').select('id, name, category, aliases, sort_order').order('sort_order').order('name'),
      client.from('underwriting_rules').select('id, disease_id, insurer, status, note, verified').limit(2000)
    ])
    if (dRes.error || rRes.error) return { ok: false, items: [], error: '인수 기준을 불러오지 못했습니다.' }
    const byId = new Map<string, UnderwritingDisease>()
    const items = ((dRes.data as any[]) ?? []).map(mapDisease)
    items.forEach((d) => byId.set(d.id, d))
    for (const raw of (rRes.data as any[]) ?? []) {
      const rule = mapRule(raw)
      const disease = byId.get(rule.diseaseId)
      if (disease && rule.insurer) disease.rules[rule.insurer] = rule
    }
    cache = { at: Date.now(), items }
    return { ok: true, items }
  } catch {
    return { ok: false, items: [], error: '인수 기준을 불러오지 못했습니다.' }
  }
}

// ---------- 고객 병력 텍스트 ↔ 질병 매칭 ----------

/** 이름 토큰 중 매칭 키워드로 쓰기엔 너무 흔한 단어. */
const MATCH_STOPWORDS = new Set(['이력', '제거', '완치', '경과', '보유', '질환'])

function keywordsOf(d: UnderwritingDisease): string[] {
  const tokens = d.name
    .split(/[·()\/\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !/\d/.test(t) && !MATCH_STOPWORDS.has(t))
  const aliases = d.aliases.map((a) => a.trim()).filter((a) => a.length >= 1 && !MATCH_STOPWORDS.has(a))
  return Array.from(new Set([d.name, ...tokens, ...aliases]))
}

/** 병력 자유 텍스트에서 등록된 질병(이름/토큰/별칭 포함)을 찾아낸다. */
export function matchDiseasesToHistory(history: string, items: UnderwritingDisease[]): UnderwritingDisease[] {
  const h = history.trim().toLowerCase()
  if (!h) return []
  return items.filter((d) => keywordsOf(d).some((kw) => h.includes(kw.toLowerCase())))
}

/**
 * 매칭된 질병들에 대해 회사별 "가장 제한적인" 기준을 요약한다.
 * (여러 병력이 있으면 인수는 가장 나쁜 기준에 묶이므로 worst를 보여준다)
 */
export function worstStatusByInsurer(
  matched: UnderwritingDisease[]
): Record<string, { status: UnderwritingStatus; disease?: string }> {
  const out: Record<string, { status: UnderwritingStatus; disease?: string }> = {}
  for (const insurer of UNDERWRITING_INSURERS) {
    let worst: UnderwritingStatus = 'unknown'
    let from: string | undefined
    for (const d of matched) {
      const s = d.rules[insurer]?.status ?? 'unknown'
      if (s === 'unknown') continue
      if (worst === 'unknown' || UNDERWRITING_SEVERITY[s] > UNDERWRITING_SEVERITY[worst]) {
        worst = s
        from = d.name
      }
    }
    out[insurer] = { status: worst, disease: from }
  }
  return out
}

/** 질병 추가 (관리자). */
export async function addDisease(input: {
  name: string
  category: string
  aliases: string[]
}): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const name = input.name.trim()
  if (!name) return { ok: false, error: '질병명을 입력해주세요.' }
  try {
    const { error } = await client.from('underwriting_diseases').insert({
      name,
      category: input.category.trim() || '기타',
      aliases: input.aliases.map((a) => a.trim()).filter(Boolean),
      sort_order: 9999
    })
    if (error) {
      const dup = String((error as { code?: string }).code ?? '') === '23505'
      return { ok: false, error: dup ? '이미 등록된 질병입니다.' : '질병 추가에 실패했습니다.' }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: '질병 추가에 실패했습니다.' }
  }
}

/** 질병 삭제 (관리자) — 회사별 기준도 함께 삭제된다(cascade). */
export async function deleteDisease(id: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  try {
    const { error } = await client.from('underwriting_diseases').delete().eq('id', id)
    if (error) return { ok: false, error: '질병 삭제에 실패했습니다.' }
    return { ok: true }
  } catch {
    return { ok: false, error: '질병 삭제에 실패했습니다.' }
  }
}

/** 회사별 기준 저장 (관리자). 저장 = 관리자가 확인한 값이므로 verified=true. */
export async function upsertRule(input: {
  diseaseId: string
  insurer: string
  status: UnderwritingStatus
  note?: string
}): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const me = await uid(client)
  if (!me) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  try {
    const { error } = await client.from('underwriting_rules').upsert(
      {
        disease_id: input.diseaseId,
        insurer: input.insurer,
        status: input.status,
        note: input.note?.trim() || null,
        verified: true,
        updated_by: me,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'disease_id,insurer' }
    )
    if (error) return { ok: false, error: '기준 저장에 실패했습니다.' }
    return { ok: true }
  } catch {
    return { ok: false, error: '기준 저장에 실패했습니다.' }
  }
}
