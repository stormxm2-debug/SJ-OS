# Worktree result review (read-only)

Before anything from a parallel worktree job is merged into the main SJ OS
workspace, the user reviews **what that worktree changed**. This sprint is
**review-only** — it never merges, deletes, or pushes.

## Flow

1. A parallel worktree job finishes at `needs-merge-review` (see
   `CLAUDE_PARALLEL_WORKTREE_BUILDER.md`).
2. In **병렬 작업 결과 검토**, click **변경사항 불러오기** for a job.
3. SJ OS shows the changed-file list, diff stat, and a (size-limited) diff preview
   plus the worktree's verification summary.
4. The user marks a decision: **병합 승인 표시 / 수정 필요 / 반려**. This only records
   the decision — **no merge happens**.

## Renderer never runs shell

The renderer calls two IPC methods with a **job id** (and a decision/notes) only:
`claudeParallel.loadWorktreeReview(jobId)` and
`claudeParallel.markReviewDecision(jobId, decision, notes)`. All git runs in
Electron main (`src/main/claudeParallel.ts`).

## Fixed git inspection commands only

Inside the validated worktree (path must be under
`C:\Users\GalaxyBook5\.vscode\SJ-OS-worktrees`), main runs **only**:

- `git status --short` (changed-file list — includes untracked)
- `git diff --stat` (diff summary)
- `git diff` (preview, size-limited)
- `git branch --show-current`

No merge, no `git add`, no commit, no push, no `worktree remove`, no destructive
command. (Because `git add` is not run, brand-new untracked files appear in the
changed-file list but not in the `git diff` text preview.)

## Diff preview limits

To keep the UI responsive: **max 300 lines** and **max 30000 characters**. Larger
diffs are truncated with *"diff가 커서 일부만 표시됩니다."* — the changed-file list and
diff stat are always shown in full-ish (stat capped at 6k chars).

## Review decisions

- **병합 승인 표시** → `approved-for-merge` · "병합 승인 상태로 표시했습니다. 실제 병합은
  다음 단계에서 진행됩니다."
- **수정 필요** → `needs-fix` · shows a **copyable follow-up prompt draft** for
  Claude ("이 worktree 결과에서 다음 부분을 수정해줘…"). It is **not** run automatically.
- **반려** → `rejected` · "작업을 반려 상태로 표시했습니다. worktree는 삭제하지 않습니다."

If verification failed, the panel warns: *"검증 실패 상태에서는 병합하지 않는 것을
권장합니다."*

## Future next step (not in this sprint)

- Approved-merge flow (diff review → representative approval → merge branch).
- Conflict detection against main.
- Main-workspace verification after merge.
- Rollback plan + optional worktree cleanup (`git worktree remove`, manual for now).
