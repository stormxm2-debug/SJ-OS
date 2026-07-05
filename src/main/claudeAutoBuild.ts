import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  ClaudeAutoBuildJob,
  ClaudeAutoBuildStatus,
  ClaudeRunnerDiagnostics,
  ClaudeSmokeTestResult,
  CreateAutoBuildJobRequest,
  QueueState,
  SelectedRunner
} from '@shared/claudeAutoBuild'
import { classifyConflictGroup, scanAutoBuildPrompt } from '@shared/claudeAutoBuild'

/**
 * Jarvis → Claude Code Auto Builder — Electron MAIN runner.
 *
 * SECURITY:
 *  - The renderer NEVER runs shell commands. Only this module spawns processes.
 *  - No arbitrary command string from the renderer is executed — the command and
 *    args are fixed here; only the generated prompt text (validated) is passed.
 *  - Execution is restricted to the allowed workspace (the SJ-OS project root).
 *  - The prompt is scanned for destructive commands / secret values; blocked jobs
 *    never spawn anything.
 *  - Verification runs only the fixed commands: npm run typecheck / npm run build
 *    / git status --short. No commit / push is ever run by the runner.
 *
 * PERMISSION MODE: Claude Code is launched with `--permission-mode` so it can
 * implement the task autonomously inside the (whitelisted) workspace. The value
 * is a single constant below. If the installed Claude Code rejects the value the
 * process exits non-zero and the job is marked failed with the error shown.
 *   Valid Claude Code values: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'.
 *   This sprint activates execution with 'acceptEdits' (auto-accepts file edits so
 *   the project is actually modified) — change here to adjust.
 */

const CLAUDE_PERMISSION_MODE = 'acceptEdits'

const AUTO_BUILD_SUBDIR = join('.sj-os', 'claude-auto-build')
const MAX_LOG_LINES = 300
const MAX_PREVIEW = 4000

function isWin(): boolean {
  return process.platform === 'win32'
}
/** npm-installed CLIs are `.cmd` shims on Windows; native exes (node/git) are not. */
const WIN_CMD_SHIMS = new Set(['npm', 'npx', 'claude', 'yarn', 'pnpm'])

/**
 * Spawn a CLI safely across platforms.
 *
 * On Windows, npm/npx/claude are `.cmd` shims. Node 20.12+/24 refuse to spawn a
 * `.cmd` directly without `shell:true` (throws EINVAL), so we launch them via
 * `cmd.exe /d /s /c <tool> <args…>` — an ARGS ARRAY, never a shell string, and no
 * `shell:true` (avoids the arg-escaping deprecation). cmd.exe resolves the `.cmd`
 * via PATHEXT. Native exes (node/git) and non-Windows spawn directly. Nothing here
 * comes from the renderer — the tool and args are always fixed by the caller.
 */
function spawnTool(tool: string, args: string[], opts: Parameters<typeof spawn>[2]): ChildProcess {
  if (isWin() && WIN_CMD_SHIMS.has(tool)) {
    return spawn('cmd.exe', ['/d', '/s', '/c', tool, ...args], opts)
  }
  return spawn(tool, args, opts)
}

let emitJobUpdate: (job: ClaudeAutoBuildJob) => void = () => {}
export function setAutoBuildEmitter(fn: (job: ClaudeAutoBuildJob) => void): void {
  emitJobUpdate = fn
}

let emitQueueState: (state: QueueState) => void = () => {}
export function setQueueStateEmitter(fn: (state: QueueState) => void): void {
  emitQueueState = fn
}

const jobs = new Map<string, ClaudeAutoBuildJob>()
const procs = new Map<string, ChildProcess>()
let seq = 0

// --- queue state (main owns single-writer serialization) -------------------
let queueAutoRun = false
let queuePaused = false
let queuePausedReason: string | undefined
let queueSeq = 0

