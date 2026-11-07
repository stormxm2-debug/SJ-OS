// 원격 작업 수신 어댑터 (main 전용 — gh/git CLI + 기존 러너 연동).
//
// 순수 오케스트레이터(pollOnce)와 타입은 ../shared/remoteTaskPoll 에 있고, 여기서는
// 실제 I/O(gh/git/러너/영속화) deps 와 타이머 라이프사이클만 담당한다.
//
// 보안/안전: 공개 저장소이므로 엄격한 sj-run 지시 + 허용 작성자 + 지정 runner 만 실행.
//   작업 본문은 셸로 실행하지 않고 러너의 stdin 고정 경로(createAutoBuildJob)로 전달한다.
//   기존 미커밋 변경이 있으면 실행하지 않는다. main 병합·운영 배포·운영 DB 변경은 하지 않는다.
//   gh/git 는 PC 의 기존 로그인(CLI)을 재사용한다(자격정보를 코드/이슈에 넣지 않음).

import { app, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnTool, createAutoBuildJob, runAutoBuildJob, getAutoBuildJob } from './claudeAutoBuild'
import { classifyGhError, markInterruptedAsFailed, type ProcessedState } from '../shared/remoteTask'
import { pollOnce, DEFAULT_REMOTE_CONFIG, type RemoteDeps, type RemoteRunnerConfig, type RemoteRunnerStatus, type ListResult, type RunTaskResult } from '../shared/remoteTaskPoll'

export { DEFAULT_REMOTE_CONFIG } from '../shared/remoteTaskPoll'
export type { RemoteRunnerConfig, RemoteRunnerStatus } from '../shared/remoteTaskPoll'

// --- 상태 영속화(중복·재시작) ----------------------------------------------
export function createStateStore(dir: string): { load(): ProcessedState; save(state: ProcessedState): void; path: string } {
  const path = join(dir, 'remote-task-state.json')
  return {
    path,
    load(): ProcessedState {
      try {
        if (!existsSync(path)) return {}
        return JSON.parse(readFileSync(path, 'utf8')) as ProcessedState
      } catch {
        return {}
      }
    },
    save(state: ProcessedState): void {
      try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        writeFileSync(path, JSON.stringify(state, null, 2), 'utf8')
      } catch {
        /* 영속화 실패는 치명적이지 않음 — 다음 주기에 재시도 */
      }
    }
  }
}

// --- 실제 deps (gh/git CLI + 러너) ------------------------------------------
// ⚠️ 이 경로는 지정 PC(gh/git 로그인 + Claude CLI)에서만 동작한다. 클라우드/CI 에서는 미검증.
function gh(args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawnTool('gh', args, { cwd, windowsHide: true })
    let out = ''
    let err = ''
    child.stdout?.on('data', (d) => (out += String(d)))
    child.stderr?.on('data', (d) => (err += String(d)))
    child.on('error', (e) => resolve({ code: -1, out, err: err + String(e) }))
    child.on('close', (code) => resolve({ code: code ?? -1, out, err }))
  })
}
function git(args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, windowsHide: true })
    let out = ''
    let err = ''
    child.stdout?.on('data', (d) => (out += String(d)))
    child.stderr?.on('data', (d) => (err += String(d)))
    child.on('error', (e) => resolve({ code: -1, out, err: err + String(e) }))
    child.on('close', (code) => resolve({ code: code ?? -1, out, err }))
  })
}

// 러너 1건 실행의 실제 종료 상태들. 'timed-out'(15분 하드 리밋)·'needs-review'·'skipped' 를
// 포함해야 waitForJob 가 즉시 반환한다(이전엔 빠져 있어 시간초과 후에도 최대 20분 더 대기).
const JOB_TERMINAL_STATUSES = new Set<string>(['succeeded', 'failed', 'blocked', 'cancelled', 'timed-out', 'needs-review', 'skipped'])

// claudeAutoBuild 의 하드 실행 리밋(15분)보다 약간만 길게. 리밋을 무제한으로 늘리지 않는다.
async function waitForJob(jobId: string, timeoutMs = 16 * 60 * 1000): Promise<ReturnType<typeof getAutoBuildJob>> {
  const start = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const job = getAutoBuildJob(jobId)
    if (job && JOB_TERMINAL_STATUSES.has(job.status)) return job
    if (Date.now() - start > timeoutMs) return job
    await new Promise((r) => setTimeout(r, 2000))
  }
}

