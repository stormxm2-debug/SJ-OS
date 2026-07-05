# Approved worktree merge (explicit, gated)

The final step of the parallel pipeline: merge a **reviewed and approved** worktree
branch into the main SJ OS workspace. It happens **only** on an explicit user
action, after strict eligibility checks and a **second confirmation**. No push, no
force, no delete, no auto-conflict-resolution.

## Merge only after approval

A worktree job is merge-eligible only when **all** hold:

- worktree path is inside `C:\Users\GalaxyBook5\.vscode\SJ-OS-worktrees`
- main workspace is exactly `C:\Users\GalaxyBook5\.vscode\SJ-OS`
- `branchName` is safe: `sjos/auto/<slug>` (validated by regex)
- `reviewDecision === 'approved-for-merge'` (the human decision made in the review
  panel, which already warns if verification failed)
- the **main workspace git status is clean** — otherwise the merge is **blocked**:
  *"메인 작업 폴더에 미커밋 변경사항이 있어 병합을 차단했습니다."*

## Second confirmation

Merging takes **two clicks**: **승인된 작업 병합** expands a confirmation
(*"이 작업을 메인 SJ OS에 병합합니다. 계속하시겠습니까?"* with **병합 실행 / 취소**), and
only **병합 실행** actually runs the merge.

## Renderer never runs git

The renderer calls `claudeParallel.mergeApprovedWorktree(jobId)` with a **job id
only**. All git runs in Electron main (`src/main/claudeParallel.ts`); no shell
command, branch, path, or git arg comes from the renderer.

## How main performs the merge

Inside the main workspace, using **only** these git commands:

1. `git status --short` — must be clean (else blocked).
2. `git merge --no-ff <safeBranch>` — the merge.
3. `git status --short` — detect conflicts (`UU`/`AA`/`DD`/… → conflict files).
4. On success: `npm run typecheck`, `npm run build`, `git status --short` — main
   verification (the main workspace has `node_modules`, so this is the real gate).

No `git push`, no `--force`, no `git reset`, no `git clean`, no `worktree remove`.

## Conflict handling

On conflict (non-zero merge or unmerged files): status = **conflict**, the conflict
files are listed, and *"병합 충돌이 발생했습니다. 자동 해결하지 않습니다. 수동 확인이
필요합니다."* is shown. SJ OS does **not** abort/reset/clean/force — you resolve it
manually (e.g. `git merge --abort` in your terminal).

## No auto-push

After a successful merge: *"병합은 완료되었지만 push는 자동으로 하지 않았습니다."* A
controlled push is a later sprint.

## Note on branch contents

The merge brings in whatever is **committed on the worktree branch**. If the
worktree run did not commit its edits, `git merge` reports "Already up to date"
(a safe no-op). A future step can add a controlled commit inside the worktree.
