import type { AnalysisSnapshot, CoverageRow, InsuranceAnalysis } from './types'

/**
 * Realistic — but entirely fictional — seed data for the Insurance Analysis
 * Entry. Customers, FCs and teams reuse the Customer Workspace / FC OS seeds;
 * all figures are mock only, with no real personal or sensitive information.
 * Recommendations are explicit local placeholders — no real AI output — and
 * every record has aiReady = false to signal the analysis engine is not yet
 * wired.
 */

const PLACEHOLDER =
  '※ 자동 분석 미연동 — 향후 Jarvis 분석 엔진이 보장 공백/추천을 자동 생성합니다. 현재는 FC 수동 검토용 초안입니다.'

/** Build a coverage row with adequacy derived from current vs. recommended. */
function cov(
  category: CoverageRow['category'],
  currentAmount: number,
  recommendedAmount: number
): CoverageRow {
  const ratio = recommendedAmount > 0 ? currentAmount / recommendedAmount : 1
  const adequacy: CoverageRow['adequacy'] =
    currentAmount === 0 ? 'none' : ratio >= 1 ? 'sufficient' : ratio >= 0.5 ? 'partial' : 'insufficient'
  return { category, currentAmount, recommendedAmount, adequacy }
}

type Spec = Omit<InsuranceAnalysis, 'createdAt' | 'updatedAt' | 'aiReady' | 'recommendationPlaceholder'>

const SPECS: Spec[] = [
  {
    analysisId: 'ana-6001',
    customerId: 'cus-1001',
    customerName: '강민준',
    fcId: 'fc-gn1-01',
    fcName: '최지아',
    team: '강남 1팀',
    status: 'in-progress',
    policies: [
      { id: 'pol-1', name: '실손의료비', type: '실손', insurer: 'SJ손해', monthlyPremium: 42_000, coverage: '입원/통원 실손', status: 'active' },
      { id: 'pol-2', name: '종합건강보험', type: '건강', insurer: 'SJ생명', monthlyPremium: 88_000, coverage: '진단비 3천만', status: 'active' }
    ],
    coverage: [
      cov('death', 30_000_000, 100_000_000),
      cov('diagnosis', 30_000_000, 50_000_000),
      cov('hospitalization', 30_000, 30_000),
      cov('surgery', 3_000_000, 5_000_000),
      cov('medical-actual', 50_000_000, 50_000_000),
      cov('income', 0, 30_000_000)
    ],
    missingCoverage: [
      { id: 'gap-1', category: 'death', note: '가장 사망보장 부족 — 교육자금 대비 보강 필요', severity: 'high' },
      { id: 'gap-2', category: 'income', note: '소득상실 보장 없음', severity: 'medium' }
    ],
    riskTags: ['외벌이', '미성년 자녀', '주택담보대출'],
    analyzedAt: null
  },
  {
    analysisId: 'ana-6002',
    customerId: 'cus-1002',
    customerName: '윤서연',
    fcId: 'fc-gn1-01',
    fcName: '최지아',
    team: '강남 1팀',
    status: 'draft',
    policies: [
      { id: 'pol-3', name: '실손의료비', type: '실손', insurer: 'SJ손해', monthlyPremium: 38_000, coverage: '입원/통원 실손', status: 'active' }
    ],
    coverage: [
      cov('death', 0, 50_000_000),
      cov('diagnosis', 10_000_000, 50_000_000),
      cov('hospitalization', 20_000, 30_000),
      cov('surgery', 0, 5_000_000),
      cov('medical-actual', 50_000_000, 50_000_000)
    ],
    missingCoverage: [
      { id: 'gap-3', category: 'diagnosis', note: '진단비 부족 — 3대 질병 보강 제안', severity: 'high' },
      { id: 'gap-4', category: 'surgery', note: '수술비 보장 없음', severity: 'medium' }
    ],
    riskTags: ['1인 가구', '건강검진 이상소견'],
    analyzedAt: '2026-07-01T06:30:00.000Z'
  },
  {
    analysisId: 'ana-6003',
    customerId: 'cus-1005',
    customerName: '정우성',
    fcId: 'fc-gn2-01',
    fcName: '임하준',
    team: '강남 2팀',
    status: 'reviewed',
    policies: [
      { id: 'pol-4', name: '평생종신보험', type: '종신', insurer: 'SJ생명', monthlyPremium: 210_000, coverage: '사망 1억', status: 'active' },
      { id: 'pol-5', name: '연금저축', type: '연금', insurer: 'SJ생명', monthlyPremium: 300_000, coverage: '노후연금', status: 'active' },
      { id: 'pol-6', name: '종합건강보험', type: '건강', insurer: 'SJ손해', monthlyPremium: 95_000, coverage: '진단비 5천만', status: 'active' }
    ],
    coverage: [
      cov('death', 100_000_000, 100_000_000),
      cov('diagnosis', 50_000_000, 50_000_000),
      cov('hospitalization', 30_000, 30_000),
      cov('surgery', 5_000_000, 5_000_000),
      cov('pension', 3_000_000, 3_000_000),
      cov('medical-actual', 50_000_000, 50_000_000)
    ],
    missingCoverage: [
      { id: 'gap-5', category: 'liability', note: '일상생활배상책임 미가입 — 소액 특약 제안', severity: 'low' }
    ],
    riskTags: ['자산가', '가족보험 리모델링 완료'],
    analyzedAt: '2026-06-28T05:00:00.000Z'
  },
  {
    analysisId: 'ana-6004',
    customerId: 'cus-1006',
    customerName: '한지민',
    fcId: 'fc-gn2-01',
    fcName: '임하준',
    team: '강남 2팀',
    status: 'not-started',
    policies: [
      { id: 'pol-7', name: '실손의료비', type: '실손', insurer: 'SJ손해', monthlyPremium: 36_000, coverage: '입원/통원 실손', status: 'active' }
    ],
    coverage: [
      cov('death', 0, 50_000_000),
      cov('diagnosis', 0, 50_000_000),
      cov('hospitalization', 0, 30_000),
      cov('medical-actual', 50_000_000, 50_000_000)
    ],
    missingCoverage: [
      { id: 'gap-6', category: 'diagnosis', note: '진단비 전무 — 실손만 보유', severity: 'high' }
    ],
    riskTags: ['진단비 공백', '맞벌이'],
    analyzedAt: null
  }
]

export const analysisSeed: AnalysisSnapshot = {
  analyses: SPECS.map<InsuranceAnalysis>((spec) => ({
    ...spec,
    recommendationPlaceholder: PLACEHOLDER,
    aiReady: false,
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z'
  })),
  selectedAnalysisId: 'ana-6001',
  eventLog: []
}
