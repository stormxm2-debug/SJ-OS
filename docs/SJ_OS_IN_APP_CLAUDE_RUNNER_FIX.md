# SJ OS 인앱 Claude 자동개발 러너 수정 (In-App Runner Fix)

SJ OS 앱 안에서 “Claude Code 실행” 버튼이 멈추거나(hang) 완료되지 않던 문제를 수정한 내용입니다.
기존 자동화 시스템을 **재작성하지 않고** 실행 안정성만 고쳤습니다.

관련 파일:
- `src/main/claudeAutoBuild.ts` (Electron Main 러너)
- `src/shared/claudeAutoBuild.ts` (상태/프롬프트 계약)
- `src/renderer/src/components/claude-auto-build/ClaudeAutoBuildPanel.tsx`
- `src/renderer/src/components/claude-auto-build/RunnerSmokeTestPanel.tsx`
- `src/renderer/src/components/claude-code/ClaudeCodeRunnerPanel.tsx`

---

## 1. 기존 문제

- 앱에서 “Claude Code 실행”을 누르면 상태가 `실행 중`에서 멈추고 `typecheck: pending / build: pending`
  상태로 영원히 대기했습니다.
- 실행 로그에는 `$ claude -p --permission-mode acceptEdits` 만 보이고 이후 완료 로그가 없었습니다.
- 즉, 자식 프로세스가 **끝나지 않아서(hang)** 후속 검증(typecheck/build/git status)도 시작되지 않았습니다.

## 2. `claude -p --permission-mode acceptEdits` 가 앱에서 불안정했던 이유

- **실행 타임아웃이 없었음(핵심 원인).** Claude Code 프로세스가 어떤 이유로든 끝나지 않으면 작업이
  `running` 상태로 무한 대기했습니다. (인증 대기, TTY 오탐, stdin EOF 미수신 등)
- **프로세스 트리를 종료하지 못함.** Windows에서는 npm/npx/claude 가 `.cmd` 셸이라
  `cmd.exe /d /s /c claude …` 로 감싸 실행합니다. 이때 `child.kill()` 은 `cmd.exe` 만 종료하고
  실제 Claude/Node 손자 프로세스는 살아남아, 취소/중단이 실제로 되지 않았습니다.
- **전역 `claude` 명령 누락이 감지되지 않음.** `cmd.exe` 래퍼는 명령이 없을 때도 ENOENT 가 아니라
  exit 1 로 끝나므로, 기존의 npx 폴백(ENOENT 기반)이 동작하지 않고 “실패”로만 처리됐습니다.
- 결과적으로 실제로는 “멈춤 → 아무 표시 없음”으로 보였습니다.

## 3. 새 실행 방식 (무엇을 고쳤나)

- **15분 실행 타임아웃 추가.** `CLAUDE_RUN_TIMEOUT_MS = 15 * 60 * 1000`.
  - 초과 시 이 러너가 시작한 **프로세스 트리만** 종료합니다.
  - 작업 상태를 `timed-out(시간 초과)` 로 표시하고 로그를 남깁니다.
  - **typecheck/build 로 넘어가지 않습니다.** (부분 결과로 성공을 위장하지 않음)
- **프로세스 트리 안전 종료.** Windows 는 `taskkill /pid <pid> /T /F`, 그 외 OS 는 `SIGTERM`.
  취소/타임아웃 모두 실제 Claude 프로세스까지 종료합니다. (다른 프로세스는 절대 건드리지 않음)
- **전역 `claude` 누락 시 npx 자동 폴백.** stderr 에 “is not recognized / command not found” 가
  보이면 `npx @anthropic-ai/claude-code` 로 1회 재시도합니다.
- **상태 세분화:** `queued → (승인) → running → verifying → succeeded / failed / timed-out / cancelled`.
- **권한 모드는 `acceptEdits` 유지.** 헤드리스(`-p`)에서 파일 편집을 자동 승인하는, 문서상 권장되는
  안정적인 모드입니다. (`--permission-mode auto` 도 유효한 값이며, 아래 수동 fallback 명령에서 사용합니다.)

### 지금 사용하는 명령 전략

```
claude -p --permission-mode acceptEdits         # 전역 claude 가 있으면 우선 사용
npx @anthropic-ai/claude-code -p --permission-mode acceptEdits   # 없으면 자동 폴백
```

- Main 프로세스가 명령/인자를 **고정**해서 실행합니다. 렌더러는 명령 문자열을 보내지 않습니다.
- 렌더러가 요청할 수 있는 것은 오직: 승인된 작업 실행 / 취소 / 로그 조회 / 상태 조회 뿐입니다.

## 4. Windows 에서 `cmd.exe`(`.cmd` 셸)를 쓰는 이유

- npm/npx/claude 는 Windows 에서 실제 exe 가 아니라 `.cmd` 셸입니다.
- Node 20.12+/24 는 `.cmd` 를 `shell:true` 없이 직접 spawn 하면 EINVAL 로 거부합니다.
- 그래서 **인자 배열**로 `cmd.exe /d /s /c <tool> <args…>` 형태로 실행합니다. (셸 문자열 아님 →
  인자 이스케이프 취약점 없음.) 네이티브 exe(node/git)는 그대로 직접 실행합니다.
