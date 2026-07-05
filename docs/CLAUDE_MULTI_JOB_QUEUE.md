# Claude Auto Build — safe multi-job queue

SJ OS lets the user enter multiple Jarvis development commands. Each becomes a
`ClaudeAutoBuildJob` and enters a **queue**. Only **one** job runs in the main
workspace at a time.

## Why one at a time (for now)

Two Claude Code writers editing the **same working tree** concurrently is
dangerous — overlapping edits, half-written files, and racing typecheck/build
runs would corrupt the workspace and produce unmergeable results. So this sprint
serializes: every real code-writing job is `conflictGroup: 'main-workspace'` and
`canRunInParallel: false`, and the Electron-main queue guarantees a single active
writer.

## Flow

1. Enter commands in Jarvis (e.g. `출퇴근 기능 만들어줘`, `고객관리 화면 개선해줘`,
   `실적 화면에 팀장별 순위 추가해`). Each creates a job with status **`queued`**
   and a `queueIndex` (Jarvis shows *"개발 작업 큐에 추가했습니다. 대기 순번 N번"*).
2. The **Claude 자동개발 큐** panel shows the current job, the waiting jobs, and
   completed/failed ones.
3. A job starts when the workspace is free — either the user clicks **다음 작업
   실행** / a job's **지금 실행**, or **큐 자동 실행** is ON.
4. When a job **succeeds** (verification passes) and auto-run is ON, the next
   queued job starts automatically.
5. If a job **fails / needs-review / is blocked**, the queue **auto-pauses**:
   *"이전 작업 검토가 필요하여 큐를 멈췄습니다."* Nothing else runs until you resolve
   it and press **큐 재개**.

## Single-writer guarantee (main)

`runAutoBuildJob(id)` in `src/main/claudeAutoBuild.ts` refuses to spawn when
another job is `running`/`verifying` — it keeps the job `queued` instead. The
queue advances only from `onJobSettled` (on success, if auto-run) or an explicit
user action. The renderer never runs shell commands and never bypasses this.

## Auto-run toggle

- **큐 자동 실행** (default **OFF**). OFF → the queue waits for **다음 작업 실행**.
  ON → the next queued job runs automatically after the previous one succeeds.

## Conflict-group classification

`classifyConflictGroup(command)` labels jobs (backend / frontend / docs / tests /
main-workspace) from keywords (서버·API·백엔드 → backend; 화면·UI·버튼·페이지 →
frontend; 문서·docs → docs; 테스트·검증 → tests). **This does not enable parallel
execution** — it only prepares metadata for the future strategy below.

## Future: true parallel via git worktrees (NOT enabled)

Real parallel code-writing will require, per job:

- a dedicated **git worktree** and **branch** (isolated working tree),
- **independent** typecheck / build inside each worktree,
- a **merge / review queue** with **conflict detection**,
- a **rollback** strategy for failed merges.

Until that is built and stabilized, parallel writers stay disabled:
*"병렬 실행은 git worktree 기반 안정화 후 활성화됩니다."* This sprint intentionally does
**not** run `git worktree add`, create branches, automate merges, or spawn
parallel Claude processes.
