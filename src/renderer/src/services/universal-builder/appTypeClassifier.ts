import type { UniversalAppType, UniversalRiskLevel } from './types'

/**
 * Local app-type classifier for universal build commands. No AI/API — pure
 * Korean/English keyword matching. Given "쇼핑몰 시스템 만들어" it resolves the
 * business domain (ecommerce), a human-readable industry + target users, a
 * default project name, and a risk/approval assessment.
 */

interface AppTypeRule {
  appType: UniversalAppType
  industry: string
  targetUsers: string
  keys: string[]
}

/** Ordered so more specific domains win before generic ones. */
const APP_TYPE_RULES: AppTypeRule[] = [
  {
    appType: 'hospital-reservation',
    industry: '의료 · 병원',
    targetUsers: '환자, 병원 접수/원무 담당자, 의료진',
    keys: ['병원', '예약 시스템', '예약시스템', '진료 예약', '진료예약', '클리닉', '의원', '치과', '한의원', '병원 예약']
  },
  {
    appType: 'education',
    industry: '교육 · 학원',
    targetUsers: '학생, 학부모, 강사, 학원 관리자',
    keys: ['학원', '교육', '강의', '수업', '학생 관리', '학생관리', 'lms', '클래스 관리', '수강', '출결']
  },
  {
    appType: 'real-estate',
    industry: '부동산 · 중개',
    targetUsers: '중개인, 임대인, 임차인, 매수/매도자',
    keys: ['부동산', '매물', '중개', '임대 관리', '임대관리', '분양']
  },
  {
    appType: 'content-production',
    industry: '콘텐츠 · 크리에이티브 제작',
    targetUsers: '마케터, 디자이너, 콘텐츠 제작자, 광고 담당자',
    keys: ['상세페이지', '상세 페이지', '영상 광고', '영상광고', '영상 제작', '콘텐츠 제작', '자동 제작', '자동제작', '썸네일', '광고 제작']
  },
  {
    appType: 'marketing-automation',
    industry: '마케팅 · 세일즈 자동화',
    targetUsers: '마케터, 세일즈, 대행사, 브랜드 담당자',
    keys: ['마케팅', '캠페인', '제안서', '광고 자동화', '마케팅 자동화', '콘텐츠 캘린더', '랜딩페이지', '랜딩 페이지', '뉴스레터']
  },
  {
    appType: 'ecommerce',
    industry: '커머스 · 온라인 판매',
    targetUsers: '쇼핑몰 운영자, 고객, 상품/주문 관리자',
    keys: ['쇼핑몰', '커머스', '이커머스', '온라인몰', '온라인 몰', '스토어', '상점', 'shop', 'commerce', '판매 시스템', '주문 관리']
  },
  {
    appType: 'insurance',
    industry: '보험 · 금융',
    targetUsers: 'FC, 설계사, 고객, 심사/관리자',
    keys: ['보험', '설계사', '증권', '보장', '청약', 'fc']
  },
  {
    appType: 'crm',
    industry: '영업 · 고객관계관리',
    targetUsers: '영업 담당자, 고객 관리자, 매니저',
    keys: ['crm', '고객 관리 시스템', '고객관리 시스템', '고객관계', '영업 관리', '영업관리', '리드 관리', '파이프라인']
  },
  {
    appType: 'internal-dashboard',
    industry: '사내 · 내부 운영',
    targetUsers: '임직원, 관리자, 운영팀',
    keys: ['대시보드', '사내', '내부', '관리자 페이지', '관리자페이지', '백오피스', '운영 툴', '내부 시스템']
  }
]

export interface AppTypeClassification {
  appType: UniversalAppType
  industry: string
  targetUsers: string
  projectName: string
  riskLevel: UniversalRiskLevel
  approvalRequired: boolean
}

/** Default Korean labels per app type, used for project naming + fallbacks. */
const APP_TYPE_LABEL: Record<UniversalAppType, string> = {
  ecommerce: '쇼핑몰/커머스 시스템',
  crm: 'CRM/고객관리 시스템',
  education: '학원/교육 관리 시스템',
  'hospital-reservation': '병원 예약 시스템',
  'real-estate': '부동산 관리 시스템',
  insurance: '보험 업무 시스템',
  'marketing-automation': '마케팅 자동화 시스템',
  'content-production': '콘텐츠/광고 제작 시스템',
  'internal-dashboard': '사내 대시보드/백오피스',
  custom: '맞춤형 비즈니스 시스템'
}

/** Keywords that make a build high-risk and approval-gated. */
const HIGH_RISK_MARKERS = ['결제', 'payment', '개인정보', '의료', '병원', '진료', '금융', '보안', '데이터베이스', '외부 연동', 'api 연동']

/** App types whose data is inherently sensitive → warrant approval. */
const SENSITIVE_APP_TYPES = new Set<UniversalAppType>(['hospital-reservation', 'insurance'])

/** App types that carry a real transaction/data surface → medium risk. */
const MEDIUM_RISK_APP_TYPES = new Set<UniversalAppType>(['ecommerce', 'crm', 'real-estate', 'marketing-automation'])

function inferProjectName(raw: string, appType: UniversalAppType): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  // Keep the CEO's own phrasing when it is short and descriptive.
  if (trimmed.length > 0 && trimmed.length <= 40) return trimmed
  return APP_TYPE_LABEL[appType]
}

/** Classify a raw universal build command into an app-type + risk profile. */
export function classifyAppType(raw: string): AppTypeClassification {
  const lowered = raw.toLowerCase()

  let matched: AppTypeRule | null = null
  for (const rule of APP_TYPE_RULES) {
    if (rule.keys.some((k) => lowered.includes(k.toLowerCase()))) {
      matched = rule
      break
    }
  }

  const appType = matched?.appType ?? 'custom'
  const industry = matched?.industry ?? '미분류 (맞춤형)'
  const targetUsers = matched?.targetUsers ?? '핵심 사용자 미정 — 첫 계획에서 가정으로 표기'

  const highRisk = HIGH_RISK_MARKERS.some((k) => lowered.includes(k)) || SENSITIVE_APP_TYPES.has(appType)
  const riskLevel: UniversalRiskLevel = highRisk
    ? 'high'
    : MEDIUM_RISK_APP_TYPES.has(appType)
      ? 'medium'
      : 'low'
  const approvalRequired = highRisk

  return {
    appType,
    industry,
    targetUsers,
    projectName: inferProjectName(raw, appType),
    riskLevel,
    approvalRequired
  }
}

export { APP_TYPE_LABEL }
