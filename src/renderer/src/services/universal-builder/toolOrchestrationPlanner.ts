import type { AiToolAssignment, AiToolId, UniversalAppType } from './types'
import { getTool } from './toolRegistry'

/**
 * Tool Orchestration Planner — suggests which external AI tools a build project
 * should use, and what each is responsible for. Purely local/deterministic; it
 * only PLANS the orchestration and never calls any tool. Every project gets
 * Claude Code (to build) + OpenAI (to plan/write); other tools are added based
 * on the app type and command keywords.
 */

interface Assignment {
  toolId: AiToolId
  role: string
}

/** Base assignments every project receives. */
function baseAssignments(): Assignment[] {
  return [
    { toolId: 'claude-code', role: '앱 모듈/화면/데이터 모델 실제 구현, 검증, 커밋' },
    { toolId: 'openai', role: '기획, 카피라이팅, 도메인 로직 설계, 사용자 흐름 초안' },
    { toolId: 'notion', role: '프로젝트 계획/작업 보드/문서화' }
  ]
}

/** Per-app-type extra tool assignments (spec §5 orchestration examples). */
const APP_TYPE_ASSIGNMENTS: Record<UniversalAppType, Assignment[]> = {
  ecommerce: [
    { toolId: 'canva', role: '배너 · 상세페이지 · 프로모션 이미지 자산' },
    { toolId: 'gamma', role: '사업/판매 제안서 (필요 시)' }
  ],
  crm: [{ toolId: 'gamma', role: '고객 제안서/리포트 문서' }],
  education: [],
  'hospital-reservation': [],
  'real-estate': [{ toolId: 'canva', role: '매물 상세/홍보 이미지 자산' }],
  insurance: [{ toolId: 'gamma', role: '보장 분석 제안서 문서' }],
  'marketing-automation': [
    { toolId: 'gamma', role: '제안서 · 발표자료 · 문서 자동 생성' },
    { toolId: 'canva', role: '비주얼 디자인 자산 · 소셜 크리에이티브' },
    { toolId: 'kling', role: '영상 소재 생성 (필요 시)' }
  ],
  'content-production': [
    { toolId: 'canva', role: '썸네일 · 상세페이지 · 배너 자산' },
    { toolId: 'kling', role: 'AI 영상/광고 영상 생성' },
    { toolId: 'suno', role: '배경 음악/오디오 (공식 API 확인 후)' },
    { toolId: 'gamma', role: '캠페인/제안 문서 (필요 시)' }
  ],
  'internal-dashboard': [],
  custom: []
}

/** Command keywords that add a specific tool regardless of app type. */
const KEYWORD_ASSIGNMENTS: Array<{ keys: string[]; toolId: AiToolId; role: string }> = [
  { keys: ['canva', '캔바', '디자인', '배너', '상세페이지', '썸네일'], toolId: 'canva', role: '디자인/이미지 자산 생성' },
  { keys: ['gamma', '감마', '제안서', '발표', '프레젠테이션', '문서'], toolId: 'gamma', role: '제안서/문서/발표자료 자동 생성' },
  { keys: ['kling', '클링', '영상', '비디오', '광고 영상'], toolId: 'kling', role: 'AI 영상/이미지 생성' },
  { keys: ['suno', '수노', '음악', '배경음악', '오디오'], toolId: 'suno', role: '음악/오디오 생성 (공식 API 확인 필요)' },
  { keys: ['notion', '노션'], toolId: 'notion', role: '프로젝트 문서/데이터베이스' },
  { keys: ['gemini', '제미나이', '제미니', '멀티모달'], toolId: 'gemini', role: '멀티모달 분석/대체 LLM' }
]

/** Turn an internal assignment into a full, registry-backed assignment. */
function toAssignment(a: Assignment): AiToolAssignment | null {
  const tool = getTool(a.toolId)
  if (!tool) return null
  return {
    toolId: tool.id,
    toolName: tool.name,
    role: a.role,
    status: tool.status,
    officialApiStatus: tool.officialApiStatus
  }
}

/** Plan the AI-tool orchestration for a project. */
export function planTools(raw: string, appType: UniversalAppType): AiToolAssignment[] {
  const lowered = raw.toLowerCase()
  const byId = new Map<AiToolId, Assignment>()

  const add = (a: Assignment): void => {
    // First assignment for a tool wins its role; keep the plan stable + ordered.
    if (!byId.has(a.toolId)) byId.set(a.toolId, a)
  }

  baseAssignments().forEach(add)
  ;(APP_TYPE_ASSIGNMENTS[appType] ?? []).forEach(add)
  KEYWORD_ASSIGNMENTS.forEach((entry) => {
    if (entry.keys.some((k) => lowered.includes(k.toLowerCase()))) {
      add({ toolId: entry.toolId, role: entry.role })
    }
  })

  return Array.from(byId.values())
    .map(toAssignment)
    .filter((a): a is AiToolAssignment => a !== null)
}