export function getQueueState(): QueueState {
  return { autoRun: queueAutoRun, paused: queuePaused, pausedReason: queuePausedReason }
}
function broadcastQueueState(): void {
  emitQueueState(getQueueState())
}
/** True while a job is actively writing/verifying in the workspace. */
function hasActiveJob(): boolean {
  return Array.from(jobs.values()).some((j) => j.status === 'running' || j.status === 'verifying')
}
/** Oldest job still waiting in the queue. */
function nextQueuedJob(): ClaudeAutoBuildJob | undefined {
  return Array.from(jobs.values())
    .filter((j) => j.status === 'queued')
    .sort((a, b) => a.queueIndex - b.queueIndex)[0]
}
function pauseQueueWith(reason: string): void {
  queuePaused = true
  queuePausedReason = reason
  broadcastQueueState()
}
/** Start the next queued job if the workspace is free and the queue isn't paused. */
function maybeRunNext(): void {
  if (queuePaused || hasActiveJob()) return
  const next = nextQueuedJob()
  if (next) runAutoBuildJob(next.id)
}
/** Called whenever a job reaches a terminal-ish state, to drive the queue. */
function onJobSettled(job: ClaudeAutoBuildJob): void {
  if (job.status === 'failed' || job.status === 'needs-review') {
    pauseQueueWith('이전 작업 검토가 필요하여 큐를 멈췄습니다.')
    return
  }
  if (job.status === 'succeeded' && queueAutoRun) maybeRunNext()
}

function nowIso(): string {
  return new Date().toISOString()
}
function nextId(): string {
  seq += 1
  return `job-${Date.now().toString(36)}-${seq}`
}

function allowedRoot(): string {
  return resolve(app.getAppPath())
}

/** The intended SJ-OS project folder (for the workspace-match diagnostic). */
const ALLOWED_WORKSPACE_MAIN = 'C:\\Users\\GalaxyBook5\\.vscode\\SJ-OS'
function sameWorkspace(a: string, b: string): boolean {
  const ra = resolve(a)
  const rb = resolve(b)
  return isWin() ? ra.toLowerCase() === rb.toLowerCase() : ra === rb
}

// --- runner diagnostics ----------------------------------------------------

interface CheckResult {
  ok: boolean
  code: number
  out: string
  err: string
  timedOut: boolean
}

/**
 * Run a FIXED version/diagnostic command with a timeout and captured output.
 * `command`/`args` are hard-coded by callers — nothing here comes from the
 * renderer, and no shell string is used.
 */
function runCheck(command: string, args: string[], timeoutMs = 10000): Promise<CheckResult> {
  return new Promise((resolveP) => {
    let out = ''
    let err = ''
    let done = false
    let timedOut = false
    let child: ChildProcess
    try {
      child = spawnTool(command, args, { cwd: allowedRoot(), windowsHide: true })
    } catch {
      resolveP({ ok: false, code: -1, out: '', err: 'spawn 실패', timedOut: false })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }, timeoutMs)
    const finish = (res: CheckResult): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolveP(res)
    }
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (err += d.toString()))
    child.on('error', (e) => finish({ ok: false, code: -1, out, err: e.message, timedOut }))
    child.on('close', (code) =>
      finish({ ok: code === 0 && !timedOut, code: code ?? -1, out, err, timedOut })
    )
  })
}

/** Resolve a command's full path via `where.exe` (Windows) — first match only. */
async function resolveWhere(name: string): Promise<string | undefined> {
  if (!isWin()) return undefined
  const res = await runCheck('where.exe', [name], 8000)
  if (!res.ok) return undefined
  const first = res.out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)[0]
  return first
}

