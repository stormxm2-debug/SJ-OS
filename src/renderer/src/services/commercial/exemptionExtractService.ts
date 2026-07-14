import { postJson, prepareFiles, fileSizeIssue } from '@renderer/services/insurance-claim/claimExpertService'
import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * 면책기간 증권 자동 판독 (면책 알람 3단계 — 증권 AI 판독).
 *
 * 직원이 증권 파일(PDF/사진)을 올리면 claim-expert 엣지 함수(exemption-extract
 * 모드)가 보험사·상품명·보장개시일·담보별 면책기간을 판독한다. 결과는 화면에서
 * 1클릭 확인 후 policy_exemptions에 source='ai'로 일괄 등록되고, 이후 매일
 * cron(sj-exemption-alerts)이 D-7/도래 알림을 담당 FC에게 자동 발송한다.
 * 타이핑 입력 없이 업로드→확인→등록으로 끝나는 것이 목적.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ExtractedExemptionItem {
  coverage: string
  waitingDays: number
  /** 근거 — 증권 문구 원문 또는 표준 기준 설명. */
  waitingRule: string
  /** policy=증권에 명시, standard=표준 기준 추정 (화면에서 뱃지로 구분). */
  basis: 'policy' | 'standard'
}

export interface ExemptionExtraction {
  insurer: string
  productName: string | null
  policyNo: string | null
  /** 보장개시일 YYYY-MM-DD — 못 읽으면 null (화면에서 날짜만 지정). */
  startDate: string | null
  items: ExtractedExemptionItem[]
  notes: string
}

/** 증권 파일들 → AI 판독 결과. 실패해도 throw 하지 않는다. */
export async function extractExemptionsFromPolicy(
  files: File[],
  onProgress?: (msg: string) => void
): Promise<{ ok: boolean; extraction?: ExemptionExtraction; error?: string }> {
  const list = files.filter(Boolean)
  if (list.length === 0) return { ok: false, error: '증권 파일을 올려주세요.' }
  for (const f of list) {
    const issue = fileSizeIssue(f)
    if (issue) return { ok: false, error: issue }
  }
  onProgress?.('증권 압축·준비 중…')
  let prepared: Awaited<ReturnType<typeof prepareFiles>>
  try {
    prepared = await prepareFiles(list)
  } catch {
    return { ok: false, error: '파일 준비 중 오류가 발생했습니다. 다시 시도해 주세요.' }
  }
  if (!prepared.ok) return { ok: false, error: prepared.error }
  onProgress?.('AI가 증권에서 보장개시일·면책기간을 판독 중… (30초~1분)')
  const res = await postJson({ mode: 'exemption-extract', files: prepared.docs }, 170000)
  if (!res.ok) return { ok: false, error: res.error ?? '증권 판독에 실패했습니다.' }
  const raw = (res.data?.extraction ?? null) as Record<string, any> | null
  if (!raw || !Array.isArray(raw.items)) return { ok: false, error: '증권 판독 결과가 비어 있습니다.' }
  const extraction: ExemptionExtraction = {
    insurer: String(raw.insurer ?? '').trim() || '보험사 미상',
    productName: raw.productName ? String(raw.productName) : null,
    policyNo: raw.policyNo ? String(raw.policyNo) : null,
    startDate: normalizeDate(raw.startDate),
    items: (raw.items as Record<string, any>[])
      .map((it) => ({
        coverage: String(it.coverage ?? '').trim(),
        waitingDays: Math.max(0, Math.min(3650, Math.round(Number(it.waitingDays) || 0))),
        waitingRule: String(it.waitingRule ?? ''),
        basis: it.basis === 'policy' ? ('policy' as const) : ('standard' as const)
      }))
      .filter((it) => it.coverage && it.waitingDays > 0),
    notes: String(raw.notes ?? '')
  }
  if (extraction.items.length === 0) {
    return { ok: false, error: '이 증권에서 면책기간이 있는 담보를 찾지 못했습니다. (상해 위주 상품은 면책이 없을 수 있습니다)' }
  }
  return { ok: true, extraction }
}

/** YYYY-MM-DD 형태로 정규화. 파싱 불가면 null. */
function normalizeDate(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const m = s.match(/(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 판독 결과를 policy_exemptions에 일괄 등록 (source='ai').
 * 담당 FC = 등록하는 본인. 등록되면 기존 cron이 D-7/도래 알림을 자동 발송.
 */
export async function registerExtractedExemptions(args: {
  customerId: string
  startDate: string
  extraction: ExemptionExtraction
  /** 화면에서 체크 해제된 항목을 뺀 최종 선택. */
  selected: ExtractedExemptionItem[]
}): Promise<{ ok: boolean; count?: number; error?: string }> {
  if (!args.customerId) return { ok: false, error: '고객을 선택해주세요.' }
  if (!args.startDate) return { ok: false, error: '보장개시일을 확인해주세요.' }
  if (args.selected.length === 0) return { ok: false, error: '등록할 담보를 1개 이상 선택해주세요.' }
  await initSupabaseClient()
  const client = getSupabaseClient() as any
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  let me: string | null = null
  try {
    const { data } = await client.auth.getSession()
    me = data?.session?.user?.id ?? null
  } catch {
    me = null
  }
  if (!me) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  const rows = args.selected.map((it) => ({
    customer_id: args.customerId,
    staff_id: me,
    insurer: args.extraction.insurer,
    product_name: args.extraction.productName,
    coverage: it.coverage,
    start_date: args.startDate,
    waiting_days: it.waitingDays,
    memo: [it.basis === 'policy' ? '증권 기재' : '표준 기준', it.waitingRule].filter(Boolean).join(' — ').slice(0, 300) || null,
    source: 'ai'
  }))
  const { error } = await client.from('policy_exemptions').insert(rows)
  if (error) return { ok: false, error: error.message ?? '등록에 실패했습니다.' }
  return { ok: true, count: rows.length }
}
