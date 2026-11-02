/**
 * SJ CLAIM FINDER — 어댑터: 기존 SJ-OS 데이터를 규칙 엔진 입력(정규화 포맷)으로 변환.
 *
 * 설계:
 *  - 엔진(claimRules)은 순수하게 유지하고, 여기서 "기존 저장 구조 → 엔진 입력"만 변환한다.
 *  - 무거운 모듈(pdfjs/supabase 등)을 import 하지 않도록 **구조적(duck-typed) 입력**만 받는다
 *    → UI가 실제 객체를 넘기면 구조가 호환되고, 어댑터는 단독으로 테스트 가능.
 *  - 실제 HIRA/KB 필드를 "추측"하지 않는다: 코드에서 실제로 쓰이는(재확인된) 필드명만 매핑하고,
 *    없으면 null/미확인으로 둔다. 잘못된 JSON/PDF 입력은 건너뛰고 warnings 로 남긴다.
 */

import type { Contract, Coverage, CoverageCategory, SourceRef, TreatmentEvent } from './claimRules'

/** 안전한 숫자화(원 단위). 콤마/문자 제거. 실패 시 undefined. */
const toNum = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.-]/g, ''))
    if (Number.isFinite(n) && v.replace(/[^\d]/g, '') !== '') return n
  }
  return undefined
}
const toYmd = (v: unknown): string | undefined => {
  const d = String(v ?? '').replace(/[^\d]/g, '')
  return d.length === 8 ? d : undefined
}
const str = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) 건강기록(CODEF 진료/투약 JSON) → TreatmentEvent[]
//    코드에서 실제 렌더링되는 섹션/필드명만 사용(도메인 맵 기준). 없으면 미확인(null).
// ─────────────────────────────────────────────────────────────────────────────

const TREAT_LIST_KEYS = [
  'resBasicTreatList',
  'resDetailTreatList',
  'resPrescribeDrugList',
  'resList',
  'resTreatmentList',
  'resPrescribeList',
  'resOperationList'
]

/** 응답(data)에서 레코드 배열들을 모은다(여러 섹션). 배열 자체면 그대로. */
function collectRecordArrays(result: unknown): { key: string; rows: Record<string, unknown>[] }[] {
  if (Array.isArray(result)) return [{ key: 'data', rows: result as Record<string, unknown>[] }]
  if (result && typeof result === 'object') {
    const out: { key: string; rows: Record<string, unknown>[] }[] = []
    const obj = result as Record<string, unknown>
    for (const k of TREAT_LIST_KEYS) {
      if (Array.isArray(obj[k])) out.push({ key: k, rows: obj[k] as Record<string, unknown>[] })
    }
    if (out.length === 0) {
      // 알려진 키가 없으면 첫 배열 속성을 시도(방어적).
      for (const [k, v] of Object.entries(obj)) if (Array.isArray(v)) out.push({ key: k, rows: v as Record<string, unknown>[] })
    }
    return out
  }
  return []
}

const firstOf = (r: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) if (r[k] != null && r[k] !== '') return r[k]
  return undefined
}