/** Run the fixed environment checks and decide whether Claude Code can launch. */
export async function checkRunnerEnvironment(): Promise<ClaudeRunnerDiagnostics> {
  const workspacePath = allowedRoot()
  const workspaceAllowed = sameWorkspace(workspacePath, ALLOWED_WORKSPACE_MAIN)

  // Version checks (via cmd.exe for .cmd shims — see spawnTool) + path resolution.
  const [node, npm, npx, claude, nodePath, npmPath, npxPath, claudePath] = await Promise.all([
    runCheck('node', ['--version']),
    runCheck('npm', ['--version']),
    runCheck('npx', ['--version']),
    runCheck('claude', ['--version']),
    resolveWhere('node'),
    resolveWhere('npm'),
    resolveWhere('npx'),
    resolveWhere('claude')
  ])
  // `--no-install` so npx only reports an already-available package (no download).
  const npxClaude = claude.ok
    ? { ok: false, code: -1, out: '', err: '', timedOut: false }
    : await runCheck('npx', ['--no-install', '@anthropic-ai/claude-code', '--version'], 20000)

  const claudeCommandAvailable = claude.ok
  const npxClaudeCodeAvailable = npxClaude.ok
  const selectedRunner: SelectedRunner = claudeCommandAvailable
    ? 'claude'
    : npxClaudeCodeAvailable
      ? 'npx'
      : 'unavailable'

  const errorMessages: string[] = []
  const warnings: string[] = []
  if (!workspaceAllowed) errorMessages.push('작업 폴더 불일치 · 허용된 SJ-OS 폴더가 아닙니다.')
  if (!node.ok) warnings.push('Node를 확인하지 못했습니다.')
  if (!npm.ok || !npx.ok)
    warnings.push('Windows 명령 확인 실패: npm.cmd / npx.cmd 경로를 찾지 못했습니다.')
  if (!claudeCommandAvailable && npx.ok && !npxClaudeCodeAvailable)
    errorMessages.push('npx는 확인됐지만 @anthropic-ai/claude-code 실행에 실패했습니다.')
  if (!claudeCommandAvailable && npxClaudeCodeAvailable)
    warnings.push('claude 전역 명령은 없지만 npx Claude Code 실행이 가능합니다.')
  if (selectedRunner === 'unavailable')
    errorMessages.push('Claude Code CLI를 찾을 수 없습니다. Claude Code 설치 또는 npx 실행 환경을 확인해주세요.')

  const canRun = workspaceAllowed && selectedRunner !== 'unavailable'

  return {
    checkedAt: nowIso(),
    workspacePath,
    workspaceAllowed,
    nodeAvailable: node.ok,
    npmAvailable: npm.ok,
    npxAvailable: npx.ok,
    claudeCommandAvailable,
    npxClaudeCodeAvailable,
    selectedRunner,
    claudeVersion: claude.ok ? claude.out.trim().slice(0, 60) : undefined,
    npxVersion: npx.ok ? npx.out.trim().slice(0, 60) : undefined,
    nodeVersion: node.ok ? node.out.trim().slice(0, 60) : undefined,
    npmVersion: npm.ok ? npm.out.trim().slice(0, 60) : undefined,
    nodePath,
    npmPath,
    npxPath,
    claudePath,
    errorMessages,
    warnings,
    canRun
  }
}

/**
 * Harmless smoke test: ask Claude Code to reply with a fixed token WITHOUT any
 * permission-mode (so it cannot edit files), no git/npm, 30s timeout.
 */
export function smokeTestRunner(): Promise<ClaudeSmokeTestResult> {
  return new Promise((resolveP) => {
    void (async () => {
      const claude = await runCheck('claude', ['--version'])
      const runner: SelectedRunner = claude.ok ? 'claude' : 'npx'
      const prompt = 'Reply with exactly: SJ_OS_CLAUDE_RUNNER_OK. Do not modify files.'
      const args = runner === 'claude' ? ['-p'] : ['@anthropic-ai/claude-code', '-p']

      let out = ''
      let err = ''
      let done = false
      let timedOut = false
      let child: ChildProcess
      try {
        child = spawnTool(runner === 'claude' ? 'claude' : 'npx', args, {
          cwd: allowedRoot(),
          windowsHide: true
        })
      } catch {
        resolveP({ ok: false, runner: 'unavailable', output: '', error: 'spawn 실패', timedOut: false })
        return
      }
      const timer = setTimeout(() => {
        timedOut = true
        try {
          child.kill()
        } catch {
          /* gone */
        }
      }, 30000)
      const finish = (res: ClaudeSmokeTestResult): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolveP(res)
      }
      try {
        child.stdin?.write(prompt)
        child.stdin?.end()
      } catch {
        /* stdin may be closed on immediate failure */
      }
      child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
      child.stderr?.on('data', (d: Buffer) => (err += d.toString()))
      child.on('error', (e) =>
        finish({ ok: false, runner, output: out, error: e.message, timedOut })
      )
      child.on('close', (code) =>
        finish({
          ok: !timedOut && out.includes('SJ_OS_CLAUDE_RUNNER_OK'),
          runner,
          output: (out + (err ? `\n[stderr] ${err}` : '')).slice(0, 4000),
          error: timedOut ? 'Claude Code 실행 시간이 초과되었습니다.' : code !== 0 ? `exit ${code}` : undefined,
          timedOut
        })
      )
    })()
  })
}