export function makeRunnerDeps(config: RemoteRunnerConfig, workspace: string, stateSaver: (s: ProcessedState) => void): RemoteDeps {
  const slug = config.repo
  return {
    now: () => new Date().toISOString(),
    saveState: (s) => stateSaver(s),
    async listIssueComments(): Promise<ListResult> {
      const r = await gh(['api', `repos/${slug}/issues/${config.issueNumber}/comments`, '--paginate'], workspace)
      if (r.code !== 0) return { ok: false, comments: [], errorKind: classifyGhError(r.err || r.out, r.code), error: 'gh api 실패' }
      try {
        const arr = JSON.parse(r.out) as Array<{ user?: { login?: string }; body?: string }>
        return { ok: true, comments: arr.map((x) => ({ author: x.user?.login ?? '', body: x.body ?? '' })) }
      } catch {
        return { ok: false, comments: [], errorKind: 'other', error: 'gh 응답 파싱 실패' }
      }
    },
    async runTaskOnBranch({ title, body, branch }): Promise<RunTaskResult> {
      const dirty = await git(['status', '--short'], workspace)
      if (dirty.code !== 0) return { ok: false, changedFiles: [], checks: {}, reason: 'git status 실패' }
      if (dirty.out.trim().length > 0) {
        // 복구 우선: 미커밋 변경은 절대 삭제하지 않는다.
        const cur = (await git(['branch', '--show-current'], workspace)).out.trim()
        if (cur.startsWith('claude/remote-')) {
          // 이전 원격작업의 미커밋 잔여물 — clean -fd 로 삭제하지 않고 복구 가능한 named stash 로
          // 보존한 뒤 진행한다(추적/비추적 모두 포함). 보존이 확인되지 않으면 삭제 없이 중단.
          const label = `sj-remote-autostash:${branch}:${new Date().toISOString()}`
          const before = (await git(['stash', 'list'], workspace)).out
          const stash = await git(['stash', 'push', '--include-untracked', '-m', label], workspace)
          const listed = (await git(['stash', 'list'], workspace)).out
          const preserved =
            stash.code === 0 &&
            /saved working directory/i.test(`${stash.out}\n${stash.err}`) &&
            listed.includes(label) &&
            listed.length > before.length
          if (!preserved) {
            return {
              ok: false,
              changedFiles: [],
              checks: {},
              reason: '미커밋 변경 보존(stash) 확인 실패 — 삭제하지 않고 작업을 중단했습니다. 수동으로 git stash list 를 확인하세요.'
            }
          }
          // 보존 확인됨 — 깨끗해진 트리에서 계속(복구: git stash list / git stash apply).
        } else {
          // 사용자가 main 등에서 작업 중 — 건드리지 않고 거부(보존).
          return {
            ok: false,
            changedFiles: [],
            checks: {},
            reason: '작업 폴더에 미커밋 변경이 있어 보존을 위해 실행하지 않았습니다(수동 커밋 또는 stash 후 재시도).'
          }
        }
      }
      await git(['fetch', 'origin', 'main'], workspace)
      const co = await git(['checkout', '-B', branch, 'origin/main'], workspace)
      if (co.code !== 0) return { ok: false, changedFiles: [], checks: {}, reason: `브랜치 생성 실패: ${branch}` }
      const job = createAutoBuildJob({ title: `[remote] ${title}`, source: 'remote-task', originalUserCommand: 'remote-task', generatedPrompt: body, workspacePath: workspace })
      runAutoBuildJob(job.id)
      const done = await waitForJob(job.id)
      const checks = { typecheck: done?.verification.typecheckStatus as string | undefined, build: done?.verification.buildStatus as string | undefined, test: undefined as string | undefined }
      const changed = await git(['status', '--short'], workspace)
      const changedFiles = changed.out.split(/\r?\n/).map((l) => l.slice(3).trim()).filter(Boolean)
      if (done?.status !== 'succeeded') {
        const reason =
          done?.status === 'timed-out'
            ? '실행 시간 초과(약 15분)로 중단되어 검증을 건너뜀 — 미커밋 변경은 작업 폴더에 남아 있으며 다음 실행 시 stash 로 보존됩니다.'
            : done?.errorSummary ?? `러너 작업이 성공하지 못했습니다(status=${done?.status ?? 'unknown'}).`
        return { ok: false, changedFiles, checks, reason }
      }
      if (!changedFiles.length) return { ok: false, changedFiles, checks, reason: '변경된 파일이 없습니다(작업이 파일을 만들지 못함).' }
      const add = await git(['add', '--', ...changedFiles], workspace)
      if (add.code !== 0) return { ok: false, changedFiles, checks, reason: 'git add 실패' }
      // 커밋: PC 전역 git 설정에 의존하지 않도록 작성자 정보를 직접 주입(무조건 커밋되게).
      const commit = await git(
        ['-c', 'user.name=SJ Remote Runner', '-c', 'user.email=remote-runner@users.noreply.github.com', 'commit', '-m', `[remote-task] ${title}`],
        workspace
      )
      if (commit.code !== 0) return { ok: false, changedFiles, checks, reason: `커밋 실패: ${(commit.err || commit.out).slice(-200)}` }
      return { ok: true, changedFiles, checks }
    },
    async pushBranch(branch): Promise<{ ok: boolean; error?: string }> {
      const r = await git(['push', '-u', 'origin', branch], workspace)
      if (r.code !== 0) return { ok: false, error: classifyGhError(r.err, r.code) }
      return { ok: true }
    },
    async createReviewPr({ branch, title, taskId }): Promise<{ ok: boolean; url?: string; error?: string }> {
      const r = await gh(['pr', 'create', '--repo', slug, '--base', 'main', '--head', branch, '--title', `[remote-task ${taskId}] ${title}`, '--body', `원격 작업 \`${taskId}\` 결과. 검토용(자동 병합 안 함). 이슈 #${config.issueNumber} 참조.`], workspace)
      if (r.code !== 0) return { ok: false, error: r.err.slice(-300) }
      return { ok: true, url: (r.out.match(/https?:\/\/\S+/) ?? [])[0] }
    },
    async postComment(body): Promise<{ ok: boolean; error?: string }> {
      const r = await gh(['issue', 'comment', String(config.issueNumber), '--repo', slug, '--body', body], workspace)
      if (r.code !== 0) return { ok: false, error: r.err.slice(-300) }
      return { ok: true }
    }
  }
}