/** 건강기록 결과 → 진료 이벤트. fileHash(업로드 원본) 또는 요청 id를 provenance 로. */
export function treatmentsFromHealthRecordResult(
  result: unknown,
  opts?: { fileHash?: string; requestId?: string }
): { events: TreatmentEvent[]; warnings: string[] } {
  const warnings: string[] = []
  const sections = collectRecordArrays(result)
  if (sections.length === 0) {
    if (result != null) warnings.push('건강기록 결과에서 진료 레코드 배열을 찾지 못했습니다(형식 미확인).')
    return { events: [], warnings }
  }
  const events: TreatmentEvent[] = []
  let idx = 0
  for (const section of sections) {
    for (let i = 0; i < section.rows.length; i++) {
      const r = section.rows[i]
      if (!r || typeof r !== 'object') {
        warnings.push(`레코드 형식 오류(${section.key}[${i}]) — 건너뜀.`)
        continue
      }
      const date = toYmd(firstOf(r, ['resTreatStartDate', 'resTreatDate', 'resDate', 'commStartDate']))
      if (!date) {
        warnings.push(`진료일 누락/형식오류(${section.key}[${i}]) — 제외.`)
        continue
      }
      idx += 1
      const diagnosis = str(firstOf(r, ['resDiseaseName', 'resSickName', 'resDisease']))
      const procedure = str(firstOf(r, ['resOperationName', 'resSurgeryName', 'resTreatMeaning']))
      const source: SourceRef = {
        kind: 'health_record_json',
        jsonPath: `${section.key}[${i}]`,
        fileHash: opts?.fileHash,
        note: opts?.requestId ? `requestId=${opts.requestId}` : undefined
      }
      events.push({
        id: `t-${idx}`,
        date,
        institution: str(firstOf(r, ['resHospitalName', 'resPharmacyName', 'resOrgName'])),
        treatType: str(firstOf(r, ['resTreatType', 'resType', 'resTreatForm'])),
        visitDays: toNum(firstOf(r, ['resVisitDays'])),
        // 공단 자료의 입원일수는 참고값으로만 매핑하고, 입원 '확정'은 별도 증빙(inpatientVerified)으로 한다.
        admissionDays: toNum(firstOf(r, ['resAdmissionDays', 'resHospitalizationDays'])) ?? null,
        inpatientVerified: false,
        prescribeDays: toNum(firstOf(r, ['resTotalDosingdays', 'resPrescribeDays', 'resMedicationDays'])),
        prescribeCnt: toNum(firstOf(r, ['resPrescribeCnt'])),
        deductibleAmt: toNum(firstOf(r, ['resDeductibleAmt', 'resSelfPay'])),
        publicCharge: toNum(firstOf(r, ['resPublicCharge'])),
        diagnosisName: diagnosis ?? null,
        procedureName: procedure ?? null,
        surgeryVerified: false, // 이름만으로 수술 인정하지 않음 — 검증은 별도 증빙으로.
        source,
        raw: r
      })
    }
  }
  if (events.length === 0) warnings.push('유효한 진료 이벤트가 없습니다(날짜 기준 전부 제외).')
  return { events, warnings }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) 담보명 → 카테고리 (청구 규칙용 보수적 분류)
//    ※ coverageMix.MIX_KEYS 가 더 풍부하나 무거운 의존을 피해 청구에 필요한 핵심만 둔다.
// ─────────────────────────────────────────────────────────────────────────────

export function coverageCategoryOf(name: string): CoverageCategory {
  const n = (name || '').replace(/\s/g, '')
  if (!n) return 'unknown'
  if (/(실손|실비|의료비|통원의료비|입원의료비|급여|비급여)/.test(n)) return 'actual_loss'
  if (/(입원일당|입원비|입원급여금|질병입원|상해입원|입원\d*일)/.test(n)) return 'hospitalization_daily'
  if (/(수술비|수술급여금|수술자금|\d+종수술)/.test(n)) return 'surgery'
  if (/(진단비|진단금|진단급여금|암진단|뇌|심장|심혈관|급성심근|뇌졸중|뇌출혈)/.test(n)) return 'diagnosis'
  return 'other'
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) 보장분석(기존 CoverageAnalysis 구조) → Contract[]
//    구조적 입력만 받는다(coverageAnalysis.ts 를 import 하지 않음).
// ─────────────────────────────────────────────────────────────────────────────

interface HeldPolicyLike {
  id?: string
  insurer?: string
  product?: string
  ptype?: string
  monthly?: number
}
interface CoverageRowLike {
  key?: string
  label?: string
  unit?: string // 'amount' | 'daily' | 'yn'
  current?: number
  recommended?: number
}
interface CoverageAnalysisLike {
  id?: string
  policies?: HeldPolicyLike[]
  coverages?: CoverageRowLike[]
}

/**
 * CoverageAnalysis → Contract[]. 보장분석은 "표준 담보 보유금액(current)" 그리드라
 * 계약↔담보가 1:1로 분리돼 있지 않다. 따라서 보유 보험사들을 하나의 '보유계약' 묶음으로,
 * current>0 인 표준 담보를 Coverage 로 올린다(약관 미연결 → 규칙상 NEED_DOCUMENTS).
 * contractDate/약관이 없으므로 대부분 '서류 필요'로 떨어지는 것이 정상(보수적).
 */