function touch(job: ClaudeAutoBuildJob, patch: Partial<ClaudeAutoBuildJob>): ClaudeAutoBuildJob {
  const next: ClaudeAutoBuildJob = { ...job, ...patch, updatedAt: nowIso() }
  jobs.set(next.id, next)
  emitJobUpdate(next)
  return next
}

function log(jobId: string, line: string): void {
  const job = jobs.get(jobId)
  if (!job) return
  touch(job, { logLines: [...job.logLines, line].slice(-MAX_LOG_LINES) })
}

// --- public API ------------------------------------------------------------

export function createAutoBuildJob(request: CreateAutoBuildJobRequest): ClaudeAutoBuildJob {
  const workspaceAllowed = resolve(request.workspacePath || '') === allowedRoot()
  const safety = scanAutoBuildPrompt(request.generatedPrompt ?? '', workspaceAllowed)
  // Safe jobs enter the QUEUE ('queued'); the queue runs one at a time.
  const status: ClaudeAutoBuildStatus = safety.promptSafe && workspaceAllowed ? 'queued' : 'blocked'
  const queueIndex = ++queueSeq
  const job: ClaudeAutoBuildJob = {
    id: nextId(),
    title: request.title || request.originalUserCommand.slice(0, 60) || 'Claude 자동 개발',
    source: request.source,
    originalUserCommand: request.originalUserCommand,
    generatedPrompt: request.generatedPrompt,
    workspacePath: allowedRoot(),
    status,
    safetyResult: safety,
    logLines: [
      `작업 생성됨 · ${nowIso()}`,
      status === 'blocked' ? `차단됨: ${safety.blockedReason}` : `큐에 추가됨 · 대기 순번 ${queueIndex}번`
    ],
    stdoutPreview: '',
    stderrPreview: '',
    verification: { typecheckStatus: 'pending', buildStatus: 'pending', gitStatusShort: '' },
    queueIndex,
    queuedAt: status === 'queued' ? nowIso() : undefined,
    autoRun: queueAutoRun,
    conflictGroup: classifyConflictGroup(request.originalUserCommand),
    canRunInParallel: false,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  jobs.set(job.id, job)
  emitJobUpdate(job)
  // If auto-run is on and the workspace is free, start immediately.
  if (status === 'queued' && queueAutoRun) maybeRunNext()
  return job
}

export function getAutoBuildJob(id: string): ClaudeAutoBuildJob | null {
  return jobs.get(id) ?? null
}
export function listAutoBuildJobs(): ClaudeAutoBuildJob[] {
  return Array.from(jobs.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function cancelAutoBuildJob(id: string): ClaudeAutoBuildJob | null {
  const proc = procs.get(id)
  if (proc) {
    try {
      proc.kill()
    } catch {
      /* already gone */
    }
    procs.delete(id)
  }
  const job = jobs.get(id)
  if (!job) return null
  const settled = touch(job, { status: 'cancelled', finishedAt: nowIso() })
  // A cancel frees the workspace — let the queue advance if auto-run is on.
  if (queueAutoRun) maybeRunNext()
  return settled
}

// --- queue controls --------------------------------------------------------

export function setQueueAutoRun(on: boolean): QueueState {
  queueAutoRun = on
  if (on) {
    queuePaused = false
    queuePausedReason = undefined
    broadcastQueueState()
    maybeRunNext()
  } else {
    broadcastQueueState()
  }
  return getQueueState()
}

export function pauseQueue(): QueueState {
  pauseQueueWith('사용자가 큐를 일시정지했습니다.')
  return getQueueState()
}

export function resumeQueue(): QueueState {
  queuePaused = false
  queuePausedReason = undefined
  broadcastQueueState()
  maybeRunNext()
  return getQueueState()
}

/** Manual "다음 작업 실행": clear any pause and start the next queued job. */
export function runNextQueued(): ClaudeAutoBuildJob | null {
  queuePaused = false
  queuePausedReason = undefined
  broadcastQueueState()
  if (hasActiveJob()) return null
  const next = nextQueuedJob()
  return next ? runAutoBuildJob(next.id) : null
}

export function cancelQueuedJob(id: string): ClaudeAutoBuildJob | null {
  const job = jobs.get(id)
  if (!job) return null
  if (job.status !== 'queued' && job.status !== 'ready') return job
  return touch(job, {
    status: 'cancelled',
    finishedAt: nowIso(),
    logLines: [...job.logLines, '큐에서 취소되었습니다.']
  })
}

/** Run an approved/queued job: spawn Claude Code, stream logs, then verify. */
export function runAutoBuildJob(id: string): ClaudeAutoBuildJob | null {
  let job = jobs.get(id)
  if (!job) return null
  const runnable =
    job.status === 'queued' ||
    job.status === 'ready' ||
    job.status === 'needs-review' ||
    job.status === 'failed'
  if (!runnable) return job

  // HARD RULE: only ONE code-writing job in the main workspace at a time. If
  // another job is active, keep this one queued instead of starting it.
  if (hasActiveJob()) {
    return touch(job, {
      status: 'queued',
      logLines: [...job.logLines, '다른 작업이 실행 중이라 큐에서 대기합니다.']
    })
  }

  // Re-validate safety in main (defense-in-depth).
  const workspaceAllowed = job.workspacePath === allowedRoot()
  const safety = scanAutoBuildPrompt(job.generatedPrompt, workspaceAllowed)
  if (!safety.promptSafe || !workspaceAllowed) {
    return touch(job, {
      status: 'blocked',
      safetyResult: safety,
      logLines: [...job.logLines, `차단됨: ${safety.blockedReason}`]
    })
  }

  // Write the prompt to a per-job file.
  let promptFilePath: string | undefined
  try {
    const dir = join(allowedRoot(), AUTO_BUILD_SUBDIR, job.id)
    mkdirSync(dir, { recursive: true })
    promptFilePath = join(dir, 'prompt.md')
    writeFileSync(promptFilePath, job.generatedPrompt, { encoding: 'utf8' })
  } catch (error) {
    return touch(job, {
      status: 'failed',
      logLines: [...job.logLines, `프롬프트 파일 저장 실패: ${error instanceof Error ? error.message : ''}`]
    })
  }

  job = touch(job, {
    status: 'running',
    startedAt: nowIso(),
    promptFilePath,
    logLines: [...job.logLines, 'Claude Code 실행을 시작합니다…']
  })

  spawnClaude(job.id, 'claude')
  return jobs.get(id) ?? job
}

// --- execution -------------------------------------------------------------

function spawnClaude(jobId: string, command: 'claude' | 'npx'): void {
  const job = jobs.get(jobId)
  if (!job) return

  // Headless (`-p`) mode; the prompt is delivered via stdin (never as an arg).
  // Fixed args only — nothing here comes from the renderer.
  const runArgs = ['-p', '--permission-mode', CLAUDE_PERMISSION_MODE]
  const args = command === 'claude' ? runArgs : ['@anthropic-ai/claude-code', ...runArgs]

  log(jobId, `$ ${command} ${args.join(' ')}`)

  let child: ChildProcess
  try {
    child = spawnTool(command, args, { cwd: allowedRoot(), windowsHide: true })
  } catch {
    handleSpawnError(jobId, command)
    return
  }

  procs.set(jobId, child)

  child.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      handleSpawnError(jobId, command)
    } else {
      log(jobId, `실행 오류: ${err.message}`)
    }
  })

  // Feed the prompt via stdin (never as a shell argument).
  try {
    child.stdin?.write(job.generatedPrompt)
    child.stdin?.end()
  } catch {
    log(jobId, '프롬프트 전달 중 오류가 발생했습니다.')
  }

  child.stdout?.on('data', (data: Buffer) => appendStream(jobId, data.toString(), 'stdout'))
  child.stderr?.on('data', (data: Buffer) => appendStream(jobId, data.toString(), 'stderr'))

  child.on('close', (code) => {
    procs.delete(jobId)
    const cur = jobs.get(jobId)
    if (!cur || cur.status === 'cancelled') return
    const exit = code ?? -1
    // Non-zero exit ⇒ Claude Code failed; skip verification and surface stderr.
    if (exit !== 0) {
      onJobSettled(
        touch(cur, {
          status: 'failed',
          exitCode: exit,
          finishedAt: nowIso(),
          logLines: [
            ...cur.logLines,
            `Claude Code 실패 · exit ${exit}`,
            cur.stderrPreview ? `stderr:\n${cur.stderrPreview.slice(-1200)}` : ''
          ].filter((l) => l.length > 0)
        })
      )
      return
    }
    touch(cur, { exitCode: exit, logLines: [...cur.logLines, `Claude Code 완료 · exit ${exit}`] })
    void runVerification(jobId)
  })
}

