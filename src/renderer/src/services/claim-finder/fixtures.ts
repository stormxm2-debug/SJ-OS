/**
 * SJ CLAIM FINDER — 합성(DEMO) fixture.
 *
 * ⚠️ 전부 **가상 데이터**이며 **실제 HIRA/KB 포맷으로 검증되지 않았다**(내부 포맷).
 *    실제 샘플(심평원 진료 JSON·KB 보장분석 PDF·약관)이 확보되면 어댑터로 교체한다.
 *    UI에서 이 데이터로 만든 결과는 반드시 'DEMO' 로 표시한다(isDemo=true).
 *
 * v0.2: CONFIRMED 경로는 "조건 검증(verifications) + 보장 개시/종료/면책 확인 + 입원 증빙" 이 모두
 *       갖춰졌을 때만 성립함을 보이기 위해 아래 합성 검증값을 포함한다(실제 아님).
 */

import type { AnalyzeInput, Contract, ClaimHistoryEntry, TreatmentEvent, Verification } from './claimRules'

const S = (note: string) => ({ kind: 'coverage_pdf' as const, note })

export function buildDemoInput(): AnalyzeInput {
  const common = { startDate: '20240101', endDate: '20991231', waitingDays: 0 }
  const contract: Contract = {
    id: 'demo-contract-1',
    insurer: '데모화재(가상)',
    productName: '가상 종합보험',
    contractDate: '20240101',
    source: { kind: 'coverage_pdf', note: 'DEMO 계약' },
    coverages: [
      { id: 'cov-hosp', contractId: 'demo-contract-1', name: '질병입원일당', category: 'hospitalization_daily', subscribedAmount: 30000, clauseId: 'TERM-HOSP', clauseVersion: 'v1(DEMO)', ...common, perDayAmount: 30000, limitDays: 120, source: S('DEMO 약관 검증') },
      { id: 'cov-dx-cancer', contractId: 'demo-contract-1', name: '암진단비', category: 'diagnosis', subscribedAmount: 20000000, clauseId: 'TERM-DX', clauseVersion: 'v2(DEMO)', startDate: '20240101', endDate: '20991231', waitingDays: 90, verifiedPayoutAmount: 20000000, reductionRules: [{ withinDays: 365, ratio: 0.5, note: '가입 1년내 50% 감액(가상)' }], source: S('DEMO 약관 검증') },
      { id: 'cov-surg', contractId: 'demo-contract-1', name: '질병수술비', category: 'surgery', subscribedAmount: 1000000, clauseId: 'TERM-SURG', clauseVersion: 'v1(DEMO)', ...common, verifiedPayoutAmount: 1000000, source: S('DEMO 약관 검증') },
      { id: 'cov-actual', contractId: 'demo-contract-1', name: '실손의료비', category: 'actual_loss', subscribedAmount: null, clauseId: null, ...common, source: S('DEMO 약관 미연결') },
      { id: 'cov-ci-main', contractId: 'demo-contract-1', name: 'CI진단비(주계약)', category: 'diagnosis', subscribedAmount: 30000000, clauseId: 'TERM-CI', clauseVersion: 'v1(DEMO)', ...common, verifiedPayoutAmount: 30000000, dedupeGroup: 'CI', source: S('DEMO 약관 검증') },
      { id: 'cov-ci-pre', contractId: 'demo-contract-1', name: 'CI선지급특약', category: 'diagnosis', subscribedAmount: 10000000, clauseId: 'TERM-CIPRE', clauseVersion: 'v1(DEMO)', ...common, verifiedPayoutAmount: 10000000, dedupeGroup: 'CI', source: S('DEMO 약관 검증') }
    ]
  }

  const hr = (jsonPath: string) => ({ kind: 'health_record_json' as const, jsonPath })
  const treatments: TreatmentEvent[] = [
    { id: 't-before', date: '20231201', institution: '가상A병원', treatType: '입원', inpatientVerified: true, admissionDays: 5, source: hr('demo[0]') }, // 개시 전 → EXCLUDED
    { id: 't-hosp', date: '20250601', institution: '가상C병원', treatType: '입원', inpatientVerified: true, admissionDays: 10, deductibleAmt: 500000, source: hr('demo[1]') },
    { id: 't-dx', date: '20250701', institution: '가상D병원', treatType: '외래', diagnosisName: '대장암', source: hr('demo[2]') },
    { id: 't-surg-name', date: '20250801', institution: '가상E병원', procedureName: '가상절제술', surgeryVerified: false, source: hr('demo[3]') } // 이름만 → NEED_DOCUMENTS
  ]

  // (진료,담보) 지급조건 검증 — DEMO에서만 합성으로 '검증됨' 처리(실제는 사람 검토/증빙 대조).
  const verifications: Verification[] = [
    { treatmentEventId: 't-hosp', coverageId: 'cov-hosp', conditionVerified: true, note: 'DEMO 입원 조건 검증' },
    { treatmentEventId: 't-dx', coverageId: 'cov-dx-cancer', conditionVerified: true, note: 'DEMO 암 진단 조건 검증' },
    { treatmentEventId: 't-dx', coverageId: 'cov-ci-main', conditionVerified: true, note: 'DEMO CI 조건 검증' },
    { treatmentEventId: 't-dx', coverageId: 'cov-ci-pre', conditionVerified: true, note: 'DEMO CI 선지급 조건 검증' }
  ]

  const claimHistory: ClaimHistoryEntry[] = [] // 청구 이력 미확인
  return { contracts: [contract], treatments, claimHistory, verifications, asOf: '20261101', demo: true }
}
