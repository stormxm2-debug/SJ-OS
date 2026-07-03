import type { AiToolAssignment, AiToolId } from './types'
import type { AppPlan } from './planningEngine'
import { getTool } from './toolRegistry'

/**
 * Shopping Automation template — the focused plan applied when a CEO build
 * command is about automating a shopping mall / commerce operation
 * ("쇼핑몰 업무 자동화해", "쇼핑몰 시스템 만들어", "쇼핑몰 자동화").
 *
 * Purely local/deterministic. It enriches the generic ecommerce plan with an
 * automation-focused module set and a specific AI-tool orchestration plan. No
 * external API is called — the tools are planned connectors only.
 */

/** True when the command targets shopping-mall / commerce automation. */
export function isShoppingAutomation(raw: string): boolean {
  const l = raw.toLowerCase()
  const shopping = ['쇼핑몰', '커머스', '이커머스', '온라인몰', '온라인 몰'].some((k) => l.includes(k))
  const automation = ['업무 자동화', '업무자동화', '쇼핑몰 자동화', '자동화'].some((k) => l.includes(k))
  // Any shopping command gets the automation focus; a bare "자동화" alone does not.
  return shopping || (automation && (l.includes('쇼핑') || l.includes('상품') || l.includes('주문')))
}

/** Automation-focused modules (spec §5). */
const MODULES = [
  '상품 관리 자동화',
  '주문 관리 자동화',
  '고객 관리',
  '재고 관리',
  '쿠폰/프로모션',
  '상세페이지 자동 제작',
  '리뷰/문의 관리',
  '광고 소재 제작',
  '관리자 대시보드'
]

const SCREENS = [
  'dashboard',
  '상품 관리',
  '주문 관리',
  '재고 현황',
  '상세페이지 스튜디오',
  '광고 소재 스튜디오',
  '리뷰/문의 보드',
  '프로모션 관리',
  'settings'
]

const DATA_MODELS = [
  'Product',
  'Order',
  'OrderItem',
  'Customer',
  'InventoryItem',
  'Coupon',
  'DetailPage',
  'AdCreative',
  'Review',
  'AutomationWorkflow'
]

const INTEGRATIONS = ['OpenAI', 'Canva', 'Gamma', 'Notion', 'Kling', 'Suno']

/** Return the shopping-automation plan, overriding the generic ecommerce plan. */
export function shoppingAutomationPlan(): AppPlan {
  return {
    requiredModules: [...MODULES],
    suggestedScreens: [...SCREENS],
    suggestedDataModels: [...DATA_MODELS],
    suggestedIntegrations: [...INTEGRATIONS],
    assumptions: [
      '쇼핑몰 업무 자동화에 초점을 맞춘 커머스 시스템으로 해석했습니다.',
      '결제/배송/외부 광고 연동은 첫 프롬프트에서 자리 표시(placeholder)로만 두고, 실제 연동은 별도 승인 후 진행합니다.'
    ]
  }
}

/** Per-tool roles for the shopping-automation AI orchestration (spec §5). */
const TOOL_ROLES: Array<{ toolId: AiToolId; role: string }> = [
  { toolId: 'claude-code', role: '앱 모듈/화면/데이터 모델 실제 구현, 검증, 커밋' },
  { toolId: 'openai', role: '기획 · 카피 · 자동응답' },
  { toolId: 'canva', role: '배너 · 상세페이지 디자인' },
  { toolId: 'gamma', role: '제안서 · 소개서' },
  { toolId: 'notion', role: '작업보드 · 기획서' },
  { toolId: 'kling', role: '영상 광고' },
  { toolId: 'suno', role: '배경음악 (공식 API 확인 필요)' }
]

/** Build the shopping-automation AI-tool plan (planned connectors, none active). */
export function shoppingAutomationToolPlan(): AiToolAssignment[] {
  return TOOL_ROLES.map(({ toolId, role }) => {
    const tool = getTool(toolId)
    if (!tool) return null
    return {
      toolId: tool.id,
      toolName: tool.name,
      role,
      status: tool.status,
      officialApiStatus: tool.officialApiStatus
    }
  }).filter((a): a is AiToolAssignment => a !== null)
}