function handleSpawnError(jobId: string, command: 'claude' | 'npx'): void {
  if (command === 'claude') {
    // Fall back to npx once.
    log(jobId, 'claude 명령을 찾을 수 없습니다. npx @anthropic-ai/claude-code 로 재시도합니다…')
    spawnClaude(jobId, 'npx')
    return
  }
  const job = jobs.get(jobId)
  if (!job) return
  onJobSettled(
    touch(job, {
      status: 'failed',
      finishedAt: nowIso(),
      logLines: [
        ...job.logLines,
        'npx로 Claude Code를 실행하지 못했습니다.',
        'Claude Code 실행 환경을 찾지 못했습니다. Claude Code 설치 또는 npx 실행 환경을 확인해주세요.'
      ]
    })
  )
}

function appendStream(jobId: string, text: string, kind: 'stdout' | 'stderr'): void {
  const job = jobs.get(jobId)
  if (!job) return
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const preview = ((kind === 'stdout' ? job.stdoutPreview : job.stderrPreview) + text).slice(-MAX_PREVIEW)
  touch(job, {
    logLines: [...job.logLines, ...lines].slice(-MAX_LOG_LINES),
    ...(kind === 'stdout' ? { stdoutPreview: preview } : { stderrPreview: preview })
  })
}

// --- verification (fixed commands only) ------------------------------------

