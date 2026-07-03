import type { SprintPlanEntry, UniversalAppType } from './types'
import { APP_TYPE_LABEL } from './appTypeClassifier'

/**
 * Universal Planning Engine — deterministic, local plan generation.
 *
 * For each build command it produces a structured first plan (modules, screens,
 * data models, suggested integrations) without any external API call. For
 * unknown/custom commands it asks NO blocking question — it creates a reasonable
 * first plan and marks its assumptions clearly.
 */

export interface AppPlan {
  requiredModules: string[]
  suggestedScreens: string[]
  suggestedDataModels: string[]
  suggestedIntegrations: string[]
  /** Non-empty only for custom/unknown — assumptions the plan made. */
  assumptions: string[]
}

interface PlanTemplate {
  modules: string[]
  screens: string[]
  dataModels: string[]
  integrations: string[]
}

/** Content/marketing shares the same module backbone (spec §3). */
const CONTENT_MARKETING_TEMPLATE: PlanTemplate = {
  modules: [
    'campaign brief',
    'content calendar',
    'design request',
    'video request',
    'landing page',
    'asset library',
    'approval workflow'
  ],
  screens: ['dashboard', 'campaign board', 'content calendar', 'asset library', 'request detail', 'approval queue', 'settings'],
  dataModels: ['Campaign', 'ContentItem', 'DesignRequest', 'VideoRequest', 'Asset', 'ApprovalStep'],
  integrations: ['OpenAI', 'Canva', 'Gamma', 'Kling', 'Notion']
}

const TEMPLATES: Record<UniversalAppType, PlanTemplate> = {
  ecommerce: {
    modules: [
      'product management',
      'category management',
      'cart',
      'order management',
      'customer management',
      'payment placeholder',
      'shipping placeholder',
      'coupon/promotion',
      'admin dashboard',
      'analytics'
    ],
    screens: ['dashboard', 'product list', 'product detail', 'cart', 'order list', 'customer list', 'promotion manager', 'settings'],
    dataModels: ['Product', 'Category', 'Customer', 'Order', 'OrderItem', 'Payment', 'Shipment', 'Coupon'],
    integrations: ['OpenAI', 'Canva', 'Notion', 'Gamma']
  },
  education: {
    modules: [
      'student management',
      'class management',
      'attendance',
      'payment',
      'consultation',
      'schedule',
      'teacher dashboard'
    ],
    screens: ['dashboard', 'student list', 'class list', 'attendance board', 'schedule', 'payment list', 'consultation log', 'settings'],
    dataModels: ['Student', 'Class', 'Attendance', 'Payment', 'Consultation', 'ScheduleSlot', 'Teacher'],
    integrations: ['OpenAI', 'Notion']
  },
  'hospital-reservation': {
    modules: [
      'reservation management',
      'patient management',
      'doctor/schedule management',
      'department management',
      'notification placeholder',
      'consultation notes',
      'admin dashboard'
    ],
    screens: ['dashboard', 'reservation calendar', 'patient list', 'doctor schedule', 'department list', 'reservation detail', 'settings'],
    dataModels: ['Patient', 'Reservation', 'Doctor', 'Department', 'ScheduleSlot', 'Notification'],
    integrations: ['OpenAI', 'Notion']
  },
  crm: {
    modules: [
      'contact management',
      'lead/pipeline management',
      'activity log',
      'task management',
      'deal management',
      'reporting',
      'admin dashboard'
    ],
    screens: ['dashboard', 'contact list', 'pipeline board', 'activity log', 'deal detail', 'reports', 'settings'],
    dataModels: ['Contact', 'Lead', 'Deal', 'Activity', 'Task', 'Note'],
    integrations: ['OpenAI', 'Notion', 'Gamma']
  },
  'real-estate': {
    modules: [
      'listing management',
      'client management',
      'inquiry management',
      'viewing schedule',
      'contract placeholder',
      'admin dashboard'
    ],
    screens: ['dashboard', 'listing list', 'listing detail', 'client list', 'inquiry board', 'schedule', 'settings'],
    dataModels: ['Listing', 'Client', 'Inquiry', 'Viewing', 'Contract', 'Agent'],
    integrations: ['OpenAI', 'Canva', 'Notion']
  },
  insurance: {
    modules: [
      'customer management',
      'policy/analysis management',
      'consultation',
      'activity management',
      'schedule',
      'performance',
      'admin dashboard'
    ],
    screens: ['dashboard', 'customer list', 'policy analysis', 'consultation log', 'activity board', 'schedule', 'performance', 'settings'],
    dataModels: ['Customer', 'Policy', 'Consultation', 'Activity', 'ScheduleSlot', 'PerformanceRecord'],
    integrations: ['OpenAI', 'Notion']
  },
  'marketing-automation': CONTENT_MARKETING_TEMPLATE,
  'content-production': CONTENT_MARKETING_TEMPLATE,
  'internal-dashboard': {
    modules: [
      'data overview',
      'metric management',
      'user/role management',
      'report builder',
      'notification placeholder',
      'admin settings'
    ],
    screens: ['dashboard', 'metrics', 'reports', 'user list', 'settings'],
    dataModels: ['Metric', 'Report', 'User', 'Role', 'DataSource'],
    integrations: ['OpenAI', 'Notion']
  },
  custom: {
    modules: [
      'core domain management',
      'user management',
      'record management',
      'workflow/status tracking',
      'admin dashboard',
      'settings'
    ],
    screens: ['dashboard', 'record list', 'record detail', 'user list', 'settings'],
    dataModels: ['User', 'Record', 'Category', 'ActivityLog'],
    integrations: ['OpenAI', 'Notion']
  }
}

