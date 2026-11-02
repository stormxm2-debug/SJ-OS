/**
 * SJ CLAIM FINDER — 결정론적 보험금 발굴 규칙 엔진 (초기 통합 버전)
 *
 * ★ 설계 원칙 (사용자 요구사항 고정)
 *  - AI는 추출·후보 "검색"에만 사용. **지급조건·금액 판단은 이 결정론 규칙 + 검증된 약관/증빙으로만** 한다.
 *  - KB 가입금액(subscribedAmount)은 **실제 지급액이 아니다.** 지급액은 검증된 약관 지급규칙이 있을 때만 산정.
 *  - 약관/증빙이 부족하면 금액은 **null(미산정)** — 절대 0원으로 표시하지 않는다.
 *  - 청구 이력 "미확인"은 "미청구 확정"이 아니다 → 미청구로 단정하지 않고 '청구이력 확인 필요'로 표시.
 *  - 실제 HIRA 필드/외부 API를 추측하지 않는다. 이 엔진은 "정규화된 내부 포맷"만 받는다(어댑터가 변환).
 *  - 수술비는 의료행위/진료형태 "이름"만으로 인정하지 않는다(검증된 수술 근거 + 약관 매칭 필요).
 *  - 같은 날짜·기관이라는 이유만으로 별개 진료를 병합하지 않는다(엔진은 이벤트를 병합하지 않음).
 *  - CI 주계약/선지급 등 중복 담보는 합산 방지(dedupeGroup).
 *  - 미확인 조건은 '미확인'으로 남긴다(근거 없는 CONFIRMED 금지).
 *
 * ★ 상태(판정)
 *   CONFIRMED_CONDITIONS — 근거상 "조건"이 확인됨(≠ 보험사 지급확정).
 *   POTENTIAL           — 가능성 있으나 일부 조건/금액 미확정.
 *   NEED_DOCUMENTS      — 약관/증빙 등 부족해 판단 보류.
 *   EXCLUDED            — 보장 개시 전/면책/제외 등으로 대상 아님.
 *   ALREADY_PAID        — 검증된 지급 이력과 매칭(이미 받음).
 *
 * 모든 후보는 원본 대조용 sources(파일 해시/페이지 또는 JSON 경로, 약관 조항/버전),
 * rulesVersion, 부족자료(missingDocs), 판정 근거(reasons)를 포함한다.
 */

export const CLAIM_RULES_VERSION = '0.1.0-demo'

export type ClaimStatus =
  | 'CONFIRMED_CONDITIONS'
  | 'POTENTIAL'
  | 'NEED_DOCUMENTS'
  | 'EXCLUDED'
  | 'ALREADY_PAID'

export type CoverageCategory =
  | 'surgery' // 수술비
  | 'diagnosis' // 진단비
  | 'hospitalization_daily' // 입원일당
  | 'actual_loss' // 실손의료비
  | 'other'
  | 'unknown'

/** 원본 추적 포인터 — 각 판정이 어디서 왔는지. */
export interface SourceRef {
  kind: 'health_record_json' | 'coverage_pdf' | 'policy_terms' | 'claim_history' | 'manual'
  fileHash?: string // 업로드 원본 파일 해시
  page?: number // PDF 페이지
  jsonPath?: string // JSON 경로 (예: data[3].resTreatType)
  clauseId?: string // 약관 조항 식별자
  clauseVersion?: string // 약관 버전
  note?: string
}

/** 정규화된 진료/투약 이벤트 — 어댑터가 HIRA/CODEF 응답에서 변환(필드 추측 금지). */
export interface TreatmentEvent {
  id: string
  date: string // 진료개시일 YYYYMMDD
  institution?: string // 병의원/약국
  treatType?: string // 진료형태(처방조제/외래/입원 등) — 거친 구분이며 진단명이 아님
  visitDays?: number // 방문(입원)일수
  prescribeDays?: number // 투약일수
  prescribeCnt?: number // 처방횟수
  deductibleAmt?: number // 본인부담금
  publicCharge?: number // 공단부담금
  /** 진단명 — '진료받은 내용' 상품엔 보통 없음 → null(미확인). 추측 금지. */
  diagnosisName?: string | null
  /** 처치/수술명 — 미확인 가능. 이 값만으로 수술비 인정하지 않음. */
  procedureName?: string | null
  /** 수술 근거가 검증됐는지(약관/증빙 대조). 기본 false. */
  surgeryVerified?: boolean
  source: SourceRef
  raw?: Record<string, unknown>
}

