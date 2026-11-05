// 실손의료보험 '예상 지급액' 시나리오 계산 — 수동 입력 기반, 세대별 규칙 적용.
//
// ⚠️ 중요: 이 모듈은 "추정 시나리오"다. 실제 지급은 가입 담보·약관 버전·잔여 한도·
//   급여/비급여 판정·면책/대기기간에 따라 달라진다. 여기 기본 규칙(DEFAULT_GEN_RULES)은
//   세대별 '일반 근사치'이며 상품마다 다르므로, 화면에서 FC가 실제 약관값으로 수정해 쓴다.
//   금액을 임의로 지어내지 않고, 입력값 + (수정 가능한) 규칙으로만 계산한다.

export type Generation = '1' | '2' | '3' | '4'
export type CareType = 'out' | 'in' // 통원 / 입원

/** 세대별 실손 규칙(수정 가능). 비율은 자기부담률(0~1), 금액은 원(KRW). */
export interface GenRule {
  label: string
  /** 급여 의료비 자기부담률 (0~1). */
  coveredCopayRate: number
  /** 비급여 의료비 자기부담률 (0~1). */
  uncoveredCopayRate: number
  /** 통원 1회 정액공제(원). 자기부담률 공제와 '큰 쪽'만 적용된다. 입원엔 미적용. */
  outpatientDeduction: number
  /** 연간 보상 한도(원). */
  annualLimit: number
  /** 화면 안내용 비고. */
  note: string
}

/** 세대별 표준 근사치(수정 전제). 실제 상품/약관값으로 조정해 사용. */
export const DEFAULT_GEN_RULES: Record<Generation, GenRule> = {
  '1': {
    label: '1세대 (구실손 ~2009.9)',
    coveredCopayRate: 0,
    uncoveredCopayRate: 0,
    outpatientDeduction: 0,
    annualLimit: 50_000_000,
    note: '상품별 편차가 큽니다(자기부담 0~20%, 통원공제 유무). 실제 증권값으로 꼭 조정하세요.'
  },
  '2': {
    label: '2세대 (표준화 2009.10~2017.3)',
    coveredCopayRate: 0.2,
    uncoveredCopayRate: 0.2,
    outpatientDeduction: 10_000,
    annualLimit: 50_000_000,
    note: '초기 자기부담 10%형도 있습니다. 통원 공제는 외래+처방 기준이라 상품에 맞게 조정하세요.'
  },
  '3': {
    label: '3세대 (착한실손 2017.4~2021.6)',
    coveredCopayRate: 0.1,
    uncoveredCopayRate: 0.2,
    outpatientDeduction: 15_000,
    annualLimit: 50_000_000,
    note: '비급여 3대 특약(도수·주사·MRI)은 별도 자기부담 30%·별도 한도입니다. 해당분은 비급여에 반영 후 조정하세요.'
  },
  '4': {
    label: '4세대 (2021.7~)',
    coveredCopayRate: 0.2,
    uncoveredCopayRate: 0.3,
    outpatientDeduction: 20_000,
    annualLimit: 50_000_000,
    note: '비급여는 할증/할인(이용량 차등)이 별도 적용될 수 있습니다. 급여/비급여 통원공제가 다르니 조정하세요.'
  }
}

export interface EstimateInput {
  generation: Generation
  careType: CareType
  /** 급여 의료비(원) — 본인부담 대상 금액. */
  coveredMedical: number
  /** 비급여 의료비(원). */
  uncoveredMedical: number
}

export interface EstimateResult {
  /** 급여분 보험금(자기부담률 적용 후). */
  coveredBenefit: number
  /** 비급여분 보험금(자기부담률 적용 후). */
  uncoveredBenefit: number
  /** 자기부담률로 공제된 금액. */
  rateCopay: number
  /** 통원 정액공제로 추가 차감된 금액(자기부담률 공제보다 클 때만). */
  outpatientExtraDeduction: number
  /** 연 한도로 깎인 금액(초과분). */
  limitCut: number
  /** 최종 예상 지급액(원). */
  estimatedPayout: number
}

const nn = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0)
const clampRate = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/** 입력 + 규칙 → 예상 지급액. 순수 함수(부수효과 없음). */
export function estimateInsurancePayout(input: EstimateInput, rule: GenRule): EstimateResult {
  const covered = nn(input.coveredMedical)
  const uncovered = nn(input.uncoveredMedical)
  const cRate = clampRate(rule.coveredCopayRate)
  const uRate = clampRate(rule.uncoveredCopayRate)

  const coveredBenefit = covered * (1 - cRate)
  const uncoveredBenefit = uncovered * (1 - uRate)
  const rateCopay = covered * cRate + uncovered * uRate
  const grossBenefit = coveredBenefit + uncoveredBenefit

  // 통원: 공제 = max(자기부담률 공제, 정액공제). 이미 자기부담률 공제는 반영됐으므로,
  // 정액공제가 더 크면 그 차액만 추가 차감한다. 입원엔 정액공제 없음.
  const dedux = nn(rule.outpatientDeduction)
  const outpatientExtraDeduction = input.careType === 'out' ? Math.max(0, Math.min(dedux - rateCopay, grossBenefit)) : 0

  const afterDeduction = Math.max(0, grossBenefit - outpatientExtraDeduction)
  const limit = nn(rule.annualLimit)
  const capped = limit > 0 ? Math.min(afterDeduction, limit) : afterDeduction
  const limitCut = afterDeduction - capped

  const round = (v: number): number => Math.round(v)
  return {
    coveredBenefit: round(coveredBenefit),
    uncoveredBenefit: round(uncoveredBenefit),
    rateCopay: round(rateCopay),
    outpatientExtraDeduction: round(outpatientExtraDeduction),
    limitCut: round(limitCut),
    estimatedPayout: round(capped)
  }
}

export const wonFormat = (v: number): string => `${Math.round(nn(v)).toLocaleString('ko-KR')}원`
