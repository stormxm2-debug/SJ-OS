/**
 * SJ CLAIM FINDER — 결정론적 보험금 발굴 규칙 엔진 (v0.2 — 보수성 강화)
 *
 * ★ 설계 원칙 (사용자 요구사항 고정)
 *  - AI는 추출·후보 "검색"에만. **지급조건·금액은 이 결정론 규칙 + 검증된 약관/증빙으로만.**
 *  - KB 가입금액은 **지급액이 아니다.** 지급액은 "검증된 약관 지급규칙"이 있을 때만 산정.
 *  - 약관/증빙/조건 검증이 없으면 금액 **null(미산정)** — 0원으로 표시하지 않는다.
 *  - **약관 ID 하나만으로 조건 검증 완료가 아니다.** 담보별 질병/수술 지급조건이 이 진료에 대해
 *    별도로 검증(conditionVerified)돼야 CONFIRMED. 아니면 금액 null + NEED_DOCUMENTS.
 *  - **입원일당은 입원 증빙(inpatientVerified)+검증 입원일수**가 있어야 확정. 외래 다일 방문으로 확정 금지.
 *  - **진단비**는 diagnosisName 존재만으로 인정하지 않는다(조건 검증 필요).
 *  - 보장 개시·종료·면책·감액 조건이 미확인이면 정상조건으로 간주하지 않는다(NEED_DOCUMENTS).
 *  - 날짜는 달력상 유효한 YYYYMMDD만, 금액·일수·감액률은 유한·비음수(비율 0~1)만 신뢰.
 *  - ALREADY_PAID는 **검증된 '지급' 상태 + 동일 사건(treatmentEventId) 매칭**일 때만. 같은 날짜만으로 금지.
 *  - 청구 이력 미확인은 미청구로 단정하지 않는다. 같은 날짜·기관만으로 별개 진료 병합 금지.
 *  - CI 주계약/선지급 등 중복 담보는 합산 방지(dedupeGroup).
 *
 * ★ 상태: CONFIRMED_CONDITIONS / POTENTIAL / NEED_DOCUMENTS / EXCLUDED / ALREADY_PAID
 *   (CONFIRMED_CONDITIONS 는 "조건 확인"이며 보험사 지급확정이 아님)
 */

export const CLAIM_RULES_VERSION = '0.2.0-demo'

export type ClaimStatus = 'CONFIRMED_CONDITIONS' | 'POTENTIAL' | 'NEED_DOCUMENTS' | 'EXCLUDED' | 'ALREADY_PAID'

export type CoverageCategory = 'surgery' | 'diagnosis' | 'hospitalization_daily' | 'actual_loss' | 'other' | 'unknown'

export interface SourceRef {
  kind: 'health_record_json' | 'coverage_pdf' | 'policy_terms' | 'claim_history' | 'manual'
  fileHash?: string
  page?: number
  jsonPath?: string
  clauseId?: string
  clauseVersion?: string
  note?: string
}

export interface TreatmentEvent {
  id: string
  date: string // 진료개시일 YYYYMMDD
  institution?: string
  treatType?: string // 진료형태(처방조제/외래/입원 등) — 거친 구분, 진단명/수술명 아님
  visitDays?: number // 방문일수(거친 신호)
  /** 입원 증빙이 별도 확인됐는지(입·퇴원 확인서 등). 기본 false. */
  inpatientVerified?: boolean
  /** 검증된 입원일수(입원일당 산정에 사용). visitDays 와 구분. */
  admissionDays?: number | null
  prescribeDays?: number
  prescribeCnt?: number
  deductibleAmt?: number
  publicCharge?: number
  diagnosisName?: string | null // 진단명(없으면 미확인) — 존재만으로 인정하지 않음
  procedureName?: string | null // 처치/수술명 — 이름만으로 수술 인정 금지
  surgeryVerified?: boolean // 수술 근거 검증(증빙) 여부. 기본 false.
  source: SourceRef
  raw?: Record<string, unknown>
}

export interface ReductionRule {
  withinDays: number
  ratio: number // 0~1
  note?: string
}

