# Approved commit / push flow

After a **main-workspace** auto-build job succeeds and verification passes, the
user can review the changed files, **commit** them (one approval), and then
**push** them to `origin` (a second, separate approval). Fully manual — nothing
commits or pushes on its own.

## Commit only after verification passes

A commit is allowed only when: the job status is `succeeded`, worktree
`typecheck` **and** `build` passed, `git status --short` shows changes, the current
branch is known, and safety passes. Otherwise:

- no changes → "커밋할 변경사항이 없습니다."
- verification failed → "검증 실패 상태에서는 커밋할 수 없습니다." (button disabled)

## Renderer never runs git

The renderer calls three IPC methods with a **job id only**:
`loadJobCommitState`, `commitApprovedJob`, `pushApprovedCommit`. All git runs in
Electron main (`src/main/claudeAutoBuild.ts`). No shell command, path, branch, or
remote comes from the renderer.

## Safe file staging (no `git add .`)

Main runs `git status --short` / `git diff --stat`, parses changed relative paths,
and:

- **blocks the whole commit** on any `.env` / `.env.local` change,
- **skips** `node_modules/…`, audio files, and `..` paths,
- runs `git diff --check` (blocks on conflict markers / whitespace errors),
- scans `git diff` for real secrets (`sk-…`, `OPENAI_API_KEY=…`,
  `ANTHROPIC_API_KEY=…`) and blocks if found,
- then stages **only** the specific safe files: `git add <file1> <file2> …`.

**`git add .` / `git add -A` / `git commit -am` are never used.**

## Commit message

Derived from the job title, sanitized (newlines/quotes stripped, ≤100 chars,
`feat:` prefix if none), passed as a fixed arg to `git commit -m`. The short hash
(`git log --oneline -1`) is shown as **커밋 해시**.

## Push requires a second approval

Push is a distinct two-click step: **푸시 승인** expands a confirmation
(*"이 커밋을 원격 저장소 origin에 push합니다. 계속하시겠습니까?"* → **푸시 실행 / 취소**),
and only **푸시 실행** runs it.

## No force push

Push runs exactly `git push origin <currentBranch>` — a **fixed** remote (`origin`)
and the current branch. **No `--force` / `-f`**, no arbitrary remote or refspec.
The branch is validated (`[A-Za-z0-9._-/]`, no `..`).

## Logs

`git status` / `git add` / `git commit` / `git push` output and errors are shown
(last ~200 lines).

## Not in this sprint

Rollback / revert of a committed-or-pushed change is not implemented here.