/** 감액 규칙(예: 가입 1년 이내 50% 감액). */
export interface ReductionRule {
  withinDays: number // 보장 개시 후 N일 이내
  ratio: number // 지급 비율 (0~1), 예: 0.5
  note?: string
}

/** 담보(특약) — 약관에서 검증된 값만 채운다. 미확인이면 null/undefined. */
export interface Coverage {
  id: string
  contractId: string
  name: string // 담보명
  category: CoverageCategory
  /** KB 가입금액 — ※ 실제 지급액 아님. 산정에 직접 쓰지 않는다. */
  subscribedAmount?: number | null
  clauseId?: string | null // 약관 조항
  clauseVersion?: string | null
  startDate?: string | null // 보장 개시일 YYYYMMDD
  endDate?: string | null // 보장 종료일
  waitingDays?: number | null // 면책기간(일)
  reductionRules?: ReductionRule[] | null // 감액
  limitAmount?: number | null // 지급 한도(금액)
  limitCount?: number | null // 횟수 한도
  limitDays?: number | null // 일수 한도(입원일당 등)
  perDayAmount?: number | null // 입원일당 일당 지급액(약관 검증값)
  /** 약관에서 검증된 정액 지급액(예: 진단비 확정 지급액). 없으면 null → 금액 미산정. */
  verifiedPayoutAmount?: number | null
  renewalType?: string | null
  /** 중복 합산 방지 그룹(예: CI 주계약 + 선지급 특약은 동일 그룹). */
  dedupeGroup?: string | null
  source: SourceRef
}

export interface Contract {
  id: string
  insurer: string
  productName?: string
  contractDate?: string | null // 계약일 YYYYMMDD
  coverages: Coverage[]
  source: SourceRef
}

/** 청구/지급 이력. verified=false면 '미확인'(미청구로 단정 금지). */
export interface ClaimHistoryEntry {
  id: string
  coverageId?: string
  treatmentEventId?: string
  date?: string
  paidAmount?: number | null
  status?: string // 예: '지급', '부지급'
  verified: boolean
  source: SourceRef
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
  /** 지급 "예상"액 — 검증된 약관 지급규칙 + 증빙이 있을 때만. 없으면 null(미산정, 0 아님). */
  estimatedAmount: number | null
  amountBasis: string | null // 금액 산정 근거(없으면 null)
  /** 중복 합산 방지 그룹 키(동일 키끼리는 합산하지 않음). */
  dedupeGroupId: string | null
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
  asOf?: string // 분석 기준일 YYYYMMDD (기본: 오늘)
  /** 합성(DEMO) 데이터 여부 — 결과 전체에 DEMO 표시. */
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
  DIAGNOSIS: { code: 'DIAGNOSIS_PROOF', label: '진단서/진단명 증빙', reason: '진단명이 확인되지 않아 진단비 조건을 판단할 수 없습니다.' },
  SURGERY: { code: 'SURGERY_PROOF', label: '수술 확인서/수술명 증빙', reason: '검증된 수술 근거가 없어 수술비를 인정할 수 없습니다(의료행위 이름만으로 인정 금지).' },
  HOSPITAL: { code: 'HOSPITAL_PROOF', label: '입·퇴원 확인서', reason: '입원일수 근거가 부족합니다.' },
  RECEIPT: { code: 'RECEIPT', label: '진료비 영수증/세부내역', reason: '실손 자기부담·공제 계산을 위한 증빙이 부족합니다.' },
  CLAIM_HISTORY: { code: 'CLAIM_HISTORY', label: '청구/지급 이력(보험사 확인)', reason: '청구 이력이 확인되지 않았습니다(미청구로 단정 불가).' }
} as const

const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{8}$/.test(s)
const todayYmd = (): string => new Date().toISOString().slice(0, 10).replace(/-/g, '')

