# Claude Code Runner — environment diagnostics

Before an auto-build job runs, SJ OS can confirm — from **Electron Main only** —
whether Claude Code can actually be launched. This catches "created + safe but
won't execute" cases (CLI missing, wrong workspace, npx unavailable, etc.).

## Renderer never runs shell

The renderer calls two safe IPC methods and nothing else:

- `window.sj.claudeBuild.checkRunnerEnvironment()`
- `window.sj.claudeBuild.smokeTest()`

All process spawning is in `src/main/claudeAutoBuild.ts`. The commands and args are
**fixed in main** — the renderer never passes a command, args, or cwd.

## Windows command resolution

npm/npx/claude are `.cmd` shims on Windows. Node 20.12+/24 **refuse to `spawn` a
`.cmd` directly** without `shell:true` (throws `EINVAL`) — that is why they showed
as "not found". The runner now launches shims via **`cmd.exe /d /s /c <tool>
<args…>`** (an args array — never a shell string, and no `shell:true`); cmd.exe
resolves the `.cmd` via PATHEXT. Native exes (`node`, `git`) and non-Windows spawn
directly. Full paths are additionally resolved with `where.exe` for display
(`nodePath` / `npmPath` / `npxPath` / `claudePath`). Nothing spawned comes from the
renderer — tool and args are always fixed in main.

## Checked commands (fixed)

Each runs via the resolver above (args array, no shell string), with captured
output and a timeout (10s; 20s for the npx package check):

- `node --version`
- `npm --version`
- `npx --version`
- `claude --version`
- `npx --no-install @anthropic-ai/claude-code --version` (only if `claude` is
  absent; `--no-install` means it never downloads anything)

## Workspace validation

`workspacePath` = `app.getAppPath()`, compared to the SJ-OS project folder
(`C:\Users\GalaxyBook5\.vscode\SJ-OS`, case-insensitive on Windows). Mismatch →
`작업 폴더 불일치`, `canRun = false`, and execution is blocked.

## Selected runner

1. `claude` works → `selectedRunner = 'claude'` → **Claude CLI 사용 가능**
2. else `npx @anthropic-ai/claude-code` works → `'npx'` → **npx Claude Code 사용 가능**
3. else `'unavailable'` → **Claude Code 실행 환경 없음**

`canRun = workspaceAllowed && selectedRunner !== 'unavailable'`.

## UI panel

`Claude Code 실행 환경` (in the Developer Prompt Center, above 자동 개발) shows: 작업
폴더, Node, npm, npx, claude CLI, npx Claude Code, 선택된 실행 방식, 실행 가능 여부.
Buttons: **실행 환경 확인**, **Claude Code 실행 테스트**. Marker: `Claude 실행환경 진단 빌드`.

## Run gating

Every job's **Claude Code 실행** button (auto-build panel and Jarvis card) is
enabled only when `envReady` (`diagnostics.canRun === true`). Otherwise:

- not yet checked → `Claude Code 실행 환경을 먼저 확인해주세요.`
- runner unavailable → `Claude Code CLI를 찾을 수 없습니다. Claude Code 설치 또는 npx 실행 환경을 확인해주세요.`

## Smoke test

**Claude Code 실행 테스트** runs one harmless prompt —
`Reply with exactly: SJ_OS_CLAUDE_RUNNER_OK. Do not modify files.` — with:

- cwd = allowed workspace
- **no** `--permission-mode` (so it cannot edit files), no git, no npm
- 30s timeout, output shown in the panel
- success = output contains `SJ_OS_CLAUDE_RUNNER_OK`

## Common failure messages

- `claude 명령을 찾을 수 없습니다.` / `Claude Code CLI를 찾을 수 없습니다. …`
- `npx로 Claude Code를 실행하지 못했습니다.`
- `permission-mode 옵션이 지원되지 않을 수 있습니다.`
- `프롬프트 전달 중 오류가 발생했습니다.`
- `Claude Code 실행 시간이 초과되었습니다.`