export function contractsFromCoverageAnalysis(
  analysis: CoverageAnalysisLike | null | undefined
): { contracts: Contract[]; warnings: string[] } {
  const warnings: string[] = []
  if (!analysis || typeof analysis !== 'object') return { contracts: [], warnings: ['보장분석 데이터가 없습니다.'] }
  const policies = Array.isArray(analysis.policies) ? analysis.policies : []
  const rows = Array.isArray(analysis.coverages) ? analysis.coverages : []
  const insurer = policies.map((p) => str(p?.insurer)).filter(Boolean).join(', ') || '보유 보험(미지정)'
  const source: SourceRef = { kind: 'coverage_pdf', note: `coverage-analysis:${str(analysis.id) ?? '-'}` }

  const coverages: Coverage[] = []
  let i = 0
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const current = toNum(row.current) ?? 0
    if (current <= 0) continue // 보유하지 않은(0) 표준 담보는 제외
    i += 1
    const label = str(row.label) ?? str(row.key) ?? `담보${i}`
    coverages.push({
      id: `cov-ca-${i}`,
      contractId: 'contract-ca',
      name: label,
      category: coverageCategoryOf(label),
      subscribedAmount: current, // ※ 가입금액 ≈ (실제 지급액 아님)
      clauseId: null, // 약관 미연결 → 규칙에서 NEED_DOCUMENTS
      clauseVersion: null,
      startDate: null,
      endDate: null,
      waitingDays: null,
      limitAmount: null,
      limitDays: null,
      perDayAmount: null,
      verifiedPayoutAmount: null,
      dedupeGroup: null,
      source
    })
  }
  if (coverages.length === 0) warnings.push('보장분석에 보유(현재 금액>0) 담보가 없습니다.')
  const contracts: Contract[] = coverages.length
    ? [{ id: 'contract-ca', insurer, productName: policies.map((p) => str(p?.product)).filter(Boolean).join(', ') || undefined, contractDate: null, coverages, source }]
    : []
  return { contracts, warnings }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) 약관(PolicyTerm) 연결 — 보험사+담보명 매칭 시 clauseId 부여.
//    payRule 은 자유 텍스트라 "지급액 숫자"로 신뢰 파싱하지 않는다(verifiedPayoutAmount=null 유지).
// ─────────────────────────────────────────────────────────────────────────────

interface TermsClauseLike {
  coverage?: string
  clause?: string
  payRule?: string
  exclusions?: string | null
}
interface PolicyTermLike {
  id?: string
  insurer?: string
  productName?: string
  versionNote?: string
  summary?: { clauses?: TermsClauseLike[] }
}

const norm = (s: unknown): string => String(s ?? '').replace(/\s/g, '').toLowerCase()

/** 약관 목록으로 계약의 담보에 조항 참조를 연결(이름 포함 매칭). 반환: 변경된 복사본 + 매칭 수. */
export function attachPolicyTerms(
  contracts: Contract[],
  terms: PolicyTermLike[] | null | undefined
): { contracts: Contract[]; matched: number; warnings: string[] } {
  const warnings: string[] = []
  const list = Array.isArray(terms) ? terms : []
  if (list.length === 0) return { contracts, matched: 0, warnings: ['연결할 약관이 없습니다(약관 미등록).'] }
  let matched = 0
  const out = contracts.map((c) => ({
    ...c,
    coverages: c.coverages.map((cov) => {
      const covN = norm(cov.name)
      for (const term of list) {
        const clauses = Array.isArray(term?.summary?.clauses) ? (term!.summary!.clauses as TermsClauseLike[]) : []
        const hit = clauses.find((cl) => {
          const cn = norm(cl?.coverage)
          return cn && (covN.includes(cn) || cn.includes(covN))
        })
        if (hit) {
          matched += 1
          return {
            ...cov,
            clauseId: str(term.id) ?? 'term',
            clauseVersion: str(term.versionNote) ?? null,
            source: { ...cov.source, note: `${cov.source.note ?? ''} +terms:${str(term.id) ?? ''}` }
          }
        }
      }
      return cov
    })
  }))
  if (matched === 0) warnings.push('담보명과 일치하는 약관 조항을 찾지 못했습니다.')
  return { contracts: out, matched, warnings }
}
