/**
 * Commercial staff data models (shared contract).
 *
 * These are the canonical shapes that will move from local/mock data to a shared
 * backend + database. They are storage/transport agnostic — the same interfaces
 * back the current local-mock repositories and the future server API. No secrets,
 * no server URLs here.
 */

export type StaffRole = 'owner' | 'admin' | 'team-leader' | 'fc'

export interface StaffUser {
  id: string
  name: string
  role: StaffRole
  teamId?: string
  teamName?: string
  phone?: string
  email?: string
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

export interface AttendanceRecord {
  id: string
  staffId: string
  staffName: string
  type: 'check-in' | 'check-out'
  status: 'normal' | 'late' | 'early-leave' | 'missing'
  timestamp: string
  photoUrl?: string
  watermarkText?: string
  /** 오늘의 다짐 (출근 시 필수 입력). */
  memo?: string
  /** 지각 벌금(원) — 평일 9시 초과 5만 / 11시 초과 10만 / 12시 초과 20만. */
  lateFee?: number
  /** 촬영 위치의 역지오코딩 주소. */
  address?: string
}

export type CustomerStatus =
  | 'new'
  | 'contacted'
  | 'consulting'
  | 'proposal'
  | 'closing'
  | 'contracted'
  | 'lost'

export interface CustomerRecord {
  id: string
  ownerStaffId: string
  ownerStaffName: string
  teamId?: string
  name: string
  phone?: string
  birthDate?: string
  address?: string
  source?: string
  status: CustomerStatus
  tags: string[]
  memo?: string
  /** 주민등록번호 (000000-0000000) — 나이·성별·생년월일 자동 계산에 사용. */
  rrn?: string
  /** 병력 (보험 심사 참고). */
  medicalHistory?: string
  heightCm?: number
  weightKg?: number
  /** 가족 묶음 — 세대주 고객의 id를 공유. */
  householdId?: string
  /** 세대주와의 관계: 본인/배우자/자녀/부모/기타. */
  relation?: string
  /** 첨부(사진·PDF) — Storage 경로 목록 (최대 5개). */
  attachments: CustomerAttachment[]
  /** 고객등록 완료된 보험사 목록 (관리자 처리 시 병합). */
  registeredInsurers: string[]
  createdAt: string
  updatedAt: string
}

export interface CustomerAttachment {
  path: string
  name: string
  kind: 'image' | 'pdf'
}

export interface ConsultationRecord {
  id: string
  customerId: string
  staffId: string
  staffName: string
  consultationType: 'first' | 'follow-up' | 'proposal' | 'closing' | 'aftercare'
  status: 'planned' | 'completed' | 'cancelled'
  summary: string
  nextAction?: string
  scheduledAt?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ScheduleEvent {
  id: string
  staffId: string
  staffName: string
  customerId?: string
  title: string
  /** 영업 프로세스 유형 9종 (구버전 4종은 기존 행 호환용으로만 유지). */
  type:
    | 'ap'
    | 'meeting-1'
    | 'meeting-2'
    | 'meeting-3'
    | 'closing'
    | 'delivery'
    | 'intro-meeting'
    | 'meeting'
    | 'personal'
    | 'consultation'
    | 'contract'
    | 'follow-up'
    | 'internal'
  startsAt: string
  endsAt?: string
  status: 'planned' | 'done' | 'cancelled'
  memo?: string
  /** 만남 장소/주소 — 폰에서 네비(카카오맵·티맵) 연결에 사용. */
  location?: string
  /** 고객관리에 없는 고객의 직접 입력 이름 (customerId 없을 때). */
  manualCustomerName?: string
  /** 메모 저장 시 AI 비서 분석(요약·할일·다음 일정 제안). */
  aiBrief?: ScheduleAiBrief
}

/** 미팅 메모 AI 분석 결과 (meeting-brief edge function 응답). */
export interface ScheduleAiBrief {
  summary: string
  todos: string[]
  next?: {
    /** 제안 일정 유형 키 (예: meeting-2). */
    type: string
    /** 사람이 읽는 제안 문구 (예: 다음 주 화 19:00 2차만남). */
    suggestion: string
  }
}

export interface PerformanceRecord {
  id: string
  staffId: string
  staffName: string
  teamId?: string
  month: string // YYYY-MM
  lifePremium?: number
  nonLifePremium?: number
  shortTermPremium?: number
  totalPremium: number
  contractCount: number
  createdAt: string
  updatedAt: string
}

export interface NoticeRecord {
  id: string
  title: string
  content: string
  targetRoles: StaffRole[]
  createdBy: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}