function runFixed(cwd: string, command: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolveP) => {
    let out = ''
    let child: ChildProcess
    try {
      child = spawnTool(command, args, { cwd, windowsHide: true })
    } catch {
      resolveP({ code: -1, out: `${command} 실행 실패` })
      return
    }
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', () => resolveP({ code: -1, out: `${command} 실행 실패 (명령을 찾을 수 없음)` }))
    child.on('close', (code) => resolveP({ code: code ?? -1, out }))
  })
}

async function runVerification(jobId: string): Promise<void> {
  let job = jobs.get(jobId)
  if (!job) return
  const cwd = allowedRoot()
  job = touch(job, {
    status: 'verifying',
    verification: { typecheckStatus: 'running', buildStatus: 'pending', gitStatusShort: '' },
    logLines: [...job.logLines, '검증 시작: npm run typecheck']
  })

  const tc = await runFixed(cwd, 'npm', ['run', 'typecheck'])
  const typecheckStatus = tc.code === 0 ? 'passed' : 'failed'
  job = touch(jobs.get(jobId)!, {
    verification: { ...jobs.get(jobId)!.verification, typecheckStatus, buildStatus: 'running' },
    logLines: [...jobs.get(jobId)!.logLines, `typecheck: ${typecheckStatus}`, '검증: npm run build']
  })

  const bd = await runFixed(cwd, 'npm', ['run', 'build'])
  const buildStatus = bd.code === 0 ? 'passed' : 'failed'
  job = touch(jobs.get(jobId)!, {
    verification: { ...jobs.get(jobId)!.verification, buildStatus },
    logLines: [...jobs.get(jobId)!.logLines, `build: ${buildStatus}`, '검증: git status --short']
  })

  const gs = await runFixed(cwd, 'git', ['status', '--short'])
  const gitStatusShort = gs.out.trim().slice(0, 2000)

  const finalStatus: ClaudeAutoBuildStatus =
    typecheckStatus === 'passed' && buildStatus === 'passed' ? 'succeeded' : 'needs-review'

  const settled = touch(jobs.get(jobId)!, {
    status: finalStatus,
    finishedAt: nowIso(),
    verification: { typecheckStatus, buildStatus, gitStatusShort },
    logLines: [
      ...jobs.get(jobId)!.logLines,
      `git status --short:\n${gitStatusShort || '(변경 없음)'}`,
      finalStatus === 'succeeded' ? '완료: 검증 통과' : '검토 필요: 검증 실패 항목이 있습니다.'
    ]
  })
  onJobSettled(settled)
}