export interface Coverage {
  id: string
  contractId: string
  name: string
  category: CoverageCategory
  subscribedAmount?: number | null // ※ 가입금액(지급액 아님)
  clauseId?: string | null
  clauseVersion?: string | null
  startDate?: string | null // 보장 개시일
  endDate?: string | null // 보장 종료일
  waitingDays?: number | null // 면책기간(일)
  reductionRules?: ReductionRule[] | null
  limitAmount?: number | null
  limitCount?: number | null
  limitDays?: number | null
  perDayAmount?: number | null // 입원일당 일당 지급액(약관 검증값)
  verifiedPayoutAmount?: number | null // 약관 검증 정액 지급액
  renewalType?: string | null
  dedupeGroup?: string | null
  source: SourceRef
}

export interface Contract {
  id: string
  insurer: string
  productName?: string
  contractDate?: string | null
  coverages: Coverage[]
  source: SourceRef
}

export type ClaimOutcome = 'paid' | 'rejected' | 'received' | 'unknown'

export interface ClaimHistoryEntry {
  id: string
  coverageId?: string
  treatmentEventId?: string
  date?: string
  paidAmount?: number | null
  status?: string // 자유 텍스트(지급/부지급/접수 등)
  outcome?: ClaimOutcome // 명시되면 우선
  verified: boolean
  source: SourceRef
}

/** (진료,담보) 단위의 "지급조건 검증" — 사람 검토/증빙 대조 결과. 이게 있어야 CONFIRMED 가능. */
export interface Verification {
  treatmentEventId: string
  coverageId: string
  conditionVerified?: boolean // 담보 지급조건이 이 진료에 부합함이 검증됨
  note?: string
}

export interface MissingDoc {
  code: string
  label: string
  reason: string
}

export interface ClaimCandidate {
  id: string
  status: ClaimStatus
  coverageId: string
  coverageName: string
  category: CoverageCategory
  contractId: string
  insurer: string
  treatmentEventIds: string[]
  estimatedAmount: number | null
  amountBasis: string | null
  dedupeGroupId: string | null
  conditionVerified: boolean
  eligibilityVerified: boolean
  reasons: string[]
  missingDocs: MissingDoc[]
  rulesVersion: string
  sources: SourceRef[]
  isDemo: boolean
}

export interface AnalyzeInput {
  treatments: TreatmentEvent[]
  contracts: Contract[]
  claimHistory?: ClaimHistoryEntry[]
  verifications?: Verification[]
  asOf?: string
  demo?: boolean
}

export interface AnalyzeResult {
  candidates: ClaimCandidate[]
  rulesVersion: string
  warnings: string[]
  generatedAt: string
}

const DOC = {
  TERMS: { code: 'POLICY_TERMS', label: '약관(해당 조항/버전)', reason: '지급조건·금액을 검증할 약관이 연결되지 않았습니다.' },
  CONDITION: { code: 'CONDITION_MATCH', label: '지급조건 대조(진단서/수술확인서↔약관)', reason: '담보 지급조건이 이 진료에 부합하는지 검증되지 않았습니다(약관 ID만으로 불충분).' },
  DIAGNOSIS: { code: 'DIAGNOSIS_PROOF', label: '진단명/진단서', reason: '진단명이 확인되지 않았습니다.' },
  SURGERY: { code: 'SURGERY_PROOF', label: '수술 확인서/수술명 증빙', reason: '검증된 수술 근거가 없습니다(의료행위 이름만으로 인정 불가).' },
  HOSPITAL: { code: 'HOSPITAL_PROOF', label: '입·퇴원 확인서(입원일수)', reason: '입원 증빙·검증 입원일수가 없습니다(외래 다일 방문은 입원 아님).' },
  RECEIPT: { code: 'RECEIPT', label: '진료비 영수증/세부내역', reason: '실손 자기부담/급여·비급여 계산 증빙이 부족합니다.' },
  START: { code: 'COV_START', label: '보장 개시일 확인', reason: '보장 개시일이 확인되지 않아 보장 범위를 판단할 수 없습니다.' },
  END: { code: 'COV_END', label: '보장 종료일 확인', reason: '보장 종료일이 확인되지 않아 보장 종료 여부를 판단할 수 없습니다.' },
  WAIT: { code: 'COV_WAIT', label: '면책기간 확인', reason: '면책기간이 확인되지 않았습니다(미확인을 정상조건으로 간주하지 않음).' },
  PAYOUT: { code: 'PAYOUT_RULE', label: '약관 지급액 산정 근거', reason: '해당 담보의 지급액 산정 규칙이 약관에서 확인되지 않았습니다.' },
  CLAIM_HISTORY: { code: 'CLAIM_HISTORY', label: '청구/지급 이력(보험사 확인)', reason: '청구 이력이 확인되지 않았습니다(미청구로 단정 불가).' }
} as const

