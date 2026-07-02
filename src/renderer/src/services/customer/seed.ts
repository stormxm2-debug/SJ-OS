import type { CustomerActivity, CustomerMemo, CustomerPolicy, CustomerRecord, CustomerSnapshot } from './types'

/**
 * Realistic — but entirely fictional — seed data for the SJ Invest customer
 * pipeline. Names, phone numbers and figures are mock only; no real personal or
 * sensitive data is used. Customers are assigned to FCs from the FC OS seed
 * (강남 1팀 / 강남 2팀 / 분당 1팀) and spread across statuses, consultation
 * stages, priorities and sources so the workspace has a lifelike shape.
 */

const T = '2026-07-02T00:00:00.000Z'

interface Spec {
  customerId: string
  name: string
  phone: string
  age: number
  gender: CustomerRecord['gender']
  assignedFcId: string
  assignedFcName: string
  team: string
  status: CustomerRecord['status']
  source: CustomerRecord['source']
  consultationStage: CustomerRecord['consultationStage']
  lastContactedAt: string | null
  nextContactAt: string | null
  monthlyPremium: number
  totalPremium: number
  riskTags: string[]
  priority: CustomerRecord['priority']
  createdAt: string
  activities: CustomerActivity[]
  memos: CustomerMemo[]
  policies: CustomerPolicy[]
}

function act(id: string, type: string, summary: string, createdAt: string): CustomerActivity {
  return { id, type, summary, createdAt }
}
function memo(id: string, text: string, author: string, createdAt: string): CustomerMemo {
  return { id, text, author, createdAt }
}

