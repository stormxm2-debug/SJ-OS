# SJ OS — Claude 자동화 러너 스모크 테스트 가이드

기존 Jarvis → Claude 자동개발 큐 → Claude Code CLI 러너가 **안전하게 동작하는지** 검증하는
절차입니다. 새 시스템을 만들지 않고, 읽기 전용/검증 명령으로 확인합니다.

## 자동화 엔진 현재 구조

- 메인 프로세스: `src/main/claudeAutoBuild.ts` (큐 엔진, `spawnTool` 실행기, 검증,
  리페어, 승인 커밋/푸시, 프롬프트 안전 스캐너 `scanAutoBuildPrompt`, 환경 진단
  `checkRunnerEnvironment`, 스모크 `smokeTestRunner`, **신규** `runSafeCheck`).
- IPC: `sj-claude-build:*` (create/run/cancel/queue-*/commit/push/check-env/smoke-test/
  **safe-check**). 렌더러는 typed 브릿지(`window.sj.claudeBuild`)만 사용 — 임의 셸 없음.
- UI(대표/관리자, 데스크톱 전용): **개발 프롬프트 센터** → `ClaudeAutoBuildPanel`,
  `ClaudeRunnerDiagnosticsPanel`, **신규 `RunnerSmokeTestPanel`**.

## 흐름 (자비스 명령 → 큐 → 승인 → 실행)

1. 자비스에 개발 명령 입력 → 프롬프트 생성 → 큐에 추가(스캐너 통과 시 `queued`, 위반 시
   `blocked`).
2. **프롬프트 미리보기** 확인 → **승인**.
3. **선택 작업 실행** 또는 큐 자동 실행 ON(기본 OFF, 한 번에 하나, 실패 시 중단).
4. 라이브 로그 → 완료 상태 → (선택) typecheck/build 검증 → 승인 커밋/푸시.

## 스모크 테스트 순서 (권장)

개발 프롬프트 센터 → **Claude 자동화 러너 스모크 테스트** 카드에서:

1. **Git 상태 확인** (`git status --short`) — 저장소 인식 확인.
2. **최근 커밋 확인** (`git log --oneline -8`).
3. **Typecheck 실행** (`npm run typecheck`) — 통과(exit 0) 확인.
4. **Build 실행** (`npm run build`).
5. **Web Build 실행** (`npm run build:web`) — 스크립트 있으면.
6. **Claude Code CLI 확인** (`npx @anthropic-ai/claude-code --version`).
7. 문제 없으면 **큐에 테스트 작업 추가**(자동화 엔진 연결 테스트) → 승인 → 실행.

각 결과 카드는 라벨/명령/cwd/exit code/소요시간/stdout·stderr 마지막 라인을 보여줍니다.

## 어떤 버튼을 먼저?

`Git 상태 확인` → `Typecheck 실행` → `Build 실행` 순으로 환경을 먼저 검증한 뒤,
`Claude Code CLI 확인`으로 러너를 확인하고, 마지막에 안전 테스트 작업을 큐에 추가합니다.

## 자동 실행 ON 전에 확인할 것

- 진단에서 selectedRunner가 `claude` 또는 `npx`인지 (미감지면 수동 실행 필요).
- Typecheck/Build가 통과하는지.
- 프롬프트 스캐너가 파괴적 프롬프트를 차단하는지(아래 실패 테스트).

## Claude Code CLI 자동 입력이 안 될 때 (수동 실행)

스모크 카드의 **수동 실행 명령**을 복사해 PowerShell에서 직접 실행:

```
cd C:\Users\GalaxyBook5\.vscode\SJ-OS
npx @anthropic-ai/claude-code --permission-mode auto
```

프롬프트는 **프롬프트 복사**로 가져와 붙여넣습니다. 자동 입력이 확인되지 않으면 앱은 성공을
가장하지 않고 "확인 필요" 상태로 표시합니다.

## 실패 시 확인할 것

- exit code / stderr 마지막 라인.
- `claude-version` 실패 → CLI 미설치이거나 비대화형 버전 확인 불가 → 수동 실행 사용.
- Typecheck/Build 실패 → 코드 문제; 자동 실행을 켜지 말고 먼저 수정.
- `차단됨` → 프롬프트가 안전 규칙 위반 → 프롬프트를 안전하게 다시 작성.
