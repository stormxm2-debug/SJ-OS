# Jarvis → Claude Code Auto Builder (MVP)

## Real product goal

SJ OS is an autonomous app-building system: a development command spoken/typed to
Jarvis becomes a Claude Code job that modifies the actual project, with logs and
verification shown back in SJ OS.

```
Jarvis dev command → generate prompt → create job → run Claude Code (main) → logs → verify
```

## Flow

1. **Jarvis command → job.** A development command (e.g. `직원 출퇴근 기능 만들어줘`)
   is detected by `isDevelopmentCommand`; the renderer generates a strong Claude
   Code prompt (`promptGenerator.ts`) and calls `claudeBuild.createJob`. Existing
   navigation/utility commands (오늘 일정, 유튜브켜줘, FCOS …) are unaffected — they
   still route normally and do **not** start Claude Code.
2. **Safety check.** The main process scans the generated prompt (`scanAutoBuildPrompt`)
   and validates the workspace. Unsafe prompts are `blocked` and never spawn.
3. **Run.** On `Claude Code 실행` (or Auto Mode), the main process writes the prompt
   to `.sj-os/claude-auto-build/<jobId>/prompt.md` and spawns Claude Code.
4. **Logs.** stdout/stderr stream back over IPC into the job's log panel.
5. **Verify.** After Claude Code exits, the main process runs the fixed commands
   `npm run typecheck`, `npm run build`, `git status --short` and records results.
6. **Result.** Status becomes `succeeded` (both checks pass) or `needs-review`.

## Renderer never executes shell

The renderer only sends a validated **prompt + job id** over IPC
(`window.sj.claudeBuild`). It never passes or runs a shell command. All process
spawning lives in `src/main/claudeAutoBuild.ts`.

## Workspace whitelist

Execution is restricted to the SJ-OS project root (`app.getAppPath()`), which must
equal `C:\Users\GalaxyBook5\.vscode\SJ-OS`. Any other workspace is blocked.

## Safety scan

Blocks execution when the prompt contains a destructive command (`git reset --hard`,
`git clean -fd`, `git push --force` / `-f`, `rm -rf`, `Remove-Item -Recurse`,
`del /s`, `format`) or a **real secret value** (e.g. `sk-…`). It deliberately does
**not** block the bare words `.env` / `OPENAI_API_KEY`, since our own prompts
mention them in "do not touch" safety rules.

## Execution method

`child_process.spawn` (args array, never a shell string), `cwd` = allowed root:

- Try `claude -p "Read the development task from stdin and implement it safely."`
- Fallback: `npx @anthropic-ai/claude-code -p "…"`
- The generated prompt is written to the child's **stdin** (not an argument).
- If neither CLI is found: status `failed` with
  `Claude Code CLI를 찾을 수 없습니다. …`.

### Permission mode

By default **no** `--permission-mode` flag is passed (`PERMISSION_MODE_ARGS = []`),
so Claude Code runs in its safe default and will not autonomously edit without
permission. To enable autonomous edits, set `PERMISSION_MODE_ARGS` in
`src/main/claudeAutoBuild.ts` (e.g. `['--permission-mode', 'acceptEdits']`).

## Verification commands (fixed only)

Only `npm run typecheck`, `npm run build`, `git status --short` are run — each via
`spawn` with fixed args. No arbitrary command from the renderer.

## Auto mode

`개발 명령 자동 실행` toggle in the Jarvis panel is **OFF by default**. When ON and
the job passes safety, the job runs immediately after creation. Default flow: the
user reviews and clicks `Claude Code 실행`.

## Commit / push

The runner itself does **not** run git commit/push. The generated prompt asks
Claude Code to commit/push after its own verification. Controlled commit/push
buttons in SJ OS are a later sprint.

## Future plan

- Controlled commit/push buttons.
- Rollback.
- PR creation.
- Multi-job queue.