- 이 방식의 부작용(손자 프로세스가 살아남는 문제)은 위 `taskkill /T` 로 해결했습니다.

## 5. 프롬프트 전달 방식

- 실행 시작 시 프롬프트를 파일로도 저장합니다: `.sj-os/claude-auto-build/<jobId>/prompt.md`
  (수동 실행/재현 대비, 로그에 경로 표시).
- 실제 전달은 **stdin** 으로 합니다: 프롬프트를 stdin 에 쓰고 `end()` 로 EOF 를 보내 헤드리스 `-p`
  가 입력을 마치고 실행하도록 합니다.
- stdin 을 쓸 수 없거나 오류가 나면 로그에 “프롬프트 전달 방식 확인이 필요합니다” 를 남기고,
  저장된 프롬프트 파일 + 수동 명령으로 폴백할 수 있게 안내합니다. (성공을 위장하지 않음)

## 6. typecheck / build / git status 후속 검증

- Claude Code 가 **exit 0** 로 정상 종료된 경우에만 자동으로 순서대로 실행합니다:
  1. `npm run typecheck`
  2. `npm run build`
  3. `git status --short`
- 모두 **고정 명령**이며, Windows 에서 npm 은 `npm.cmd`(위 `cmd.exe` 래퍼)로 실행됩니다.
- 임의 명령 문자열은 실행하지 않습니다. 커밋/푸시는 러너가 자동으로 하지 않습니다(별도 승인 단계).
- typecheck/build 가 모두 passed 이고 변경 파일이 있으면 `succeeded`, 아니면 `needs-review` 입니다.
- 변경이 하나도 없으면(“exit 0, no diff”) 경고를 명확히 남깁니다.

## 7. 앱 내부 테스트 방법 (대표님용)

1. 데스크톱 앱(`npm run dev`)을 **대표/관리자** 계정으로 엽니다. (FC/팀장은 이 화면 접근 불가)
2. 좌측에서 **개발 프롬프트 센터**(devprompt) 로 이동합니다.
3. “Claude 자동화 러너 스모크 테스트” 카드에서 먼저 **Claude Code CLI 확인** 등 읽기 전용 점검을 눌러
   실행 환경을 확인합니다.
4. **“앱 내부 검증 작업 (실제 파일 생성)” → “앱 내부 검증 작업 큐에 추가”** 를 누릅니다.
5. “Claude 자동 개발” 카드에서 방금 추가된 작업의 **“Claude Code 실행”** 을 누릅니다.
6. 로그가 다음 순서로 흐르는지 확인합니다:
   - 작업 생성됨 → 승인됨 → Claude Code 실행 시작 → cwd 표시 → 프롬프트 전달 방식(stdin) →
     Claude Code 완료(exit 0) → typecheck 시작/통과 → build 시작/통과 → git status --short → 완료
7. 러너가 `docs/SJ_OS_AUTOMATION_ENGINE_APP_TEST.md` 파일을 **생성**했는지 확인합니다.
   - PowerShell: `Test-Path -LiteralPath 'docs\SJ_OS_AUTOMATION_ENGINE_APP_TEST.md'` → `True`

## 8. 실패 시 수동 fallback 방법

- 앱 로그에 아래와 같은 안내가 표시됩니다:
  - 자동 실행 미확인: “Claude Code 자동 실행이 아직 안정화되지 않았습니다. 프롬프트 복사 후 VS Code
    Claude Code에서 수동 실행하세요.”
  - 명령 없음: “Claude Code CLI를 찾을 수 없습니다. npx @anthropic-ai/claude-code --permission-mode auto 명령을 확인하세요.”
  - 작업 폴더 오류: “작업 폴더를 찾을 수 없습니다.”
  - 프롬프트 미전달: “프롬프트 전달 방식 확인이 필요합니다.”
- 수동 실행 명령 (스모크 테스트 카드에서 “명령 복사” 로 복사 가능):

  ```
  cd "C:\Users\GalaxyBook5\.vscode\SJ-OS"
  npx @anthropic-ai/claude-code --permission-mode auto
  ```

- 스모크 테스트 카드에서 제공: **명령 복사 / 프롬프트 복사** (필요 시 VS Code Claude Code 에서 수동 실행).

## 9. 접근 제어 / 보안 요약

- **대표/관리자 · 데스크톱 앱**: 러너 표시 + 승인된 작업 실행 가능.
- **FC/팀장**: 러너 화면 접근 불가(`devprompt` 는 admin 라우트 → AccessDenied).
- **Web/PWA**: 실행 불가(`window.sj.claudeBuild` 브릿지 없음) → “Claude 자동개발 실행은 PC앱 전용입니다.”
- 렌더러는 임의 셸 명령을 실행하지 않습니다. Main 이 안전한 고정 명령만 실행합니다.
- 프롬프트 안전 검사(`scanAutoBuildPrompt`)가 파괴적 명령(git reset --hard, git clean -fd,
  git push --force, rm -rf, Remove-Item -Recurse, del /s, format)과 비밀 값/.env 노출을 차단합니다.
- 로그에는 env/토큰/비밀번호/고객정보/.env 내용을 남기지 않습니다.
</content>
</invoke>