// ── 안전 파서(유효성 검증) ───────────────────────────────────────────────
/** 달력상 유효한 YYYYMMDD 만 통과(불가능한 날짜 거부). */
export function isValidYmd(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{8}$/.test(s)) return false
  const y = +s.slice(0, 4)
  const m = +s.slice(4, 6)
  const d = +s.slice(6, 8)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
/** 유한·비음수만. 아니면 null(미확인/오류). */
const nn = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
/** 0~1 비율만. */
const ratio01 = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null)
const todayYmd = (): string => new Date().toISOString().slice(0, 10).replace(/-/g, '')
const addDaysYmd = (ymd: string, days: number): string => {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

const dedupeDocs = (docs: MissingDoc[]): MissingDoc[] => {
  const seen = new Set<string>()
  return docs.filter((d) => (seen.has(d.code) ? false : (seen.add(d.code), true)))
}

const outcomeOf = (h: ClaimHistoryEntry): ClaimOutcome => {
  if (h.outcome) return h.outcome
  const s = h.status ?? ''
  if (/부지급|거절|미지급|반려|deny|reject/i.test(s)) return 'rejected'
  if (/접수|received|진행/i.test(s)) return 'received'
  if (/지급|완료|paid/i.test(s)) return 'paid'
  return 'unknown'
}

/** 입원 "관련성"(후보로 올릴지)만 — 확정과 별개. 외래 다일방문으로 입원 확정하지 않는다. */
const inpatientRelevant = (t: TreatmentEvent): boolean => /입원/.test(t.treatType ?? '') || t.inpatientVerified === true

const isRelevant = (cov: Coverage, t: TreatmentEvent): boolean => {
  switch (cov.category) {
    case 'hospitalization_daily':
      return inpatientRelevant(t)
    case 'actual_loss':
      return nn(t.deductibleAmt) != null || nn(t.publicCharge) != null
    case 'surgery':
      return Boolean(t.procedureName) || t.surgeryVerified === true
    case 'diagnosis':
      return Boolean(t.diagnosisName)
    default:
      return false
  }
}

interface Elig {
  outcome: 'excluded' | 'verified' | 'unverified'
  reasons: string[]
  missing: MissingDoc[]
}
/** 보장 개시/종료/면책 검증. 미확인을 정상으로 간주하지 않음. */
function eligibility(cov: Coverage, t: TreatmentEvent): Elig {
  const reasons: string[] = []
  const missing: MissingDoc[] = []
  const start = isValidYmd(cov.startDate) ? (cov.startDate as string) : null
  const end = isValidYmd(cov.endDate) ? (cov.endDate as string) : null
  const waiting = nn(cov.waitingDays)

  if (start && t.date < start) return { outcome: 'excluded', reasons: [`진료일 ${t.date} < 보장개시 ${start} — 보장 대상 아님.`], missing: [] }
  if (end && t.date > end) return { outcome: 'excluded', reasons: [`진료일 ${t.date} > 보장종료 ${end} — 보장 종료 후.`], missing: [] }
  if (start && waiting != null && waiting > 0) {
    const we = addDaysYmd(start, waiting)
    if (t.date < we) return { outcome: 'excluded', reasons: [`면책기간 이내(개시 ${start}+${waiting}일, ~${we}) — 면책.`], missing: [] }
  }

  let verified = true
  if (!start) {
    verified = false
    missing.push(DOC.START)
    reasons.push('보장 개시일 미확인.')
  }
  if (cov.waitingDays == null) {
    verified = false
    missing.push(DOC.WAIT)
    reasons.push('면책기간 미확인.')
  } else if (waiting == null) {
    verified = false
    missing.push(DOC.WAIT)
    reasons.push('면책기간 값 오류(음수/비정상) — 미확인 처리.')
  }
  if (!end) {
    verified = false
    missing.push(DOC.END)
    reasons.push('보장 종료일 미확인.')
  }
  return { outcome: verified ? 'verified' : 'unverified', reasons, missing }
}

function applyLimitsAndReduction(cov: Coverage, base: number, t: TreatmentEvent): number {
  let amt = base
  if (Array.isArray(cov.reductionRules) && isValidYmd(cov.startDate)) {
    for (const r of cov.reductionRules) {
      const within = nn(r?.withinDays)
      const rt = ratio01(r?.ratio)
      if (within == null || rt == null) continue // 비정상 감액 규칙은 적용하지 않음
      const until = addDaysYmd(cov.startDate as string, within)
      if (t.date < until) {
        amt = Math.round(amt * rt)
        break
      }
    }
  }
  const limit = nn(cov.limitAmount)
  if (limit != null) amt = Math.min(amt, limit)
  return amt
}

interface Judged {
  status: ClaimStatus
  reasons: string[]
  missingDocs: MissingDoc[]
  amount: number | null
  amountBasis: string | null
  conditionVerified: boolean
  eligibilityVerified: boolean
}

function judge(cov: Coverage, t: TreatmentEvent, history: ClaimHistoryEntry[], verifications: Verification[]): Judged {
  const reasons: string[] = []
  const missing: MissingDoc[] = []

  // 1) ALREADY_PAID — 검증된 '지급' + 동일 사건(treatmentEventId) 매칭만.
  const paid = history.find((h) => h.verified && h.coverageId === cov.id && outcomeOf(h) === 'paid' && h.treatmentEventId != null && h.treatmentEventId === t.id)
  if (paid) {
    return {
      status: 'ALREADY_PAID',
      reasons: [`검증된 지급 이력과 동일 사건 매칭(${paid.date ?? '-'}${paid.paidAmount != null ? `, ${paid.paidAmount.toLocaleString('ko-KR')}원` : ''}).`],
      missingDocs: [],
      amount: null,
      amountBasis: null,
      conditionVerified: true,
      eligibilityVerified: true
    }
  }
  // 같은 날짜 '지급' 이력이 있으나 사건 식별 불일치 → 자동 기지급 처리하지 않고 확인 플래그.
  const sameDayPaidAmbiguous = history.some(
    (h) => h.verified && h.coverageId === cov.id && outcomeOf(h) === 'paid' && isValidYmd(h.date) && h.date === t.date && h.treatmentEventId !== t.id
  )
  const rejectedSame = history.some((h) => h.verified && h.coverageId === cov.id && outcomeOf(h) === 'rejected' && (h.treatmentEventId === t.id || (isValidYmd(h.date) && h.date === t.date)))

  // 2) 보장 개시/종료/면책
  const el = eligibility(cov, t)
  if (el.outcome === 'excluded') {
    return { status: 'EXCLUDED', reasons: el.reasons, missingDocs: [], amount: null, amountBasis: null, conditionVerified: false, eligibilityVerified: false }
  }
  reasons.push(...el.reasons)
  missing.push(...el.missing)
  const eligibilityVerified = el.outcome === 'verified'

  // 3) 약관 연결
  const hasTerms = Boolean(cov.clauseId)
  if (!hasTerms) {
    missing.push(DOC.TERMS)
    reasons.push('약관(조항/버전) 미연결.')
  }

  // 4) 카테고리별 증빙
  let evidenceOk = true
  if (cov.category === 'surgery') {
    if (!t.surgeryVerified) {
      evidenceOk = false
      missing.push(DOC.SURGERY)
      reasons.push('수술 근거 미검증 — 처치/의료행위 이름만으로 인정 불가.')
    }
  } else if (cov.category === 'diagnosis') {
    if (!t.diagnosisName) {
      evidenceOk = false
      missing.push(DOC.DIAGNOSIS)
      reasons.push('진단명 미확인.')
    }
  } else if (cov.category === 'hospitalization_daily') {
    if (!(t.inpatientVerified === true && nn(t.admissionDays) != null && (nn(t.admissionDays) as number) >= 1)) {
      evidenceOk = false
      missing.push(DOC.HOSPITAL)
      reasons.push('입원 증빙·검증 입원일수 부족(외래 다일 방문은 입원일당 확정 불가).')
    }
  } else if (cov.category === 'actual_loss') {
    if (!(nn(t.deductibleAmt) != null || nn(t.publicCharge) != null)) {
      evidenceOk = false
      missing.push(DOC.RECEIPT)
      reasons.push('실손 계산 근거(본인부담/영수증) 부족.')
    }
  }

  // 5) 담보 지급조건 검증(약관 ID만으로 불충분) — (진료,담보) 단위 검증 필요.
  const conditionVerified = verifications.some((v) => v.treatmentEventId === t.id && v.coverageId === cov.id && v.conditionVerified === true)
  if (!conditionVerified) {
    missing.push(DOC.CONDITION)
    reasons.push('담보 지급조건↔진료 대조 미검증 — 약관 ID만으로는 조건 확인 아님.')
  }

  // 6) 금액 — 조건 전부 검증됐을 때만, 검증된 지급규칙으로. 아니면 null(미산정).
  const fullyVerified = hasTerms && evidenceOk && conditionVerified && eligibilityVerified
  let amount: number | null = null
  let amountBasis: string | null = null
  if (fullyVerified) {
    if (cov.category === 'hospitalization_daily') {
      const per = nn(cov.perDayAmount)
      const days = nn(t.admissionDays)
      if (per != null && days != null) {
        const cap = nn(cov.limitDays)
        const d = cap != null ? Math.min(Math.floor(days), cap) : Math.floor(days)
        amount = applyLimitsAndReduction(cov, d * per, t)
        amountBasis = `입원일당 ${per.toLocaleString('ko-KR')}원 × ${d}일${cap != null ? `(일수한도 ${cap}일)` : ''} [약관 ${cov.clauseId}@${cov.clauseVersion ?? '?'}]`
      }
    } else if (cov.category === 'diagnosis' || cov.category === 'surgery') {
      const payout = nn(cov.verifiedPayoutAmount)
      if (payout != null) {
        amount = applyLimitsAndReduction(cov, payout, t)
        amountBasis = `약관 검증 정액 지급액 ${payout.toLocaleString('ko-KR')}원 [약관 ${cov.clauseId}@${cov.clauseVersion ?? '?'}]`
      }
    }
    if (amount == null) {
      missing.push(DOC.PAYOUT)
      reasons.push('지급액 산정 규칙 미확인 — 금액 미산정(null). KB 가입금액은 지급액 아님.')
    }
  }

  // 7) 청구 이력
  const anyVerifiedHistory = history.some((h) => h.verified && h.coverageId === cov.id)
  if (!anyVerifiedHistory) {
    reasons.push('청구 이력 미확인 — 미청구로 단정하지 않음(보험사 확인 필요).')
    missing.push(DOC.CLAIM_HISTORY)
  }
  if (sameDayPaidAmbiguous) reasons.push('같은 날짜 지급 이력 존재(사건 식별 불일치) — 동일 사건 여부 확인 필요(자동 기지급 처리 안 함).')
  if (rejectedSame) reasons.push('동일 담보 거절/부지급 이력 존재 — 사유 확인 필요(이의제기 대상일 수 있음).')

  // 8) 상태
  let status: ClaimStatus
  if (fullyVerified && amount != null) {
    status = 'CONFIRMED_CONDITIONS'
    reasons.unshift('지급 "조건"이 근거상 확인됨(※ 보험사 지급확정 아님).')
  } else if (fullyVerified && amount == null) {
    status = 'POTENTIAL'
    reasons.unshift('지급조건은 확인되나 지급액 산정 근거가 부족 — 금액 미산정(가능성).')
  } else {
    status = 'NEED_DOCUMENTS'
    reasons.unshift('지급조건 검증 미완(약관/증빙/개시·종료·면책/조건대조 필요) — 금액 미산정.')
  }

  return { status, reasons, missingDocs: dedupeDocs(missing), amount, amountBasis, conditionVerified, eligibilityVerified }
}

export function analyzeClaims(input: AnalyzeInput): AnalyzeResult {
  const warnings: string[] = []
  const rawTreat = Array.isArray(input.treatments) ? input.treatments : []
  const treatments = rawTreat.filter((t) => t && isValidYmd(t.date))
  if (rawTreat.length !== treatments.length) warnings.push('일부 진료 이벤트가 날짜(유효 YYYYMMDD) 누락/오류로 제외되었습니다.')
  const contracts = Array.isArray(input.contracts) ? input.contracts : []
  const history = Array.isArray(input.claimHistory) ? input.claimHistory : []
  const verifications = Array.isArray(input.verifications) ? input.verifications : []
  const demo = input.demo === true

  const candidates: ClaimCandidate[] = []
  let seq = 0
  for (const contract of contracts) {
    if (!contract || !Array.isArray(contract.coverages)) {
      warnings.push('계약 데이터 형식 오류 — 건너뜀.')
      continue
    }
    for (const cov of contract.coverages) {
      if (!cov || !cov.id) continue
      for (const t of treatments) {
        if (!isRelevant(cov, t)) continue
        const j = judge(cov, t, history, verifications)
        seq += 1
        const sources: SourceRef[] = [t.source, cov.source, contract.source].filter(Boolean) as SourceRef[]
        if (cov.clauseId) sources.push({ kind: 'policy_terms', clauseId: cov.clauseId, clauseVersion: cov.clauseVersion ?? undefined })
        candidates.push({
          id: `cand-${seq}`,
          status: j.status,
          coverageId: cov.id,
          coverageName: cov.name,
          category: cov.category,
          contractId: contract.id,
          insurer: contract.insurer,
          treatmentEventIds: [t.id],
          estimatedAmount: j.amount,
          amountBasis: j.amountBasis,
          dedupeGroupId: cov.dedupeGroup ? `${t.id}::${cov.dedupeGroup}` : null,
          conditionVerified: j.conditionVerified,
          eligibilityVerified: j.eligibilityVerified,
          reasons: j.reasons,
          missingDocs: j.missingDocs,
          rulesVersion: CLAIM_RULES_VERSION,
          sources,
          isDemo: demo
        })
      }
    }
  }
  return { candidates, rulesVersion: CLAIM_RULES_VERSION, warnings, generatedAt: new Date().toISOString() }
}

/**
 * 중복 합산 방지 합계 — CONFIRMED_CONDITIONS 중 금액 산정분만, dedupeGroupId 동일 그룹은 최대 1건.
 * ※ "검토 전 후보" 참고치이며 "받을 수 있는 보험금"이 아님.
 */
export function sumConfirmedAmounts(candidates: ClaimCandidate[]): { total: number; countedCandidateIds: string[]; uncomputedCount: number } {
  const byGroup = new Map<string, { amount: number; id: string }>()
  const singles: { amount: number; id: string }[] = []
  let uncomputed = 0
  for (const c of candidates) {
    if (c.status !== 'CONFIRMED_CONDITIONS') continue
    if (c.estimatedAmount == null) {
      uncomputed += 1
      continue
    }
    if (c.dedupeGroupId) {
      const cur = byGroup.get(c.dedupeGroupId)
      if (!cur || c.estimatedAmount > cur.amount) byGroup.set(c.dedupeGroupId, { amount: c.estimatedAmount, id: c.id })
    } else singles.push({ amount: c.estimatedAmount, id: c.id })
  }
  const picked = [...singles, ...byGroup.values()]
  return { total: picked.reduce((s, p) => s + p.amount, 0), countedCandidateIds: picked.map((p) => p.id), uncomputedCount: uncomputed }
}

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  CONFIRMED_CONDITIONS: '조건 확인(지급확정 아님)',
  POTENTIAL: '가능성(추가 확인)',
  NEED_DOCUMENTS: '서류/약관 필요',
  EXCLUDED: '대상 아님(개시전/종료/면책)',
  ALREADY_PAID: '이미 지급'
}
