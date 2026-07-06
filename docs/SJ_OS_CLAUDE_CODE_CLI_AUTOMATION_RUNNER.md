# SJ OS — Claude Code CLI 자동 실행 러너

자비스 명령 → Claude Code 프롬프트 → 승인 → **Electron 메인 프로세스**에서 Claude Code
CLI 실행 → 로그 캡처 → 상태 갱신 → (선택) typecheck/build 검증. **VS Code GUI 자동화가
아니라** Claude Code CLI를 로컬 프로젝트 폴더에서 실행하는 방식입니다.

> 이 러너는 이전 스프린트에서 이미 구현되어 있습니다. 본 문서는 사용/보안 안내이며 새 시스템을
> 만들지 않습니다.

## 구성 (기존 파일)

- **메인 프로세스 엔진:** `src/main/claudeAutoBuild.ts` (큐, `spawnTool` 실행기, 검증
  `runFixed`, 자동 리페어, 승인 커밋/푸시, 완료 리포트), `src/main/claudeRunner.ts`,
  `src/main/claudeParallel.ts` (git worktree 병렬 트랙).
- **IPC (typed, 임의 셸 없음):** `sj-claude-build:create/run/cancel/get/list`,
  `queue-state/queue-auto-run/queue-pause/queue-resume/queue-next/queue-cancel`,
  `approve-repair`, `commit-state/commit/push`, `completion-report`,
  `check-env/smoke-test`. preload `window.sj.claudeBuild`로 노출.
- **프롬프트 안전 스캐너:** `scanAutoBuildPrompt` (생성된 프롬프트를 파괴적 명령/시크릿
  값에 대해 검사 → `차단됨: <사유>`).
- **UI (owner/admin, 데스크톱 전용):** `ClaudeAutoBuildPanel`,
  `ClaudeRunnerDiagnosticsPanel`, `WorktreeReviewPanel` — 라우트 **개발 프롬프트 센터
  (`devprompt`)**.

## 실행 방식

- 렌더러는 **명령 문자열을 셸로 보내지 않습니다.** `runClaudeTask` 등은 taskId만 전달하고,
  메인 프로세스가 **고정 명령**으로 Claude Code CLI를 `cwd = projectRoot`에서 spawn합니다
  (Windows는 `spawnTool`가 `cmd.exe /d /s /c npx …` 형태로 shim 명령을 안전 실행).
- 기본 실행 명령: `npx @anthropic-ai/claude-code --permission-mode acceptEdits`
  (헤드리스; 프롬프트는 stdin으로 전달). 환경 진단으로 `claude`/`npx` 러너를 자동 선택.
- 자동 CLI 입력이 불가한 환경이면 성공을 가장하지 않고 상태로 표시합니다.

## 프로젝트 경로 설정

- 기본 projectRoot: `C:\Users\GalaxyBook5\.vscode\SJ-OS` (하드코딩만이 아니라 앱의
  워크스페이스로 resolve). **설정(회사 설정 페이지)** 에서 owner/admin이 projectRoot /
  claudeCommand를 확인·조정합니다.
- 커밋/푸시/검증은 항상 이 워크스페이스 경로 화이트리스트 안에서만 동작합니다.

## 승인 흐름

- 파일을 수정하는 작업은 owner/admin **승인** 후 실행됩니다.
- git add/commit/push는 **명시적 승인**이 있어야 하며, `.env`/시크릿/충돌 마커가 감지되면
  커밋이 차단됩니다.
- 파괴적 명령은 **항상 차단**됩니다. UI 상태: 승인 필요 / 승인됨 / 실행 중 / 완료 / 실패 /
  차단됨.

## 자동 실행 ON/OFF

- 기본값 **OFF**. `큐 자동 실행: ON/OFF` 토글(`queue-auto-run`).
- ON일 때도: owner/admin **데스크톱 앱**에서만, **한 번에 하나씩**, **실패 시 중단**
  (실패 후 계속 진행하지 않음).

## 로그

- 명령 시작 / cwd / 상태 / stdout·stderr 마지막 라인 / exit code / 소요시간을 표시.
- **로그에 env/토큰/시크릿/.env 전체/비밀번호/고객 데이터는 남기지 않습니다.**

## 검증 (선택)

- 작업 완료 후 안전 러너로 `npm run typecheck`, `npm run build`(있으면 `npm run build:web`)
  실행 가능. git commit/push는 승인 없이는 자동 실행하지 않습니다.

## 취소

- 실행 중 프로세스는 owner/admin이 취소 → 해당 child process만 안전하게 kill, 작업은
  '취소됨'. 무관한 프로세스는 종료하지 않습니다.

## Web/PWA · 역할 제한

- **Web/PWA:** 실행 버튼 비활성 — `available`(=`window.sj` 브릿지) 미존재 시
  "자동 개발 실행은 데스크톱 앱에서만 가능합니다." 표시.
- **FC/팀장:** 자동화 화면 자체가 admin 라우트라 접근 불가 (사이드바 숨김 + 직접 접근 시
  "접근 권한이 없습니다." + 모바일에서 숨김).

## 대표님 첫 실행 방법

1. 데스크톱에서 `npm run dev`로 SJ OS 실행 (대표/관리자 로그인).
2. **개발 프롬프트 센터** 진입 → 진단에서 Desktop Agent 감지 / Project Root 확인.
3. 자비스에 개발 명령 입력 → 생성된 **프롬프트 미리보기** 확인.
4. **승인** 후 **선택 작업 실행** (또는 큐 자동 실행 ON).
5. **로그** 확인 → 완료되면 `npm run typecheck` / `build`로 검증.
6. 변경을 반영하려면 **승인 커밋 → 푸시** (자동 아님).

기본 명령 참고: `cd C:\Users\GalaxyBook5\.vscode\SJ-OS` →
`npx @anthropic-ai/claude-code --permission-mode auto` (수동 실행 시). 앱 내부 러너는
동일 CLI를 헤드리스로 실행합니다.

## 스모크 테스트 결과 섹션

개발 프롬프트 센터의 **Claude 자동화 러너 스모크 테스트** 카드에서 고정 안전 점검을
실행합니다: Git 상태/최근 커밋(읽기 전용), Typecheck, Build, Web Build, Claude Code CLI
버전 확인. 렌더러는 enum(kind)만 전달하고 메인 프로세스가 고정 명령을 실행합니다. 절차는
`SJ_OS_CLAUDE_AUTOMATION_RUNNER_SMOKE_TEST.md` 참고.

## 알려진 제약 (Known limitations)

- Claude Code CLI의 비대화형 `--version` 확인이 환경에 따라 실패할 수 있습니다. 이 경우
  앱은 성공을 가장하지 않고 "확인 필요"로 표시하며, 수동 실행 명령을 제공합니다.
- 완전 자동 CLI 입력(stdin)이 확인되지 않으면 수동 실행(fallback)이 필요합니다.

## 수동 fallback 명령

```
cd C:\Users\GalaxyBook5\.vscode\SJ-OS
npx @anthropic-ai/claude-code --permission-mode auto
```

## 안전한 첫 작업 (템플릿)

- 제목: 자동화 엔진 연결 테스트
- 프롬프트: "현재 프로젝트를 수정하지 말고 상태만 점검해줘. git status, package scripts,
  typecheck/build 가능 여부를 확인하고 결과만 보고해. 파일 수정, 커밋, 푸시, 삭제는 하지 마."
- 승인 후에만 실행됩니다. (파일 수정/커밋/삭제를 요청하지 않는 읽기 전용 점검)
