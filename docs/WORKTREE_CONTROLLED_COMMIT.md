# Controlled worktree commit

The approved-merge flow can only merge **committed** history. But the worktree
runner lets Claude edit files without committing, so merges reported "Already up
to date". This step adds a **user-triggered** commit inside the worktree branch so
the merge actually carries the changes.

## Flow

```
Claude runs in worktree → verify (typecheck/build/git status)
  → verification passes + changes exist → status "commit-ready"
  → user clicks "Worktree 커밋 생성" → main safely stages + commits on the branch
  → status "병합 검토 대기" → review → approve → merge
```

## Verification actually runs now

`prepareWorktree` links the main workspace's `node_modules` into the worktree (a
Windows junction / posix dir symlink, read-only dep reuse, best-effort) so
`npm run typecheck` / `npm run build` can run there. Nothing is copied or deleted.

## Commit eligibility

A commit is allowed only when: worktree path is inside
`…\SJ-OS-worktrees`, the branch is `sjos/auto/<slug>`, **verification passed**
(typecheck + build), and `git status --short` shows changes. Otherwise:

- no changes → "커밋할 변경사항이 없습니다."
- verification failed → "검증 실패 상태에서는 커밋할 수 없습니다."

## Safe file staging (no `git add .`)

Main runs `git status --short`, parses the changed relative paths, and:

- **blocks the whole commit** if any `.env` / `.env.local` is changed,
- **skips** `node_modules/…`, audio files (`.mp3/.wav/.m4a/.webm/…`), and any `..`
  path,
- scans the `git diff` text for real secret values (`sk-…`,
  `OPENAI_API_KEY=…`, `ANTHROPIC_API_KEY=…`) and blocks if found,
- then stages **only** the specific safe files: `git add <file1> <file2> …`.

**`git add .` / `git add -A` are never used.** The renderer never supplies paths —
it sends only a job id.

## Commit message

Derived from the job title, sanitized (newlines/quotes stripped, ≤100 chars,
`feat:` prefix if none), passed as a fixed arg to `git commit -m`.

## Commit hash

After commit, main runs `git log --oneline -1` and returns the short hash, shown
as **커밋 완료 · `<hash>`**.

## No push

After a successful commit: *"worktree 커밋은 완료됐지만 push는 자동으로 하지
않았습니다."*

## Connection to merge review

On success the job moves to **병합 검토 대기** (`needs-merge-review`). The existing
review + approved-merge flow then sees a **real branch commit**, so the merge is no
longer "Already up to date". Merge remains a separate, explicit, approval-gated
step.

## Allowed git commands (this sprint)

`git status --short`, `git diff`, `git diff --name-status`, `git diff --stat`,
`git add <safe files>`, `git commit -m <msg>`, `git log --oneline -1`,
`git branch --show-current`. **Never:** `git add .` / `-A`, `commit -am`, `merge`,
`push`, `worktree remove`, or any destructive/force command.
