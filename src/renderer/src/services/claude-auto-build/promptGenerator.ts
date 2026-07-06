/**
 * Turn a natural-language Jarvis development command into a strong, self-contained
 * Claude Code prompt that Claude Code can implement without the user rewriting it.
 */

import { ALLOWED_WORKSPACE } from '@renderer/services/claude-code/claudeCodeBridge'

/** Verbs/nouns that mark a command as a real development task. */
const DEV_INTENT_PATTERNS = [
  '만들어',
  '만들어줘',
  '개선',
  '추가',
  '붙여',
  '구현',
  '기능',
  '시스템',
  '화면',
  '페이지',
  '필터',
  '수정',
  '고쳐',
  '리팩',
  '연결',
  'build',
  'add',
  'implement',
  'create',
  'feature'
]

/** True when the command looks like a development/build request (not a nav command). */
export function isDevelopmentCommand(text: string): boolean {
  const t = (text ?? '').trim()
  if (t.length < 4) return false
  // Exclude obvious navigation / utility commands.
  const nav = ['열어', '켜줘', '보여줘', '이동', '오늘 일정', '유튜브', '오토파일럿', 'fcos', 'fc os']
  const lower = t.toLowerCase()
  if (nav.some((n) => lower.includes(n)) && !DEV_INTENT_PATTERNS.some((p) => lower.includes(p) && p.length > 2))
    return false
  return DEV_INTENT_PATTERNS.some((p) => lower.includes(p.toLowerCase()))
}

/** A short title derived from the command. */
export function deriveTitle(command: string): string {
  const t = command.trim().replace(/\s+/g, ' ')
  return t.length > 48 ? t.slice(0, 48) + '…' : t
}

/**
 * Build the full Claude Code prompt. It embeds SJ OS's governance rules so Claude
 * Code implements safely and consistently with the existing architecture.
 */
export function generateAutoBuildPrompt(command: string): string {
  const req = command.trim()
  return `# SJ OS 자동 개발 작업 (Jarvis → Claude Code)

## Mission
SJ OS(보험 소프트웨어를 만드는 AI 회사 운영체제)에 아래 개발 요청을 **안전하고 점진적으로** 구현하세요.

## 정확한 사용자 요청
"${req}"

## 실행 지시 (매우 중요 · 반드시 준수)
- 이 작업은 **분석/제안이 아니라 실제 구현**입니다. 이번 실행에서 **실제로 파일을 생성하거나 수정**해야 합니다.
- 필요한 파일을 직접 만들거나 편집하세요(Write/Edit). 코드를 화면에 출력만 하고 끝내지 마세요.
- 코드베이스를 조사(Read/Grep)하는 것은 좋지만, **조사만 하고 종료하지 말고 반드시 파일 변경까지 완료**하세요.
- 커밋/푸시는 여러분이 실행하지 마세요. SJ OS 러너가 검증(typecheck/build/git status) 후
  사용자 승인을 받아 별도로 커밋/푸시합니다. \`git commit\` / \`git push\` 를 직접 실행하지 마세요.

## 안정성 경고 (매우 중요)
- 이 앱은 과거에 한 번에 많은 기능을 넣어 불안정해진 적이 있습니다.
- 작고 안전한 증분 변경만 하세요. 동작하는 시스템을 다시 쓰지 마세요.
- 런타임 클릭 상호작용(사이드바/자비스/버튼)을 절대 깨뜨리지 마세요.
- 전체화면 오버레이/backdrop, 전역 상시 리스너, 포인터 캡처, wake mode 를 추가하지 마세요.

## 기술 스택 / 구조
- Electron(main = Node 백엔드) + React + TypeScript + Tailwind + electron-vite.
- src/main (메인 프로세스), src/preload (타입 IPC 브릿지), src/renderer (React UI),
  src/shared (커널/회사 서비스/계약/타입).

## 먼저 살펴볼 곳 (구현 전에 반드시 확인)
- src/renderer/src/pages 및 src/renderer/src/components — 유사한 기존 화면을 재사용.
- src/renderer/src/navigation 및 Router — 새 화면이 필요하면 라우트를 추가.
- src/renderer/src/services 및 src/shared — 기존 도메인/스토어 패턴을 따를 것.
- 기존 아키텍처와 계약을 재사용하고, 새로운 시스템을 중복 생성하지 마세요.

## Hard rules (반드시 준수)
1. 안정성 우선 · 작고 점진적인 변경.
2. 불필요한 재설계 금지 · 동작하는 시스템 재작성 금지.
3. 기존 아키텍처/모듈/계약 재사용.
4. 커밋 전 반드시 \`npm run typecheck\` 와 \`npm run build\` 통과.
5. 의미 있는 커밋 메시지.
6. .env / .env.local 을 만지지 말 것. API 키를 렌더러/프론트엔드에 노출하지 말 것.
7. 렌더러에서 셸 명령을 실행하지 말 것.
8. 마이크 레코더 / OpenAI 게이트웨이 아키텍처를 변경하지 말 것.

## 안전 제약
- 파괴적 명령을 절대 사용하지 말 것: git reset --hard, git clean -fd,
  git push --force, git push -f, rm -rf, Remove-Item -Recurse, del /s, format.
- 강제 푸시 금지.

## 검증 단계 (구현 후 · 러너가 자동 수행)
- 파일 변경을 마치면 SJ OS 러너가 자동으로 \`npm run typecheck\`, \`npm run build\`,
  \`git status --short\` 를 실행해 검증합니다. 여러분이 직접 실행할 필요는 없습니다.
- 다만 타입 오류/빌드 오류가 나지 않도록 정확한 코드를 작성하세요.

## 커밋 / 푸시 (직접 실행 금지)
- \`git commit\` / \`git push\` 를 직접 실행하지 마세요. 러너가 검증 통과 후 사용자 승인을 받아 처리합니다.
- 강제 푸시나 파괴적 명령은 절대 사용하지 마세요.

## 수동 테스트 체크리스트
- 새/변경 화면이 정상 렌더되고 클릭이 동작하는지.
- 사이드바 이동, 자비스 열기/닫기가 여전히 정상인지.
- 콘솔 오류가 없는지.

## 작업 폴더
${ALLOWED_WORKSPACE}
`
}