const SPECS: Spec[] = [
  {
    customerId: 'cus-1001',
    name: '강민준',
    phone: '010-2100-0001',
    age: 42,
    gender: 'male',
    assignedFcId: 'fc-gn1-01',
    assignedFcName: '최지아',
    team: '강남 1팀',
    status: 'consulting',
    source: 'referral',
    consultationStage: 'needs-analysis',
    lastContactedAt: '2026-06-30T02:00:00.000Z',
    nextContactAt: '2026-07-03T01:00:00.000Z',
    monthlyPremium: 180_000,
    totalPremium: 2_160_000,
    riskTags: ['가장책임', '대출상환'],
    priority: 'high',
    createdAt: '2026-06-20T00:00:00.000Z',
    activities: [
      act('a-1001-2', 'call', '니즈 분석 통화 — 자녀 교육자금 관심', '2026-06-30T02:00:00.000Z'),
      act('a-1001-1', 'meeting', '첫 상담 미팅 (강남 카페)', '2026-06-22T05:00:00.000Z')
    ],
    memos: [memo('m-1001-1', '보장성 + 저축 혼합 니즈. 배우자 동반 상담 선호.', '최지아', '2026-06-30T02:10:00.000Z')],
    policies: []
  },
  {
    customerId: 'cus-1002',
    name: '윤서연',
    phone: '010-2100-0002',
    age: 35,
    gender: 'female',
    assignedFcId: 'fc-gn1-01',
    assignedFcName: '최지아',
    team: '강남 1팀',
    status: 'proposal-sent',
    source: 'existing-customer',
    consultationStage: 'proposal',
    lastContactedAt: '2026-07-01T06:00:00.000Z',
    nextContactAt: '2026-07-04T02:00:00.000Z',
    monthlyPremium: 120_000,
    totalPremium: 4_320_000,
    riskTags: ['건강고지'],
    priority: 'vip',
    createdAt: '2026-05-11T00:00:00.000Z',
    activities: [
      act('a-1002-2', 'proposal', '건강보험 제안서 발송', '2026-07-01T06:00:00.000Z'),
      act('a-1002-1', 'meeting', '기존 실손 리뷰 미팅', '2026-06-18T07:00:00.000Z')
    ],
    memos: [memo('m-1002-1', '기존 고객 소개 여력 높음. 제안 수락 시 가족 상담 연계.', '최지아', '2026-07-01T06:20:00.000Z')],
    policies: [
      { id: 'p-1002-1', name: 'SJ 실손의료비', type: '실손', premium: 38_000, coverage: '입원/통원 5천만', status: 'active' },
      { id: 'p-1002-2', name: 'SJ 건강종합', type: '건강', premium: 82_000, coverage: '3대질환 1억', status: 'proposed' }
    ]
  },
  {
    customerId: 'cus-1003',
    name: '박준호',
    phone: '010-2100-0003',
    age: 51,
    gender: 'male',
    assignedFcId: 'fc-gn1-02',
    assignedFcName: '한도윤',
    team: '강남 1팀',
    status: 'follow-up',
    source: 'DB',
    consultationStage: 'first-contact',
    lastContactedAt: '2026-06-15T01:00:00.000Z',
    nextContactAt: '2026-07-02T05:00:00.000Z',
    monthlyPremium: 0,
    totalPremium: 0,
    riskTags: ['고령', '흡연'],
    priority: 'medium',
    createdAt: '2026-06-10T00:00:00.000Z',
    activities: [act('a-1003-1', 'call', 'DB 리스트 첫 콜 — 관심 보통', '2026-06-15T01:00:00.000Z')],
    memos: [memo('m-1003-1', '오후 시간대 통화 선호. 건강 이슈로 보장 니즈 존재.', '한도윤', '2026-06-15T01:15:00.000Z')],
    policies: []
  },
  {
    customerId: 'cus-1004',
    name: '이하은',
    phone: '010-2100-0004',
    age: 29,
    gender: 'female',
    assignedFcId: 'fc-gn1-02',
    assignedFcName: '한도윤',
    team: '강남 1팀',
    status: 'lead',
    source: 'online',
    consultationStage: 'first-contact',
    lastContactedAt: null,
    nextContactAt: '2026-07-02T08:00:00.000Z',
    monthlyPremium: 0,
    totalPremium: 0,
    riskTags: ['사회초년생'],
    priority: 'low',
    createdAt: '2026-07-01T00:00:00.000Z',
    activities: [],
    memos: [memo('m-1004-1', '온라인 상담 신청. 첫 연락 예정.', '한도윤', '2026-07-01T00:30:00.000Z')],
    policies: []
  },
  {
    customerId: 'cus-1005',
    name: '정우성',
    phone: '010-2100-0005',
    age: 47,
    gender: 'male',
    assignedFcId: 'fc-gn2-01',
    assignedFcName: '임하준',
    team: '강남 2팀',
    status: 'contracted',
    source: 'family',
    consultationStage: 'contract',
    lastContactedAt: '2026-06-28T04:00:00.000Z',
    nextContactAt: '2026-08-01T01:00:00.000Z',
    monthlyPremium: 260_000,
    totalPremium: 9_360_000,
    riskTags: ['가장책임', '고액자산'],
    priority: 'vip',
    createdAt: '2026-03-02T00:00:00.000Z',
    activities: [
      act('a-1005-2', 'contract', '종신보험 계약 체결', '2026-06-28T04:00:00.000Z'),
      act('a-1005-1', 'meeting', '클로징 미팅 — 배우자 동석', '2026-06-24T06:00:00.000Z')
    ],
    memos: [memo('m-1005-1', '가족 단위 리모델링 완료. 자녀 보험 추가 제안 여지.', '임하준', '2026-06-28T04:30:00.000Z')],
    policies: [
      { id: 'p-1005-1', name: 'SJ 평생종신', type: '종신', premium: 180_000, coverage: '사망 3억', status: 'active' },
      { id: 'p-1005-2', name: 'SJ 연금저축', type: '연금', premium: 80_000, coverage: '노후연금', status: 'active' }
    ]
  },
  {
    customerId: 'cus-1006',
    name: '한지민',
    phone: '010-2100-0006',
    age: 38,
    gender: 'female',
    assignedFcId: 'fc-gn2-01',
    assignedFcName: '임하준',
    team: '강남 2팀',
    status: 'consulting',
    source: 'referral',
    consultationStage: 'policy-review',
    lastContactedAt: '2026-06-29T07:00:00.000Z',
    nextContactAt: '2026-07-03T06:00:00.000Z',
    monthlyPremium: 95_000,
    totalPremium: 1_140_000,
    riskTags: ['보장부족'],
    priority: 'high',
    createdAt: '2026-06-05T00:00:00.000Z',
    activities: [
      act('a-1006-2', 'meeting', '보유 증권 분석 — 보장 공백 확인', '2026-06-29T07:00:00.000Z'),
      act('a-1006-1', 'call', '소개 고객 첫 통화', '2026-06-12T02:00:00.000Z')
    ],
    memos: [memo('m-1006-1', '실손만 보유. 진단비 보강 니즈 큼.', '임하준', '2026-06-29T07:20:00.000Z')],
    policies: [{ id: 'p-1006-1', name: 'SJ 실손의료비', type: '실손', premium: 32_000, coverage: '입원/통원 5천만', status: 'active' }]
  },
  {
    customerId: 'cus-1007',
    name: '오세훈',
    phone: '010-2100-0007',
    age: 60,
    gender: 'male',
    assignedFcId: 'fc-gn2-01',
    assignedFcName: '임하준',
    team: '강남 2팀',
    status: 'dormant',
    source: 'DB',
    consultationStage: 'first-contact',
    lastContactedAt: '2026-04-02T01:00:00.000Z',
    nextContactAt: null,
    monthlyPremium: 0,
    totalPremium: 0,
    riskTags: ['고령', '무응답'],
    priority: 'low',
    createdAt: '2026-02-18T00:00:00.000Z',
    activities: [act('a-1007-1', 'call', '초기 콜 후 응답 없음', '2026-04-02T01:00:00.000Z')],
    memos: [memo('m-1007-1', '수 차례 무응답. 장기 휴면 처리.', '임하준', '2026-05-01T01:00:00.000Z')],
    policies: []
  },
  {
    customerId: 'cus-1008',
    name: '김태리',
    phone: '010-2100-0008',
    age: 33,
    gender: 'female',
    assignedFcId: 'fc-tl-gn1',
    assignedFcName: '박민서',
    team: '강남 1팀',
    status: 'active',
    source: 'company-campaign',
    consultationStage: 'closing',
    lastContactedAt: '2026-07-01T02:00:00.000Z',
    nextContactAt: '2026-07-02T07:00:00.000Z',
    monthlyPremium: 140_000,
    totalPremium: 1_680_000,
    riskTags: ['맞벌이', '자녀2'],
    priority: 'high',
    createdAt: '2026-06-14T00:00:00.000Z',
    activities: [
      act('a-1008-2', 'call', '클로징 통화 — 계약 의사 확인', '2026-07-01T02:00:00.000Z'),
      act('a-1008-1', 'meeting', '캠페인 세미나 후 개별 상담', '2026-06-20T08:00:00.000Z')
    ],
    memos: [memo('m-1008-1', '자녀 교육 + 본인 건강 패키지 선호. 내일 계약 예정.', '박민서', '2026-07-01T02:30:00.000Z')],
    policies: [{ id: 'p-1008-1', name: 'SJ 자녀사랑', type: '저축', premium: 60_000, coverage: '교육자금', status: 'proposed' }]
  },
  {
    customerId: 'cus-1009',
    name: '서지우',
    phone: '010-2100-0009',
    age: 45,
    gender: 'male',
    assignedFcId: 'fc-bd-tl',
    assignedFcName: '서지호',
    team: '분당 1팀',
    status: 'follow-up',
    source: 'walk-in',
    consultationStage: 'needs-analysis',
    lastContactedAt: '2026-06-25T03:00:00.000Z',
    nextContactAt: '2026-07-02T02:00:00.000Z',
    monthlyPremium: 0,
    totalPremium: 0,
    riskTags: ['자영업', '소득변동'],
    priority: 'medium',
    createdAt: '2026-06-24T00:00:00.000Z',
    activities: [act('a-1009-1', 'meeting', '지점 방문 상담 — 사업자 보장 관심', '2026-06-25T03:00:00.000Z')],
    memos: [memo('m-1009-1', '자영업 소득보장 니즈. 견적 재방문 약속.', '서지호', '2026-06-25T03:20:00.000Z')],
    policies: []
  },
  {
    customerId: 'cus-1010',
    name: '문가영',
    phone: '010-2100-0010',
    age: 27,
    gender: 'female',
    assignedFcId: 'fc-bd-tl',
    assignedFcName: '서지호',
    team: '분당 1팀',
    status: 'lost',
    source: 'online',
    consultationStage: 'proposal',
    lastContactedAt: '2026-06-10T05:00:00.000Z',
    nextContactAt: null,
    monthlyPremium: 0,
    totalPremium: 0,
    riskTags: ['가격민감'],
    priority: 'low',
    createdAt: '2026-05-28T00:00:00.000Z',
    activities: [act('a-1010-1', 'proposal', '제안 후 타사 선택', '2026-06-10T05:00:00.000Z')],
    memos: [memo('m-1010-1', '가격 비교 후 타사 계약. 추후 리마케팅 후보.', '서지호', '2026-06-11T05:00:00.000Z')],
    policies: []
  }
]

export const customerSeed: CustomerSnapshot = {
  customers: SPECS.map<CustomerRecord>((spec) => ({
    ...spec,
    memoCount: spec.memos.length,
    activityCount: spec.activities.length,
    policyCount: spec.policies.length,
    updatedAt: T
  })),
  selectedCustomerId: 'cus-1002',
  eventLog: []
}
