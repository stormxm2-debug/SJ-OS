import type { UniversalBuildProject } from './types'

/**
 * Developer Prompt Generator — turns a planned UniversalBuildProject into a
 * Claude Code-ready prompt the CEO can paste to start real development.
 *
 * The prompt is safe by construction: it contains NO API keys, and it does NOT
 * require any external AI integration in the first pass unless explicitly
 * approved. External tools appear only as clearly-marked integration
 * placeholders. It always ends with SJ OS's verification + git + commit steps.
 */

/** Fields available before the project id exists (during initial generation). */
export type PromptSource = Omit<
  UniversalBuildProject,
  'generatedDeveloperPrompt' | 'pmPlanId' | 'approvalId' | 'routingLog' | 'status' | 'updatedAt'
>

function bullets(items: string[]): string {
  return items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '- (해당 없음)'
}

function toolLines(project: PromptSource): string {
  if (project.aiToolPlan.length === 0) return '- (외부 AI 도구 계획 없음)'
  return project.aiToolPlan
    .map(
      (t) =>
        `- ${t.toolName} — ${t.role} · [PLACEHOLDER · ${t.officialApiStatus} API · 실제 연동은 별도 승인 후]`
    )
    .join('\n')
}

function sprintLines(project: PromptSource): string {
  if (project.sprintPlan.length === 0) return '- (스프린트 계획 없음)'
  return project.sprintPlan
    .map((s) => `- ${s.name}: ${s.goal}\n  ${s.deliverables.map((d) => `· ${d}`).join('\n  ')}`)
    .join('\n')
}

/** Build the full Claude Code developer prompt for a project. */
export function generateDeveloperPrompt(project: PromptSource): string {
  const assumptionBlock =
    project.assumptions.length > 0
      ? `\n## Assumptions (custom/unknown — 확인 필요)\n${bullets(project.assumptions)}\n`
      : ''

  return `# SJ OS Universal App Build — ${project.projectName}

## Mission
${project.projectName}을(를) SJ OS 안에 로컬-우선(mock)으로 구축한다. 기존 보험 OS는 그대로 유지하고, 새 도메인 모듈을 기존 아키텍처(Electron main / preload / renderer / shared) 규칙에 맞춰 추가한다.

## App type
${project.appType}  ·  Industry: ${project.industry}  ·  Target users: ${project.targetUsers}

## Interpreted goal
${project.interpretedGoal}

## Original CEO command
"${project.originalCommand}"
${assumptionBlock}
## Modules to build
${bullets(project.requiredModules)}

## Screens to build
${bullets(project.suggestedScreens)}

## Data models
${bullets(project.suggestedDataModels)}

## AI tool integration placeholders (do NOT wire real APIs yet)
${toolLines(project)}

## Sprint plan
${sprintLines(project)}

## Safety rules (non-negotiable)
- 기존 인슈어런스 시스템(FC OS, Customer Workspace, Sales Activity, Schedule, Performance, Team Leader, Consultation, Insurance Analysis)을 제거하거나 손상시키지 말 것.
- 로컬-우선(mock) 구현. 외부 API 실제 호출 없음. 첫 프롬프트에서는 통합 자리 표시(placeholder)만.
- API 키를 렌더러/프론트엔드에 넣지 말 것. .env / .env.local 커밋 금지.
- 파괴적 명령 금지. force push 금지.
- 기존 모듈/컨트랙트 재사용, 불필요한 재설계 금지.

## Verification commands
- npm run typecheck
- npm run build

## Git commands
- git status --short   (스테이징 전 .env/키/노드모듈 미포함 확인)
- git add <이번 변경에 해당하는 실제 경로만>
- git commit -m "feat: scaffold ${project.appType} app modules (${project.projectName})"

## Commit message
feat: scaffold ${project.appType} app modules (${project.projectName})

## Notes
- 외부 AI 도구(OpenAI/Gemini/Canva/Gamma/Kling/Notion/Suno)는 계획된 어댑터이며 아직 활성화되지 않음. 각 도구의 공식 API/키 상태를 먼저 검증한 뒤 별도 승인으로 연동한다.`
}