// --- 타이머/라이프사이클(IPC 에서 start/stop) --------------------------------
let timer: ReturnType<typeof setInterval> | null = null
let lastActions: string[] = []
let ticking = false

export function startRemoteTaskRunner(config: RemoteRunnerConfig, workspace: string, dataDir: string): RemoteRunnerStatus {
  stopRemoteTaskRunner()
  if (!config.enabled || !config.runnerId) {
    return { enabled: config.enabled, active: false, runnerId: config.runnerId, issueNumber: config.issueNumber, lastActions: ['not-started: enabled/runnerId 필요'] }
  }
  const store = createStateStore(dataDir)
  // 재시작 정리: 러너가 '새로' 시작되는 시점엔 진행 중 작업이 없으므로, 남아 있는
  // claimed/running 은 이전 프로세스가 실행 도중 종료된 잔여물이다. 즉시 failed(재시도 대상)로
  // 전환해 영구 skip 을 막는다. 단, 직전 틱이 아직 await 중이면(수동 재시작 경합) 건너뛴다.
  if (!ticking) {
    const { state: swept, changed } = markInterruptedAsFailed(store.load())
    if (changed.length) {
      store.save(swept)
      lastActions = [`reclaim-interrupted:${changed.join(',')}`]
    }
  }
  const deps = makeRunnerDeps(config, workspace, (s) => store.save(s))
  const tick = async (): Promise<void> => {
    if (ticking) return
    ticking = true
    try {
      const outcome = await pollOnce(config, store.load(), deps)
      store.save(outcome.state)
      lastActions = outcome.actions
    } catch (e) {
      lastActions = [`tick-error: ${e instanceof Error ? e.message : String(e)}`]
    } finally {
      ticking = false
    }
  }
  void tick()
  timer = setInterval(() => void tick(), Math.max(15, config.pollSeconds) * 1000)
  return { enabled: true, active: true, runnerId: config.runnerId, issueNumber: config.issueNumber, lastActions: ['started'] }
}

export function stopRemoteTaskRunner(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function getRemoteRunnerStatus(config: RemoteRunnerConfig): RemoteRunnerStatus {
  return { enabled: config.enabled, active: timer !== null, runnerId: config.runnerId, issueNumber: config.issueNumber, lastActions }
}

// --- 설정 저장(민감정보 없음 — repo/issue/allowlist/runnerId/poll 만) + IPC ----
function configPath(): string {
  return join(app.getPath('userData'), 'remote-task-config.json')
}
export function loadRemoteConfig(): RemoteRunnerConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<RemoteRunnerConfig>
    return { ...DEFAULT_REMOTE_CONFIG, ...raw }
  } catch {
    return { ...DEFAULT_REMOTE_CONFIG }
  }
}
export function saveRemoteConfig(patch: Partial<RemoteRunnerConfig>): RemoteRunnerConfig {
  const next = { ...loadRemoteConfig(), ...patch }
  try {
    writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* ignore */
  }
  return next
}

/** IPC 등록 — 렌더러가 원격 실행기를 켜고/끄고 상태를 조회한다. 자격정보는 다루지 않는다. */
export function registerRemoteTaskIpc(): void {
  const workspace = resolve(app.getAppPath())
  const dataDir = app.getPath('userData')
  ipcMain.handle('remote-task:get-config', () => loadRemoteConfig())
  ipcMain.handle('remote-task:set-config', (_e, patch: Partial<RemoteRunnerConfig>) => saveRemoteConfig(patch ?? {}))
  ipcMain.handle('remote-task:status', () => getRemoteRunnerStatus(loadRemoteConfig()))
  // 시작/정지는 config.enabled 에 영속화한다 → 명시적 정지는 앱 재시작에도 유지되어
  // 원격 수신이 자동으로 다시 켜지지 않는다(복구 우선 지시). 다시 받으려면 명시적으로 시작.
  ipcMain.handle('remote-task:start', () => startRemoteTaskRunner(saveRemoteConfig({ enabled: true }), workspace, dataDir))
  ipcMain.handle('remote-task:stop', () => {
    stopRemoteTaskRunner()
    return getRemoteRunnerStatus(saveRemoteConfig({ enabled: false }))
  })
}
