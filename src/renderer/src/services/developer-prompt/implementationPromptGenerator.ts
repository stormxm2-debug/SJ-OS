import type { ImplementationRequest } from '@renderer/services/implementation/types'

/**
 * Implementation Prompt Generator — turns a developer command
 * ("FC OS에 팀별 필터 만들어") into a Claude Code-ready prompt the CEO can paste to
 * start real development.
 *
 * Universal build commands already generate their own prompt (see
 * universal-builder/developerPromptGenerator). This generator fills the gap for
 * in-app developer commands routed as Implementation Requests, so every CEO
 * development command yields a structured prompt packet.
 *
 * The prompt is safe by construction: NO API keys, no .env, no destructive
 * commands, and it always ends with SJ OS's verification + git + commit +
 * stop-condition steps.
 */

/** Human-readable Korean labels for target workspaces. */
const WORKSPACE_LABEL: Record<string, string> = {
  'fc-os': 'FC OS',
  customer: '고객 워크스페이스',
  'sales-activity': '영업활동 워크스페이스',
  schedule: '일정 워크스페이스',
  performance: '실적 워크스페이스',
  'team-leader': '팀장 워크스페이스',
  consultation: '상담 워크스페이스',
  'insurance-analysis': '보험분석',
  jarvis: 'Jarvis',
  autopilot: 'Autopilot',
  company: 'Live Company',
  unknown: '대상 미정'
}

/** Likely files/areas to inspect first, per target workspace. */
const INSPECT_PATHS: Record<string, string[]> = {
  'fc-os': ['src/renderer/src/pages/FcOsPage.tsx', 'src/renderer/src/services/fc/'],
  customer: ['src/renderer/src/pages/CustomerWorkspacePage.tsx', 'src/renderer/src/services/customer/'],
  'sales-activity': ['src/renderer/src/pages/SalesActivityWorkspacePage.tsx', 'src/renderer/src/services/'],
  schedule: ['src/renderer/src/pages/SchedulePage.tsx', 'src/renderer/src/services/schedule/'],
  performance: ['src/renderer/src/pages/PerformancePage.tsx', 'src/renderer/src/services/performance/'],
  'team-leader': ['src/renderer/src/pages/TeamLeaderPage.tsx', 'src/renderer/src/services/'],
  consultation: ['src/renderer/src/pages/ConsultationPage.tsx', 'src/renderer/src/services/'],
  'insurance-analysis': ['src/renderer/src/pages/InsuranceAnalysisPage.tsx', 'src/renderer/src/services/'],
  jarvis: ['src/renderer/src/components/jarvis/', 'src/renderer/src/services/jarvis/'],
  autopilot: ['src/renderer/src/pages/AutopilotPage.tsx', 'src/renderer/src/services/autopilot/'],
  company: ['src/shared/company/', 'src/renderer/src/pages/LiveCompanyPage.tsx']
}

function bullets(items: string[]): string {
  return items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '- (해당 없음)'
}

function filesToInspect(workspace: string): string[] {
  return (
    INSPECT_PATHS[workspace] ?? [
      'src/renderer/src/pages/ (해당 화면 파일)',
      'src/renderer/src/services/ (해당 도메인 서비스)',
      'src/shared/ (커널·컨트랙트·타입)'
    ]
  )
}

/** Build the full Claude Code developer prompt for an implementation request. */
export function generateImplementationPrompt(request: ImplementationRequest): string {
  const label = WORKSPACE_LABEL[request.targetWorkspace] ?? request.targetWorkspace
  const commit = `feat: ${request.title.slice(0, 60)}`

  return `# SJ OS Developer Task — ${request.title}

## Mission
${label}에 대한 CEO 개발 지시를 기존 아키텍처(Electron main / preload / renderer / shared) 규칙에 맞춰 안전하게 구현한다. 기존 보험 OS와 Universal App Builder는 그대로 유지한다.

## Target workspace
${label} (${request.targetWorkspace})

## Interpreted goal
${request.interpretedGoal}

## Original CEO command
"${request.rawUserCommand}"

## Priority / Risk
우선순위 ${request.priority} · 위험도 ${request.riskLevel}${request.approvalRequired ? ' · CEO 승인 필요' : ''}

## Required features
${bullets([
    `${label} 화면/도메인에 요청된 기능을 추가한다: ${request.title}`,
    '기존 컴포넌트·서비스·컨트랙트를 재사용하고 불필요한 재설계를 피한다.',
    '로컬-우선(mock) 구현. 외부 API 실제 호출 없음.'
  ])}

## Files to inspect first
${bullets(filesToInspect(request.targetWorkspace))}

## Safety rules (non-negotiable)
- 기존 인슈어런스 시스템(FC OS, Customer Workspace, Sales Activity, Schedule, Performance, Team Leader, Consultation, Insurance Analysis)을 제거하거나 손상시키지 말 것.
- 안정성 우선 · 작고 점진적인 변경.
- 로컬-우선(mock) 구현. 외부 API 실제 호출 없음.

## No .env / no API key rules
- API 키를 렌더러/프론트엔드에 넣지 말 것.
- .env / .env.local 을 커밋하지 말 것.
- diff에 API 키가 나타나지 않는지 확인할 것.

## Verification commands
- npm run typecheck
- npm run build

## Git add guidance
- git status --short (스테이징 전 .env / 키 / node_modules 미포함 확인)
- git add <이번 변경에 해당하는 실제 경로만>

## Commit message
${commit}

## Stop conditions
- 로그인/자격증명이 필요할 때
- git push 실패
- 파괴적 명령이 필요할 때
- typecheck/build 실패를 안전하게 고칠 수 없을 때
- 주요 아키텍처 결정이 필요할 때`
}
