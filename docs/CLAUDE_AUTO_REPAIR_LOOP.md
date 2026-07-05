# Claude auto-build repair loop

When an auto-build job fails **typecheck** or **build** (or a Claude run exits
non-zero with output), SJ OS **generates** a focused Claude Code repair job from the
error logs. Repair jobs are **never auto-run** — the user approves, then runs them
through the same safe Electron-main runner.

## When repair jobs are created

In `onJobSettled` (main), when a job settles as `needs-review` (verification
failed) or `failed` (with a Claude exit code), `maybeCreateRepairJob` runs:

- detects the **failed stage** (`typecheck` / `build` / `claude-run`),
- extracts the last useful error text (bounded: ≤200 lines / ≤30000 chars, plus
  the stderr tail),
- builds a one-line **error summary**,
- generates a **repair prompt** (`generateRepairPrompt`, shared),
- creates a new job tagged `repairOfJobId` / `repairAttempt`, `repairApproved:
  false`, status `queued` (but gated — see below). **It does not call the queue
  runner**, so nothing auto-runs.

## Approval required (no auto-run)

A repair job carries `repairApproved: false`. `runAutoBuildJob` refuses to spawn a
repair job while `!repairApproved` (even if queue auto-run is on). The user must
click **복구 작업 승인** (`approveRepairJob`) first; only then does **Claude Code로
복구 실행** enable.

## Repair prompt

Includes the original request, job title, failed stage, the error logs, and strict
rules: fix only the shown errors, no redesign, no unrelated files, don't touch
`.env`/keys, no destructive commands, and re-run `npm run typecheck` /
`npm run build` / `git status --short`. It passes the same **context-aware safety
scanner** (the "never use" destructive list in the rules does not falsely block).

## Max attempts

`MAX_REPAIR_ATTEMPTS = 2` per source-job chain. `repairAttempt` increments along
the chain (root fail → attempt 1, that repair fails → attempt 2). A third would be
blocked with: *"자동 복구 한도에 도달했습니다. 수동 검토가 필요합니다."*

## Running a repair

After approval + click, the repair runs through the **existing** runner (Electron
main only, prompt via stdin, workspace-whitelisted, one-writer queue), then
verification (`typecheck` / `build` / `git status --short`) runs again. The
renderer never executes shell commands.

## UI

**Claude 자동복구** panel (marker *Claude 자동복구 안전 빌드*) lists each repair job:
실패 단계, 오류 요약, 승인 상태, attempt, **복구 프롬프트 보기 / 복구 작업 승인 /
Claude Code로 복구 실행 / 로그 보기 / 취소**. The run button is disabled until approved
(and until the runner environment is ready).