/** Build a local plan for a given app type. */
export function buildPlan(appType: UniversalAppType): AppPlan {
  const template = TEMPLATES[appType] ?? TEMPLATES.custom
  const assumptions =
    appType === 'custom'
      ? [
          '명확한 도메인을 감지하지 못해 일반적인 관리형 앱 구조를 가정했습니다.',
          '핵심 엔티티는 User/Record 중심으로 시작하며, 실제 도메인에 맞춰 조정이 필요합니다.',
          '외부 연동은 우선 OpenAI(기획/카피)와 Notion(문서화)만 가정했습니다.'
        ]
      : []
  return {
    requiredModules: [...template.modules],
    suggestedScreens: [...template.screens],
    suggestedDataModels: [...template.dataModels],
    suggestedIntegrations: [...template.integrations],
    assumptions
  }
}

/** Build a local interpreted goal sentence for the project. */
export function interpretGoal(raw: string, appType: UniversalAppType): string {
  const label = APP_TYPE_LABEL[appType]
  return `CEO 명령 "${raw.trim()}" 을(를) ${label} 구축 프로젝트로 해석했습니다. 로컬-우선(mock) 구조로 핵심 모듈과 화면, 데이터 모델을 먼저 설계하고, 외부 AI 도구는 계획 단계에서 연결 지점만 표시합니다.`
}

/**
 * Generate a small, deterministic 3-sprint delivery plan. Sprint 1 always lays
 * the foundation (data models + core CRUD), Sprint 2 the primary experience,
 * Sprint 3 the AI-tool integration placeholders. IDs are stamped by the caller.
 */
export function buildSprintPlan(
  appType: UniversalAppType,
  plan: AppPlan,
  makeId: (prefix: string) => string
): SprintPlanEntry[] {
  const label = APP_TYPE_LABEL[appType]
  const foundationModules = plan.requiredModules.slice(0, 3)
  const experienceScreens = plan.suggestedScreens.slice(0, 4)
  return [
    {
      id: makeId('sprint'),
      name: 'Sprint 1 — Foundation',
      goal: `${label}의 데이터 모델과 핵심 CRUD를 로컬 상태 기반으로 구축`,
      deliverables: [
        `데이터 모델: ${plan.suggestedDataModels.join(', ')}`,
        `핵심 모듈: ${foundationModules.join(', ')}`,
        '로컬 저장/상태 관리 + 타입 정의'
      ]
    },
    {
      id: makeId('sprint'),
      name: 'Sprint 2 — Experience',
      goal: '주요 화면과 사용자 흐름 구현',
      deliverables: [
        `핵심 화면: ${experienceScreens.join(', ')}`,
        '목록/상세/편집 UX + 대시보드',
        '기존 SJ OS 다크 스타일과 일관성 유지'
      ]
    },
    {
      id: makeId('sprint'),
      name: 'Sprint 3 — AI Integration Placeholders',
      goal: '외부 AI 도구 연결 지점(placeholder)과 승인 흐름 준비',
      deliverables: [
        `AI 도구 연동 자리 표시: ${plan.suggestedIntegrations.join(', ')}`,
        '각 도구별 공식 API/키 상태 확인 후 실제 연동 (별도 승인)',
        '분석/리포트 + 마무리 다듬기'
      ]
    }
  ]
}