/** YYYYMMDD 문자열 비교(문자열 사전식 = 날짜 순). 둘 다 유효할 때만 비교. */
const beforeYmd = (a?: string | null, b?: string | null): boolean => (isYmd(a) && isYmd(b) ? a < b : false)
const addDaysYmd = (ymd: string, days: number): string => {
  const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

/** 진료형태 문자열로 "입원"을 추정(거친 신호 — 단독으로 수술 인정에 쓰지 않음). */
const looksInpatient = (t: TreatmentEvent): boolean => /입원/.test(t.treatType ?? '') || (t.visitDays ?? 0) > 1

/** 담보 카테고리와 진료 이벤트의 "관련성"(후보가 될 수 있는지)만 판단. 지급 인정과는 별개. */
const isRelevant = (cov: Coverage, t: TreatmentEvent): boolean => {
  switch (cov.category) {
    case 'hospitalization_daily':
      return looksInpatient(t) || (t.visitDays ?? 0) >= 1
    case 'actual_loss':
      return (t.deductibleAmt ?? 0) > 0 || (t.publicCharge ?? 0) > 0 || Boolean(t.institution)
    case 'surgery':
      // 수술 담보는 '처치/수술명' 또는 '검증된 수술 근거'가 있을 때만 관련 후보로 올린다.
      return Boolean(t.procedureName) || t.surgeryVerified === true
    case 'diagnosis':
      // 진단명이 있을 때만 관련(없으면 진단비 후보로 올리되 NEED_DOCUMENTS 처리는 아래에서).
      return Boolean(t.diagnosisName) || Boolean(t.procedureName)
    default:
      return false
  }
}

interface Judged {
  status: ClaimStatus
  reasons: string[]
  missingDocs: MissingDoc[]
  amount: number | null
  amountBasis: string | null
}

/** 한 (담보, 진료) 쌍을 결정론적으로 판정. */
function judge(cov: Coverage, t: TreatmentEvent, history: ClaimHistoryEntry[], asOf: string): Judged {
  const reasons: string[] = []
  const missing: MissingDoc[] = []

  // 1) 보장 개시 전 / 면책기간 → EXCLUDED (단, 경계값이 유효할 때만 단정)
  const boundary = isYmd(cov.startDate) ? cov.startDate : null
  if (boundary && beforeYmd(t.date, boundary)) {
    return {
      status: 'EXCLUDED',
      reasons: [`진료일(${t.date})이 보장 개시일(${boundary}) 이전 — 보장 대상 아님.`],
      missingDocs: [],
      amount: null,
      amountBasis: null
    }
  }
  if (boundary && typeof cov.waitingDays === 'number' && cov.waitingDays > 0) {
    const waitEnd = addDaysYmd(boundary, cov.waitingDays)
    if (beforeYmd(t.date, waitEnd)) {
      return {
        status: 'EXCLUDED',
        reasons: [`진료일(${t.date})이 면책기간(개시 ${boundary} +${cov.waitingDays}일, ~${waitEnd}) 이내 — 면책.`],
        missingDocs: [],
        amount: null,
        amountBasis: null
      }
    }
  }

  // 2) 검증된 지급 이력과 매칭 → ALREADY_PAID
  const paid = history.find(
    (h) => h.verified && h.coverageId === cov.id && (h.treatmentEventId === t.id || (isYmd(h.date) && h.date === t.date))
  )
  if (paid) {
    return {
      status: 'ALREADY_PAID',
      reasons: [`검증된 지급 이력과 매칭(${paid.date ?? '-'}${paid.paidAmount != null ? `, ${paid.paidAmount.toLocaleString('ko-KR')}원` : ''}).`],
      missingDocs: [],
      amount: null,
      amountBasis: null
    }
  }

  // 3) 약관 미연결 → 지급조건/금액 판단 불가 → NEED_DOCUMENTS
  const hasTerms = Boolean(cov.clauseId)
  if (!hasTerms) {
    missing.push(DOC.TERMS)
    reasons.push('약관(조항/버전) 미연결 — 지급조건·금액 판단 보류.')
  }

  // 4) 카테고리별 "증빙" 충족 여부
  let evidenceOk = true
  if (cov.category === 'surgery') {
    if (!t.surgeryVerified) {
      evidenceOk = false
      missing.push(DOC.SURGERY)
      reasons.push('수술 근거 미검증 — 처치/의료행위 이름만으로 수술비 인정 불가.')
    }
  } else if (cov.category === 'diagnosis') {
    if (!t.diagnosisName) {
      evidenceOk = false
      missing.push(DOC.DIAGNOSIS)
      reasons.push('진단명 미확인 — 진단비 조건 판단 불가.')
    }
  } else if (cov.category === 'hospitalization_daily') {
    if (!(looksInpatient(t) && (t.visitDays ?? 0) >= 1)) {
      evidenceOk = false
      missing.push(DOC.HOSPITAL)
      reasons.push('입원 근거(입원일수) 부족.')
    }
  } else if (cov.category === 'actual_loss') {
    if (!((t.deductibleAmt ?? 0) > 0 || (t.publicCharge ?? 0) > 0)) {
      evidenceOk = false
      missing.push(DOC.RECEIPT)
      reasons.push('실손 계산 근거(본인부담/영수증) 부족.')
    }
  }

  // 5) 금액 산정 — 검증된 약관 지급규칙이 있을 때만. 없으면 null(미산정).
  let amount: number | null = null
  let amountBasis: string | null = null
  if (hasTerms && evidenceOk) {
    if (cov.category === 'hospitalization_daily' && typeof cov.perDayAmount === 'number') {
      const days = Math.max(0, Math.floor(t.visitDays ?? 0))
      const cappedDays = typeof cov.limitDays === 'number' ? Math.min(days, cov.limitDays) : days
      amount = applyLimitsAndReduction(cov, cappedDays * cov.perDayAmount, t)
      amountBasis = `입원일당 ${cov.perDayAmount.toLocaleString('ko-KR')}원 × ${cappedDays}일${
        typeof cov.limitDays === 'number' ? `(일수한도 ${cov.limitDays}일 적용)` : ''
      } [약관 ${cov.clauseId}@${cov.clauseVersion ?? '?'}]`
    } else if (
      (cov.category === 'diagnosis' || cov.category === 'surgery') &&
      typeof cov.verifiedPayoutAmount === 'number'
    ) {
      amount = applyLimitsAndReduction(cov, cov.verifiedPayoutAmount, t)
      amountBasis = `약관 검증 정액 지급액 ${cov.verifiedPayoutAmount.toLocaleString('ko-KR')}원 [약관 ${cov.clauseId}@${
        cov.clauseVersion ?? '?'
      }]`
    } else {
      // 약관은 있으나 "검증된 지급 금액 규칙"이 없음 → 금액 미산정(null). 가입금액으로 대체하지 않는다.
      amount = null
      amountBasis = null
      reasons.push('약관 연결됨이나 검증된 지급액 규칙 없음 — 금액 미산정(null). KB 가입금액은 지급액 아님.')
      missing.push({ code: 'PAYOUT_RULE', label: '약관 지급액 산정 근거', reason: '해당 담보의 지급액 산정 규칙이 약관에서 확인되지 않았습니다.' })
    }
  }

  // 6) 청구 이력 미확인 → 미청구로 단정 금지(근거만 남김)
  const anyVerifiedHistory = history.some((h) => h.verified && h.coverageId === cov.id)
  if (!anyVerifiedHistory) {
    reasons.push('청구 이력 미확인 — 미청구로 단정하지 않음(보험사 확인 필요).')
    if (!missing.find((m) => m.code === DOC.CLAIM_HISTORY.code)) missing.push(DOC.CLAIM_HISTORY)
  }

  // 7) 상태 결정 (보수적)
  let status: ClaimStatus
  if (!hasTerms || !evidenceOk) {
    status = 'NEED_DOCUMENTS'
  } else if (amount == null) {
    // 조건은 보되 금액이 미산정이거나 청구이력 미확인 → POTENTIAL(가능성, 추가확인 필요)
    status = 'POTENTIAL'
    reasons.unshift('조건 일부 확인 — 금액 미산정 또는 추가 확인 필요(가능성).')
  } else {
    status = 'CONFIRMED_CONDITIONS'
    reasons.unshift('근거상 지급 "조건"이 확인됨(※ 보험사 지급확정 아님).')
  }

  return { status, reasons, missingDocs: dedupeDocs(missing), amount, amountBasis }
}

function applyLimitsAndReduction(cov: Coverage, base: number, _t: TreatmentEvent): number {
  let amt = base
  // 감액(보장 개시 후 N일 이내) — startDate 없으면 적용 불가(미확인은 적용하지 않음).
  if (Array.isArray(cov.reductionRules) && isYmd(cov.startDate)) {
    for (const r of cov.reductionRules) {
      const until = addDaysYmd(cov.startDate, r.withinDays)
      if (beforeYmd(_t.date, until)) {
        amt = Math.round(amt * r.ratio)
        break
      }
    }
  }
  if (typeof cov.limitAmount === 'number') amt = Math.min(amt, cov.limitAmount)
  return amt
}

function dedupeDocs(docs: MissingDoc[]): MissingDoc[] {
  const seen = new Set<string>()
  const out: MissingDoc[] = []
  for (const d of docs) {
    if (seen.has(d.code)) continue
    seen.add(d.code)
    out.push(d)
  }
  return out
}

/**
 * 결정론적 분석 — 각 (담보 × 관련 진료) 조합을 판정하고 후보를 만든다.
 * 이벤트를 병합하지 않으며(같은 날짜·기관이라도 별개), 중복 담보는 dedupeGroupId로 표시만 한다(합산 금지).
 */
export function analyzeClaims(input: AnalyzeInput): AnalyzeResult {
  const warnings: string[] = []
  const asOf = isYmd(input.asOf) ? (input.asOf as string) : todayYmd()
  const treatments = Array.isArray(input.treatments) ? input.treatments.filter((t) => t && isYmd(t.date)) : []
  if (Array.isArray(input.treatments) && treatments.length !== input.treatments.length) {
    warnings.push('일부 진료 이벤트가 날짜(YYYYMMDD) 누락/형식 오류로 제외되었습니다.')
  }
  const contracts = Array.isArray(input.contracts) ? input.contracts : []
  const history = Array.isArray(input.claimHistory) ? input.claimHistory : []
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
        const j = judge(cov, t, history, asOf)
        seq += 1
        const sources: SourceRef[] = [t.source, cov.source, contract.source].filter(Boolean) as SourceRef[]
        if (cov.clauseId) {
          sources.push({ kind: 'policy_terms', clauseId: cov.clauseId, clauseVersion: cov.clauseVersion ?? undefined })
        }
        candidates.push({
          id: `cand-${seq}`,
          status: j.status,
          coverageId: cov.id,
          coverageName: cov.name,
          category: cov.category,
          contractId: contract.id,
          insurer: contract.insurer,
          treatmentEventIds: [t.id], // 병합하지 않음 — 1 이벤트 기준
          estimatedAmount: j.amount,
          amountBasis: j.amountBasis,
          dedupeGroupId: cov.dedupeGroup ? `${t.id}::${cov.dedupeGroup}` : null,
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
 * 중복 합산 방지 합계 — CONFIRMED_CONDITIONS 후보 중 금액이 산정된 것만,
 * dedupeGroupId가 같은 그룹은 "하나"로만(그룹 내 최대값) 합산. null 금액은 합산에서 제외(미산정).
 * ※ 이 합계는 "검토 전 후보"의 참고치이며 "받을 수 있는 보험금"이 아님(UI에서 명확히 표기).
 */
export function sumConfirmedAmounts(candidates: ClaimCandidate[]): {
  total: number
  countedCandidateIds: string[]
  uncomputedCount: number
} {
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
    } else {
      singles.push({ amount: c.estimatedAmount, id: c.id })
    }
  }
  const picked = [...singles, ...byGroup.values()]
  return {
    total: picked.reduce((s, p) => s + p.amount, 0),
    countedCandidateIds: picked.map((p) => p.id),
    uncomputedCount: uncomputed
  }
}

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  CONFIRMED_CONDITIONS: '조건 확인(지급확정 아님)',
  POTENTIAL: '가능성(추가 확인)',
  NEED_DOCUMENTS: '서류/약관 필요',
  EXCLUDED: '대상 아님(개시전/면책)',
  ALREADY_PAID: '이미 지급'
}
