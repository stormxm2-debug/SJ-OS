import {
  ORDERED_STAGES,
  type Consultation,
  type ConsultationChecklistItem,
  type ConsultationFlowStage,
  type ConsultationNote,
  type ConsultationSnapshot,
  type ConsultationStatus,
  type StageEntry
} from './types'

/**
 * Realistic — but entirely fictional — seed data for the SJ Invest consultation
 * flows. Customers, FCs and teams reuse the Customer Workspace / FC OS seeds;
 * all data is mock only, with no real personal or sensitive information. Seeds a
 * spread of consultations at different stages — from a fresh 1차 미팅 to a won
 * contract in after-care — so the funnel and detail views read coherently.
 */

/** Build the stage list for a consultation at a given current stage. */
function buildStages(current: ConsultationFlowStage, won: boolean): StageEntry[] {
  const currentIndex = ORDERED_STAGES.indexOf(current)
  return ORDERED_STAGES.map<StageEntry>((stage, index) => {
    if (index < currentIndex) {
      return { stage, status: 'done', completedAt: '2026-06-25T00:00:00.000Z', note: '' }
    }
    if (index === currentIndex) {
      return {
        stage,
        status: won ? 'done' : 'active',
        completedAt: won ? '2026-07-01T00:00:00.000Z' : null,
        note: ''
      }
    }
    return { stage, status: 'pending', completedAt: null, note: '' }
  })
}

let checklistSeq = 0
function checklist(labels: string[], doneCount: number): ConsultationChecklistItem[] {
  return labels.map((label, index) => {
    checklistSeq += 1
    return { id: `chk-${checklistSeq}`, label, done: index < doneCount }
  })
}

const DEFAULT_CHECKLIST = [
  '고객 기본정보 확인',
  '재무상황/니즈 청취',
  '보유 증권 분석',
  '설계안 제안',
  '청약 서류 준비',
  '계약 체결',
  '증권 전달 및 사후관리 안내'
]

let noteSeq = 0
function note(author: string, text: string, createdAt: string): ConsultationNote {
  noteSeq += 1
  return { id: `note-${noteSeq}`, author, text, createdAt }
}

interface Spec {
  consultationId: string
  customerId: string
  customerName: string
  fcId: string
  fcName: string
  team: string
  status: ConsultationStatus
  current: ConsultationFlowStage
  doneChecklist: number
  nextAction: string
  nextActionAt: string | null
  notes: ConsultationNote[]
}

const SPECS: Spec[] = [
  {
    consultationId: 'con-5001',
    customerId: 'cus-1001',
    customerName: '강민준',
    fcId: 'fc-gn1-01',
    fcName: '최지아',
    team: '강남 1팀',
    status: 'active',
    current: 'needs-analysis',
    doneChecklist: 2,
    nextAction: '교육자금 설계안 초안 작성',
    nextActionAt: '2026-07-02T07:00:00.000Z',
    notes: [
      note('최지아', '가족 재무 상황 파악 완료. 교육자금 + 보장성 니즈 확인.', '2026-06-22T06:00:00.000Z'),
      note('최지아', '배우자 동반 상담 선호. 2차는 저녁 시간대 조율.', '2026-06-26T09:00:00.000Z')
    ]
  },
  {
    consultationId: 'con-5002',
    customerId: 'cus-1002',
    customerName: '윤서연',
    fcId: 'fc-gn1-01',
    fcName: '최지아',
    team: '강남 1팀',
    status: 'active',
    current: 'closing',
    doneChecklist: 4,
    nextAction: '클로징 미팅 후 청약 진행',
    nextActionAt: '2026-07-02T02:00:00.000Z',
    notes: [
      note('최지아', '건강종합 제안 수락 긍정적. 클로징 일정 협의 완료.', '2026-07-01T06:30:00.000Z')
    ]
  },
  {
    consultationId: 'con-5003',
    customerId: 'cus-1005',
    customerName: '정우성',
    fcId: 'fc-gn2-01',
    fcName: '임하준',
    team: '강남 2팀',
    status: 'won',
    current: 'after-care',
    doneChecklist: 7,
    nextAction: '자녀 보험 추가 제안 준비',
    nextActionAt: '2026-08-01T01:00:00.000Z',
    notes: [
      note('임하준', '평생종신 + 연금 계약 체결 완료. 가족 단위 리모델링 완료.', '2026-06-28T05:00:00.000Z')
    ]
  },
  {
    consultationId: 'con-5004',
    customerId: 'cus-1006',
    customerName: '한지민',
    fcId: 'fc-gn2-01',
    fcName: '임하준',
    team: '강남 2팀',
    status: 'active',
    current: 'policy-review',
    doneChecklist: 3,
    nextAction: '진단비 보강 제안서 작성',
    nextActionAt: '2026-07-02T09:00:00.000Z',
    notes: [
      note('임하준', '실손만 보유. 진단비 니즈 큼. 증권 분석 진행중.', '2026-07-02T06:00:00.000Z')
    ]
  },
  {
    consultationId: 'con-5005',
    customerId: 'cus-1008',
    customerName: '김태리',
    fcId: 'fc-tl-gn1',
    fcName: '박민서',
    team: '강남 1팀',
    status: 'active',
    current: 'closing',
    doneChecklist: 5,
    nextAction: '자녀사랑 + 건강 패키지 청약 진행',
    nextActionAt: '2026-07-03T07:00:00.000Z',
    notes: [
      note('박민서', '계약 의사 확인됨. 내일 클로징 예정.', '2026-07-01T00:00:00.000Z')
    ]
  },
  {
    consultationId: 'con-5006',
    customerId: 'cus-1009',
    customerName: '서지우',
    fcId: 'fc-bd-tl',
    fcName: '서지호',
    team: '분당 1팀',
    status: 'on-hold',
    current: 'second-meeting',
    doneChecklist: 1,
    nextAction: '재방문 일정 재조율',
    nextActionAt: '2026-07-04T02:00:00.000Z',
    notes: [
      note('서지호', '자영업 소득보장 니즈. 고객 일정 사유로 2차 연기.', '2026-06-30T02:00:00.000Z')
    ]
  },
  {
    consultationId: 'con-5007',
    customerId: 'cus-1004',
    customerName: '이하은',
    fcId: 'fc-gn1-02',
    fcName: '한도윤',
    team: '강남 1팀',
    status: 'active',
    current: 'first-meeting',
    doneChecklist: 0,
    nextAction: '1차 미팅 일정 확정',
    nextActionAt: '2026-07-02T08:30:00.000Z',
    notes: [
      note('한도윤', '온라인 상담 신청. 사회초년생 — 소액 보장 위주 설계 예상.', '2026-07-01T08:00:00.000Z')
    ]
  }
]

export const consultationSeed: ConsultationSnapshot = {
  consultations: SPECS.map<Consultation>((spec) => ({
    consultationId: spec.consultationId,
    customerId: spec.customerId,
    customerName: spec.customerName,
    fcId: spec.fcId,
    fcName: spec.fcName,
    team: spec.team,
    status: spec.status,
    currentStage: spec.current,
    stages: buildStages(spec.current, spec.status === 'won'),
    checklist: checklist(DEFAULT_CHECKLIST, spec.doneChecklist),
    notes: spec.notes,
    nextAction: spec.nextAction,
    nextActionAt: spec.nextActionAt,
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z'
  })),
  selectedConsultationId: 'con-5002',
  eventLog: []
}
