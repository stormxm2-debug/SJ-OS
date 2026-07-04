# Claude Code Execution Runner (activated)

The **Claude Code 실행** button now really runs Claude Code through the Electron
main process and streams logs + verification back into SJ OS.

## Flow

1. A Jarvis development command creates a `ClaudeAutoBuildJob` (status `ready`).
2. The user clicks **Claude Code 실행** → renderer calls `claudeBuild.runJob(jobId)`
   with **only the job id**.
3. Main (`src/main/claudeAutoBuild.ts`) looks up the job, re-validates safety +
   workspace, writes the prompt to `.sj-os/claude-auto-build/<jobId>/prompt.md`,
   and spawns Claude Code.
4. stdout/stderr/start/exit/errors stream to the renderer as job updates.
5. On exit code 0 → verification runs; non-zero → status `failed` with stderr.
6. The job card shows status, logs (last ~100 lines), and verification results.

## Renderer never executes shell

The renderer only sends `jobId` over IPC (`window.sj.claudeBuild.runJob`). It never
sends a shell command, args, cwd, or an out-of-workspace path. All process spawning
is in `src/main/claudeAutoBuild.ts`. Grep proof: `child_process`/`spawn` appear
only under `src/main/`.

## Workspace whitelist

`cwd` is always `app.getAppPath()` (the SJ-OS project root, which must equal
`C:\Users\GalaxyBook5\.vscode\SJ-OS`). The prompt file must resolve inside
`.sj-os/claude-auto-build/`. Anything else is refused.

## How Claude Code is launched

`child_process.spawn` with a **fixed args array** (never a shell string), `cwd` =
allowed root:

- Try `claude -p --permission-mode <mode>`
- Fallback `npx @anthropic-ai/claude-code -p --permission-mode <mode>`
- The full generated prompt is written to the child's **stdin** (headless `-p`
  mode reads the task from stdin) — never passed as a command-line argument.
- If neither CLI is found: status `failed` with
  `Claude Code CLI를 찾을 수 없습니다. …`.

### Permission mode

`CLAUDE_PERMISSION_MODE` (one constant in `claudeAutoBuild.ts`) is set to
**`acceptEdits`** so Claude Code auto-accepts file edits and actually modifies the
project. Valid Claude Code values: `default` | `acceptEdits` | `bypassPermissions`
| `plan`. (The sprint named `auto`, which is not a valid Claude Code value; the
working equivalent that enables autonomous edits is `acceptEdits`.) If a given
Claude Code build rejects the value, the process exits non-zero and the job is
marked `failed` with the error shown — change the constant to adjust.

## Log streaming

The main job store broadcasts `sj-claude-build:job-update` to all windows on every
change; the renderer hook mirrors it. The UI shows the last ~100 log lines plus a
status badge (실행 중 / 검증 중 / 완료 / 실패 / 차단됨 / 검토 필요).

## Verification (fixed commands only)

After a successful Claude Code exit, main runs — each via `spawn` with fixed args,
no renderer input:

- `npm run typecheck` → `typecheckStatus`
- `npm run build` → `buildStatus`
- `git status --short` → `gitStatusShort`

Both pass → `succeeded`; otherwise → `needs-review`. The runner never commits or
pushes.

## Cancel

**작업 중지** kills the active Claude process for that job only (status →
`cancelled`); unrelated processes are untouched.

## Safety scan blocks run

Before spawning, the prompt is scanned. Destructive commands (`git reset --hard`,
`git clean -fd`, `git push --force`/`-f`, `rm -rf`, `Remove-Item -Recurse`,
`del /s`, `format`) or real secret values (`sk-…`) block execution:
`위험 명령 또는 민감 정보가 감지되어 Claude Code 실행이 차단되었습니다.` Bare mentions of
`.env` / `OPENAI_API_KEY` in safety rules do not block.

## Auto mode

The Jarvis `개발 명령 자동 실행` toggle is **OFF by default**; execution is
user-initiated unless explicitly turned on.
