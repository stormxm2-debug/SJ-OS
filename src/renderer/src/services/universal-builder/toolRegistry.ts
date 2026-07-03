import type { AiToolConnector, AiToolId } from './types'

/**
 * AI Tool Connector Registry — the local catalogue of external AI tools SJ OS
 * can plan to orchestrate for a build project.
 *
 * IMPORTANT: these are PLANNED adapters, not active integrations. No entry makes
 * a real API call in this sprint. Each tool records its official-API status and
 * required credentials so that the CEO/CTO can verify and activate it later,
 * per tool, before any real integration is wired. No credentials are stored
 * here and none belong in the renderer.
 */
export const AI_TOOL_REGISTRY: AiToolConnector[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'llm',
    status: 'planned',
    officialApiStatus: 'official',
    purpose: 'reasoning, copywriting, planning, STT/TTS if configured',
    requiredCredentials: ['OPENAI_API_KEY (backend/main process only)'],
    supportedActions: ['chat', 'reasoning', 'copywriting', 'planning', 'stt', 'tts'],
    riskLevel: 'medium',
    notes: '키는 Electron Main / 백엔드에만 저장. 렌더러에 노출 금지. 본 스프린트에서는 실제 호출 없음.'
  },
  {
    id: 'gemini',
    name: 'Gemini',
    category: 'llm',
    status: 'not-configured',
    officialApiStatus: 'official',
    purpose: 'alternative LLM, multimodal analysis, image/video understanding',
    requiredCredentials: ['GEMINI_API_KEY (backend only)'],
    supportedActions: ['chat', 'multimodal-analysis', 'image-understanding', 'video-understanding'],
    riskLevel: 'medium',
    notes: '대체 LLM. 멀티모달 분석 용도. 활성화 전 공식 API/키 확인 필요.'
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    category: 'code',
    status: 'ready',
    officialApiStatus: 'official',
    purpose: 'code implementation, refactor, verification, commit',
    requiredCredentials: ['Claude Code CLI (개발자 로컬)'],
    supportedActions: ['implement', 'refactor', 'verify', 'typecheck', 'build', 'commit'],
    riskLevel: 'low',
    notes: 'SJ OS Lead Developer. 생성된 개발자 프롬프트를 붙여넣어 실제 개발을 진행.'
  },
  {
    id: 'canva',
    name: 'Canva',
    category: 'design',
    status: 'planned',
    officialApiStatus: 'uncertain',
    purpose: 'design assets, banners, social creatives, detail pages, brand templates',
    requiredCredentials: ['Canva Connect API (승인 필요)'],
    supportedActions: ['create-design', 'banner', 'social-creative', 'detail-page', 'brand-template'],
    riskLevel: 'medium',
    notes: '배너/상세페이지/브랜드 템플릿 자산 생성. 공식 API 승인 상태 확인 필요.'
  },
  {
    id: 'gamma',
    name: 'Gamma',
    category: 'document',
    status: 'planned',
    officialApiStatus: 'uncertain',
    purpose: 'presentations, proposals, documents, landing-style content',
    requiredCredentials: ['Gamma API (확인 필요)'],
    supportedActions: ['presentation', 'proposal', 'document', 'landing-content'],
    riskLevel: 'medium',
    notes: '제안서/발표자료/문서 자동 생성. 공식 API 제공 여부 확인 필요.'
  },
  {
    id: 'kling',
    name: 'Kling',
    category: 'video',
    status: 'planned',
    officialApiStatus: 'uncertain',
    purpose: 'AI video/image generation',
    requiredCredentials: ['Kling API (확인 필요)'],
    supportedActions: ['text-to-video', 'image-to-video', 'image-generation'],
    riskLevel: 'high',
    notes: 'AI 영상/이미지 생성. 공식 API/사용 약관 확인 필요. 비용/저작권 주의.'
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'knowledge',
    status: 'planned',
    officialApiStatus: 'official',
    purpose: 'project docs, databases, task boards, knowledge base',
    requiredCredentials: ['NOTION_TOKEN (backend only)', 'Notion database id'],
    supportedActions: ['create-page', 'update-database', 'task-board', 'knowledge-base'],
    riskLevel: 'low',
    notes: '프로젝트 문서/데이터베이스/작업 보드. 공식 API 존재.'
  },
  {
    id: 'suno',
    name: 'Suno',
    category: 'audio',
    status: 'planned',
    officialApiStatus: 'uncertain',
    purpose: 'music/audio generation',
    requiredCredentials: ['Suno API (미확인)'],
    supportedActions: ['music-generation', 'background-audio'],
    riskLevel: 'high',
    notes: '음악/오디오 생성. 공식 API 상태 uncertain — 검증 전 비활성.'
  }
]

/** Look up a tool connector by id. */
export function getTool(id: AiToolId): AiToolConnector | undefined {
  return AI_TOOL_REGISTRY.find((tool) => tool.id === id)
}
