# Claude Code Runner (approval flow)

The runner adds an **approval-gated** flow on top of the Claude Code Bridge:
select a generated prompt, review safety, **approve**, generate a Claude Code
command, copy it, and (later) launch it. **Actual execution is intentionally
disabled** in this sprint — the plumbing and every safety gate exist and are
validated, but no shell command is run.

## Approval flow

1. In the Developer Prompt Center → **Claude Code 실행 승인** panel, select a job.
2. The panel shows 작업명 · 작업 폴더 · 프롬프트 파일 · 안전 검사 chips.
3. Click **승인 후 실행 명령 생성** (승인/취소). Approval is **blocked** when the
   prompt contains a dangerous command or the workspace is not allowed.
4. On approval the prompt is exported to a safe `.md` file and a command is
   generated.

## Command generation

A deterministic command is built for **display/copy only** (never executed by the
renderer):

```
cd C:\Users\GalaxyBook5\.vscode\SJ-OS
npx @anthropic-ai/claude-code --permission-mode auto < <workspace>\.sj-os\claude-prompts\<file>.md
```

On Windows the `< file` stdin redirect can be unreliable, so the UI also offers
**프롬프트 복사** to paste the prompt into Claude Code directly. Buttons: 명령 복사 /
프롬프트 복사 / 폴더 열기 / Claude Code 실행.

## Execution: intentionally disabled

The **Claude Code 실행** button calls the main-process runner
(`sj-claude:run-approved` → `src/main/claudeRunner.ts`). The main process:

- **The renderer never executes shell commands.**
- Validates: `approved === true`, `workspacePath` equals the allowed root,
  `promptFilePath` is inside `.sj-os/claude-prompts/`, and the prompt has no
  dangerous command.
- With `RUNNER_ENABLED = false`, it returns a **disabled** result and runs
  nothing. When enabled later, it will build a **fixed** `npx @anthropic-ai/
  claude-code` command in main and `child_process.spawn` it, streaming
  stdout/stderr back — never an arbitrary command from the renderer.

## Logging

An inline **실행 로그** card shows the last 100 log lines and a status badge
(대기 중 / 실행 중 / 완료 / 실패 / 차단됨 / 비활성). No modal, no overlay.

## Safety scan / blocklist

Blocks (approval + run) when the prompt contains any destructive command:
`git reset --hard`, `git clean -fd`, `git push --force` / `-f`, `rm -rf`,
`Remove-Item -Recurse`, `del /s`, `format`. Secret/`.env` mentions (`.env`,
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `sk-`) are shown as warnings (SJ OS's own
prompts mention them in "금지" rules). When blocked:
`위험 명령 또는 민감 정보가 포함되어 실행이 차단되었습니다.`

## Current limitations

- Full autonomous code execution is **not enabled** — only approval, command
  generation, copy, and validated (disabled) launch.
- Automatic `npm run typecheck` / `npm run build` after execution is a **later**
  step, not part of this sprint.
