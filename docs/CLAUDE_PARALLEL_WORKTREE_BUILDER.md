# Claude parallel builder — git worktrees (foundation)

To let the user run several Jarvis development commands at once without corrupting
the project, each parallel job runs in its **own git worktree + branch**, never in
the shared main working tree.

## Why same-folder parallel coding is dangerous

Two Claude Code writers editing the **same** working tree concurrently produce
overlapping edits, half-written files, and racing typecheck/build runs — the tree
ends up inconsistent and unmergeable. So SJ OS never runs two writers in one
folder.

## Why worktrees are safer

`git worktree` gives each job an **independent working directory** checked out on
its **own branch**, sharing the same repository history. Jobs can run in parallel
because they touch different folders. Nothing they do affects the main workspace
until an explicit, reviewed merge.

## Paths & naming (main-controlled)

- Main workspace: `C:\Users\GalaxyBook5\.vscode\SJ-OS`
- Worktrees root (sibling): `C:\Users\GalaxyBook5\.vscode\SJ-OS-worktrees`
- Per job: `…\SJ-OS-worktrees\<sourceJobId>-<slug>` on branch `sjos/auto/<slug>`

The renderer sends only a **source job id**. The main process sanitizes the slug,
builds the branch/path, and **validates the worktree path stays inside the
worktrees root** before running anything. No path or branch from the renderer.

## Commands used (only these git verbs)

- `git worktree add <safePath> -b <safeBranch>` (creates the isolated worktree)
- Verification inside the worktree: `npm run typecheck`, `npm run build`,
  `git status --short`

All via `child_process.spawn` with fixed args (no shell string). **Not used this
sprint:** `git worktree remove`, merge, commit, push, or any destructive command.

## Limits & control

- Parallel mode is **OFF by default** (per-panel toggle). Sequential is the default.
- **Max 2** concurrent parallel worktree jobs (`MAX_PARALLEL_JOBS`).
- Jobs never auto-start — the user clicks **worktree 준비** then **병렬 실행 시작**.
- `canRunInParallel` defaults false; a job becomes parallel-ready only after the
  prompt safety scan passes and the worktree is created.

## Verification inside the worktree

After Claude exits 0, the worktree runs typecheck/build/git-status. **Note:** a
fresh worktree has no `node_modules` (it is git-ignored), so typecheck/build may
report failures — these results are **informational** for the merge review and do
not change the outcome. The job parks at **needs-merge-review** regardless:

> 작업이 별도 폴더에서 완료되었습니다. 병합은 다음 단계에서 대표님 승인 후 진행됩니다.

## No auto-merge

Nothing is merged into the main workspace automatically. Successful worktree jobs
stop at `needs-merge-review`.

## Future merge flow (not implemented)

1. **Diff review** of the job's branch.
2. **Conflict detection** against the main branch.
3. **Representative (대표님) approval**.
4. Merge the branch.
5. Run **main-workspace verification** (typecheck/build) after merge.
6. Optional worktree cleanup (`git worktree remove`) — manual for now.
