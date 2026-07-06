import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  ClaudeAutoBuildJob,
  ClaudeAutoBuildStatus,
  ClaudeBuildCompletionReport,
  ClaudeJobCommitState,
  ClaudeRunnerDiagnostics,
  ClaudeSmokeTestResult,
  SafeCheckKind,
  SafeCheckResult,
  CreateAutoBuildJobRequest,
  QueueState,
  RepairStage,
  ReportPushStatus,
  SelectedRunner
} from '@shared/claudeAutoBuild'
import {
  classifyConflictGroup,
  generateManualTestChecklist,
  generateNextActions,
  generateReleaseNote,
  generateRepairPrompt,
  generateRiskNotes,
  MAX_REPAIR_ATTEMPTS,
  scanAutoBuildPrompt
} from '@shared/claudeAutoBuild'

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
 *   Valid Claude Code values include: 'default' | 'acceptEdits' | 'auto' |
 *   'bypassPermissions' | 'plan'. We use 'acceptEdits' for HEADLESS runs because it
 *   deterministically auto-accepts file edits (so the project is actually modified)
 *   while keeping safety boundaries — the documented best mode for non-interactive
 *   file editing. (`--permission-mode auto` is valid too and is what the manual
 *   fallback command uses interactively, but 'acceptEdits' is the reliable headless
 *   choice.) Change here to adjust.
 *
 * TIMEOUT: every Claude Code run is bounded by CLAUDE_RUN_TIMEOUT_MS. On timeout the
 * runner kills ONLY the process tree it started (never anything else), marks the job
 * 'timed-out', and skips verification. This is the fix for "stuck / never completes".
 */

const CLAUDE_PERMISSION_MODE = 'acceptEdits'

/** Hard ceiling for a single Claude Code run (15 minutes). */
const CLAUDE_RUN_TIMEOUT_MS = 15 * 60 * 1000

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
export function spawnTool(tool: string, args: string[], opts: Parameters<typeof spawn>[2]): ChildProcess {
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
/** Per-job run timeout timers (cleared when the process settles). */
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let seq = 0

/**
 * Kill ONLY the process tree we started for a job. Because Windows runs npm/npx/claude
 * through a `cmd.exe` wrapper (see spawnTool), `child.kill()` would kill cmd.exe but
 * leave the real Claude/Node grandchild running — so we use `taskkill /T /F <pid>` to
 * terminate the whole tree. Nothing outside this runner's own child is touched.
 */
function killJobTree(child: ChildProcess): void {
  const pid = child.pid
  try {
    if (isWin() && typeof pid === 'number') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    /* already gone */
  }
}

/** Clear and drop a job's timeout timer, if any. */
function clearJobTimer(jobId: string): void {
  const t = timers.get(jobId)
  if (t) {
    clearTimeout(t)
    timers.delete(jobId)
  }
}

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
  if (job.status === 'timed-out') {
    // A timeout isn't a code error to auto-repair — just pause for manual review.
    pauseQueueWith('이전 작업이 시간 초과로 중단되어 큐를 멈췄습니다. 로그를 확인해주세요.')
    return
  }
  if (job.status === 'failed' || job.status === 'needs-review') {
    // Auto-GENERATE (not auto-run) a focused repair job from the failure logs.
    maybeCreateRepairJob(job)
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

/**
 * Fixed, non-mutating safe checks for the smoke-test panel. The renderer sends only
 * a kind (enum) — never a command string. Each maps to a FIXED tool+args run in the
 * project workspace. Read-only / verification only (no git write, no file mutation).
 * Output is truncated; secrets are not emitted by these commands.
 */
const SAFE_CHECKS: Record<SafeCheckKind, { label: string; tool: string; args: string[] }> = {
  'git-status': { label: 'Git 상태 확인', tool: 'git', args: ['status', '--short'] },
  'git-log': { label: '최근 커밋 확인', tool: 'git', args: ['log', '--oneline', '-8'] },
  typecheck: { label: 'Typecheck 실행', tool: 'npm', args: ['run', 'typecheck'] },
  build: { label: 'Build 실행', tool: 'npm', args: ['run', 'build'] },
  'build-web': { label: 'Web Build 실행', tool: 'npm', args: ['run', 'build:web'] },
  'claude-version': { label: 'Claude Code CLI 확인', tool: 'npx', args: ['@anthropic-ai/claude-code', '--version'] }
}

export async function runSafeCheck(kind: SafeCheckKind): Promise<SafeCheckResult> {
  const spec = SAFE_CHECKS[kind]
  const cwd = allowedRoot()
  const base: SafeCheckResult = {
    kind,
    label: spec?.label ?? String(kind),
    command: spec ? `${spec.tool} ${spec.args.join(' ')}` : '',
    cwd,
    available: true,
    ok: false,
    exitCode: -1,
    durationMs: 0,
    stdoutTail: '',
    stderrTail: ''
  }
  if (!spec) return { ...base, available: false, message: '허용되지 않은 점검입니다.' }
  if (kind === 'build-web') {
    try {
      const { readFileSync } = require('node:fs') as typeof import('node:fs')
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
      if (!pkg.scripts?.['build:web']) return { ...base, available: false, message: 'build:web 스크립트가 없습니다.' }
    } catch {
      return { ...base, available: false, message: 'package.json을 읽지 못했습니다.' }
    }
  }
  const start = Date.now()
  return new Promise<SafeCheckResult>((resolveP) => {
    let out = ''
    let err = ''
    let child: ChildProcess
    try {
      child = spawnTool(spec.tool, spec.args, { cwd, windowsHide: true })
    } catch {
      resolveP({ ...base, available: kind !== 'claude-version', message: `${spec.tool} 실행 실패` })
      return
    }
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (err += d.toString()))
    child.on('error', () => resolveP({ ...base, durationMs: Date.now() - start, available: kind !== 'claude-version', message: `${spec.tool} 실행 오류` }))
    child.on('close', (code) => {
      const ok = (code ?? -1) === 0
      resolveP({
        ...base,
        ok,
        exitCode: code ?? -1,
        durationMs: Date.now() - start,
        stdoutTail: out.slice(-4000),
        stderrTail: err.slice(-2000),
        available: kind === 'claude-version' ? ok : true,
        message:
          !ok && kind === 'claude-version'
            ? 'Claude Code CLI 비대화형 버전 확인이 어렵습니다. 수동 실행이 필요할 수 있습니다.'
            : undefined
      })
    })
  })
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

// --- auto-repair loop (generate on failure; run only after approval) -------

function detectFailedStage(job: ClaudeAutoBuildJob): RepairStage {
  if (job.verification.typecheckStatus === 'failed') return 'typecheck'
  if (job.verification.buildStatus === 'failed') return 'build'
  if (job.status === 'failed') return 'claude-run'
  return 'unknown'
}

/** Last useful error text from a failed job (bounded). */
function extractErrorLogs(job: ClaudeAutoBuildJob): string {
  const tail = job.logLines.slice(-200).join('\n')
  const combined = (job.stderrPreview ? job.stderrPreview.slice(-8000) + '\n' : '') + tail
  return combined.slice(-30000)
}

function errorSummaryFrom(logs: string): string {
  const line =
    logs.split(/\r?\n/).find((l) => /error TS\d+|error:|✗|failed|❌/i.test(l)) ??
    logs.split(/\r?\n/).find((l) => l.trim().length > 0)
  return (line ?? '검증 실패').trim().slice(0, 200)
}

/** Walk the repair chain to the root job's original command. */
function rootCommand(job: ClaudeAutoBuildJob): string {
  let cur: ClaudeAutoBuildJob | undefined = job
  const seen = new Set<string>()
  while (cur?.repairOfJobId && !seen.has(cur.id)) {
    seen.add(cur.id)
    cur = jobs.get(cur.repairOfJobId)
  }
  return cur?.originalUserCommand ?? job.originalUserCommand
}

/**
 * Generate (never auto-run) a focused repair job from a failed source job.
 * Enforces the per-chain attempt cap. Repair jobs require explicit approval.
 */
function maybeCreateRepairJob(source: ClaudeAutoBuildJob): void {
  // Only repair real code failures (verification) or a Claude run that produced output.
  const isRepairable =
    source.status === 'needs-review' || (source.status === 'failed' && typeof source.exitCode === 'number')
  if (!isRepairable) return

  const attempt = (source.repairAttempt ?? 0) + 1
  if (attempt > MAX_REPAIR_ATTEMPTS) {
    touch(source, {
      logLines: [...source.logLines, '자동 복구 한도에 도달했습니다. 수동 검토가 필요합니다.']
    })
    return
  }
  // Don't double-generate for the same source.
  if (Array.from(jobs.values()).some((j) => j.repairOfJobId === source.id)) return

  const stage = detectFailedStage(source)
  const errorLogs = extractErrorLogs(source)
  const errorSummary = errorSummaryFrom(errorLogs)
  const prompt = generateRepairPrompt({
    originalCommand: rootCommand(source),
    title: source.title,
    stage,
    errorLogs,
    workspacePath: allowedRoot()
  })
  const safety = scanAutoBuildPrompt(prompt, true)

  const repair: ClaudeAutoBuildJob = {
    id: nextId(),
    title: `복구 ${attempt}차 · ${source.title}`,
    source: 'developer-prompt-center',
    originalUserCommand: source.originalUserCommand,
    generatedPrompt: prompt,
    workspacePath: allowedRoot(),
    status: safety.promptSafe ? 'queued' : 'blocked',
    safetyResult: safety,
    logLines: [
      `자동 복구 프롬프트 생성됨 (${attempt}/${MAX_REPAIR_ATTEMPTS}) · 실패 단계 ${stage}`,
      '승인 후 “Claude Code로 복구 실행”을 눌러 실행하세요.'
    ],
    stdoutPreview: '',
    stderrPreview: '',
    verification: { typecheckStatus: 'pending', buildStatus: 'pending', gitStatusShort: '' },
    queueIndex: ++queueSeq,
    autoRun: false,
    conflictGroup: source.conflictGroup,
    canRunInParallel: false,
    repairOfJobId: source.id,
    repairAttempt: attempt,
    repairApproved: false,
    failedStage: stage,
    errorSummary,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  jobs.set(repair.id, repair)
  emitJobUpdate(repair)
  // NOTE: intentionally NOT calling maybeRunNext — repair jobs never auto-run.
}

/** Approve a repair job so it can be run. */
export function approveRepairJob(id: string): ClaudeAutoBuildJob | null {
  const job = jobs.get(id)
  if (!job || !job.repairOfJobId) return job ?? null
  return touch(job, {
    repairApproved: true,
    logLines: [...job.logLines, `복구 작업 승인됨 · ${nowIso()}`]
  })
}

export function getAutoBuildJob(id: string): ClaudeAutoBuildJob | null {
  return jobs.get(id) ?? null
}
export function listAutoBuildJobs(): ClaudeAutoBuildJob[] {
  return Array.from(jobs.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function cancelAutoBuildJob(id: string): ClaudeAutoBuildJob | null {
  clearJobTimer(id)
  const proc = procs.get(id)
  if (proc) {
    killJobTree(proc)
    procs.delete(id)
  }
  const job = jobs.get(id)
  if (!job) return null
  const settled = touch(job, {
    status: 'cancelled',
    finishedAt: nowIso(),
    logLines: [...job.logLines, `작업이 취소되었습니다 · ${nowIso()}`]
  })
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

  // HARD RULE: repair jobs never run until explicitly approved by the user.
  if (job.repairOfJobId && !job.repairApproved) {
    return touch(job, {
      logLines: [...job.logLines, '복구 작업은 승인 후에만 실행할 수 있습니다.']
    })
  }

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

  const startedAt = nowIso()
  job = touch(job, {
    status: 'running',
    startedAt,
    promptFilePath,
    logLines: [
      ...job.logLines,
      `승인됨 · 실행을 시작합니다 · ${startedAt}`,
      `프롬프트 파일 저장됨(수동 실행 대비): ${promptFilePath}`
    ]
  })

  spawnClaude(job.id, 'claude')
  return jobs.get(id) ?? job
}

// --- execution -------------------------------------------------------------

/** stderr fingerprints that mean the runner binary itself was not found. */
function looksLikeMissingCommand(text: string): boolean {
  return /is not recognized as an internal or external command|command not found|없는 명령|ENOENT|not found/i.test(
    text
  )
}

function spawnClaude(jobId: string, command: 'claude' | 'npx'): void {
  const job = jobs.get(jobId)
  if (!job) return

  // Headless (`-p`) mode; the prompt is delivered via stdin (never as an arg).
  // Fixed args only — nothing here comes from the renderer.
  const runArgs = ['-p', '--permission-mode', CLAUDE_PERMISSION_MODE]
  const args = command === 'claude' ? runArgs : ['@anthropic-ai/claude-code', ...runArgs]
  const label = command === 'claude' ? 'claude' : 'npx @anthropic-ai/claude-code'
  const cwd = allowedRoot()
  const startMs = Date.now()

  log(jobId, `Claude Code 실행 시작 · 러너: ${label}`)
  log(jobId, `$ ${command} ${args.join(' ')}`)
  // Observability: prove WHERE Claude runs, that edits are permitted, and that the
  // generated prompt is actually delivered (a common "exit 0, no changes" cause).
  log(jobId, `작업 폴더(cwd): ${cwd}`)
  log(jobId, `권한 모드: ${CLAUDE_PERMISSION_MODE} (파일 생성/수정 허용) · 최대 실행 시간 ${CLAUDE_RUN_TIMEOUT_MS / 60000}분`)

  let child: ChildProcess
  try {
    child = spawnTool(command, args, { cwd, windowsHide: true })
  } catch {
    handleSpawnError(jobId, command)
    return
  }

  procs.set(jobId, child)

  // --- 15-minute timeout: kill the tree, mark timed-out, SKIP verification. -----
  let settledOnce = false
  const timer = setTimeout(() => {
    if (settledOnce) return
    settledOnce = true
    timers.delete(jobId)
    killJobTree(child)
    procs.delete(jobId)
    const cur = jobs.get(jobId)
    if (!cur || cur.status === 'cancelled') return
    const durationSec = Math.round((Date.now() - startMs) / 1000)
    onJobSettled(
      touch(cur, {
        status: 'timed-out',
        finishedAt: nowIso(),
        logLines: [
          ...cur.logLines,
          `⏱ 시간 초과(${CLAUDE_RUN_TIMEOUT_MS / 60000}분) · 실행을 중단했습니다 · 소요 ${durationSec}s`,
          '실행 중이던 Claude Code 프로세스만 종료했습니다. typecheck/build는 진행하지 않습니다.',
          '수동 실행이 필요하면 아래 프롬프트/명령을 복사해 VS Code Claude Code에서 실행하세요.'
        ]
      })
    )
  }, CLAUDE_RUN_TIMEOUT_MS)
  timers.set(jobId, timer)

  child.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      if (settledOnce) return
      settledOnce = true // prevent this child's later 'close' from double-settling
      clearJobTimer(jobId)
      procs.delete(jobId)
      handleSpawnError(jobId, command)
    } else {
      log(jobId, `실행 오류: ${err.message}`)
    }
  })

  // Feed the prompt via stdin and close it (EOF) so headless `-p` stops reading and
  // runs. Never passed as a shell argument. If stdin is unavailable, the prompt file
  // written by runAutoBuildJob is the manual fallback (logged at start).
  try {
    if (child.stdin) {
      child.stdin.write(job.generatedPrompt)
      child.stdin.end()
      log(jobId, `프롬프트 전달 방식: stdin (${job.generatedPrompt.length}자) · stdin 종료(EOF)`)
    } else {
      log(jobId, '프롬프트 전달 경고: stdin을 사용할 수 없습니다. 수동 실행이 필요할 수 있습니다.')
    }
  } catch {
    log(jobId, '프롬프트 전달 방식 확인이 필요합니다. (stdin 쓰기 오류)')
  }

  child.stdout?.on('data', (data: Buffer) => appendStream(jobId, data.toString(), 'stdout'))
  child.stderr?.on('data', (data: Buffer) => appendStream(jobId, data.toString(), 'stderr'))

  child.on('close', (code) => {
    if (settledOnce) return
    settledOnce = true
    clearJobTimer(jobId)
    procs.delete(jobId)
    const cur = jobs.get(jobId)
    if (!cur || cur.status === 'cancelled' || cur.status === 'timed-out') return
    const exit = code ?? -1
    const durationSec = Math.round((Date.now() - startMs) / 1000)

    // The Windows cmd.exe wrapper masks a missing binary as exit 1 (no ENOENT), so
    // detect "not recognized" and fall back from `claude` → `npx` once.
    if (exit !== 0 && command === 'claude' && looksLikeMissingCommand(cur.stderrPreview)) {
      log(jobId, 'claude 전역 명령을 찾지 못했습니다. npx @anthropic-ai/claude-code 로 재시도합니다…')
      settledOnce = false
      spawnClaude(jobId, 'npx')
      return
    }

    // Non-zero exit ⇒ Claude Code failed; skip verification and surface stderr.
    if (exit !== 0) {
      const missing = looksLikeMissingCommand(cur.stderrPreview)
      onJobSettled(
        touch(cur, {
          status: 'failed',
          exitCode: exit,
          finishedAt: nowIso(),
          logLines: [
            ...cur.logLines,
            `Claude Code 실패 · exit ${exit} · 소요 ${durationSec}s`,
            missing
              ? 'Claude Code CLI를 찾을 수 없습니다. npx @anthropic-ai/claude-code --permission-mode auto 명령을 확인하세요.'
              : '자동 실행이 완료되지 않았습니다. 로그(stderr)를 확인하거나 수동 실행하세요.',
            cur.stderrPreview ? `stderr:\n${cur.stderrPreview.slice(-1200)}` : ''
          ].filter((l) => l.length > 0)
        })
      )
      return
    }
    touch(cur, {
      exitCode: exit,
      logLines: [...cur.logLines, `Claude Code 완료 · exit ${exit} · 소요 ${durationSec}s`]
    })
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
        'Claude Code CLI를 찾을 수 없습니다. npx @anthropic-ai/claude-code --permission-mode auto 명령을 확인하세요.'
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
    logLines: [...job.logLines, 'typecheck 시작 · npm run typecheck']
  })

  const tc = await runFixed(cwd, 'npm', ['run', 'typecheck'])
  const typecheckStatus = tc.code === 0 ? 'passed' : 'failed'
  job = touch(jobs.get(jobId)!, {
    verification: { ...jobs.get(jobId)!.verification, typecheckStatus, buildStatus: 'running' },
    logLines: [...jobs.get(jobId)!.logLines, `typecheck ${typecheckStatus}`, 'build 시작 · npm run build']
  })

  const bd = await runFixed(cwd, 'npm', ['run', 'build'])
  const buildStatus = bd.code === 0 ? 'passed' : 'failed'
  job = touch(jobs.get(jobId)!, {
    verification: { ...jobs.get(jobId)!.verification, buildStatus },
    logLines: [...jobs.get(jobId)!.logLines, `build ${buildStatus}`, 'git status --short 실행']
  })

  const gs = await runFixed(cwd, 'git', ['status', '--short'])
  const gitStatusShort = gs.out.trim().slice(0, 2000)

  const noFileChanges = gitStatusShort.length === 0
  const finalStatus: ClaudeAutoBuildStatus =
    typecheckStatus === 'passed' && buildStatus === 'passed' ? 'succeeded' : 'needs-review'

  const closingLines: string[] = [`git status --short:\n${gitStatusShort || '(변경 없음)'}`]
  if (finalStatus === 'succeeded' && noFileChanges) {
    // Verification passed but Claude Code produced NO diff. Surface this clearly
    // instead of reporting a clean success — this is the exact symptom users hit
    // when a run only analyzes/verifies without creating or modifying files.
    closingLines.push(
      '⚠ 검증은 통과했지만 파일 변경이 감지되지 않았습니다. Claude Code가 실제 파일을 생성/수정하지 않았습니다.',
      '프롬프트가 실제 구현(파일 생성/수정)을 명확히 요청했는지, 실행 환경 권한이 acceptEdits인지 확인하세요.'
    )
  } else {
    closingLines.push(finalStatus === 'succeeded' ? '완료: 검증 통과' : '검토 필요: 검증 실패 항목이 있습니다.')
  }

  const settled = touch(jobs.get(jobId)!, {
    status: finalStatus,
    finishedAt: nowIso(),
    verification: { typecheckStatus, buildStatus, gitStatusShort },
    logLines: [...jobs.get(jobId)!.logLines, ...closingLines]
  })
  onJobSettled(settled)
}

// --- approved commit / push (main workspace; explicit; no force) -----------

const COMMIT_AUDIO_EXT = /\.(mp3|wav|m4a|webm|ogg|flac|aac)$/i
const COMMIT_SECRET_RE = [
  /sk-ant-[A-Za-z0-9_-]{16,}/,
  /sk-[A-Za-z0-9_-]{16,}/,
  /(?:OPENAI|ANTHROPIC)_API_KEY\s*=\s*['"]?[A-Za-z0-9_-]{12,}/
]

/** A path that must NEVER be committed (blocks the whole commit). */
function commitBlockedPath(p: string): boolean {
  const l = p.replace(/\\/g, '/').toLowerCase()
  return /(^|\/)\.env(\.|$)/.test(l) || l === '.env' || l.includes('.env.local')
}
/** A path skipped from staging (not committed, doesn't block). */
function commitSkippedPath(p: string): boolean {
  const l = p.replace(/\\/g, '/').toLowerCase()
  return l.includes('node_modules/') || COMMIT_AUDIO_EXT.test(l) || l.includes('..')
}
/** Parse `git status --short` into { path, deleted }. */
function commitChangedFiles(statusShort: string): { path: string; deleted: boolean }[] {
  return statusShort
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const code = line.slice(0, 2)
      let path = line.slice(3).trim()
      if (path.includes('->')) path = path.split('->').pop()!.trim()
      return { path, deleted: code.includes('D') }
    })
    .slice(0, 500)
}
function commitMessageFrom(title: string): string {
  const clean = (title ?? '').replace(/[\r\n"`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
  if (!clean) return 'feat: SJ OS 자동 개발 변경'
  return /^(feat|fix|chore|docs|refactor|style|test)\b|:/.test(clean) ? clean : `feat: ${clean}`
}
/** A branch name is safe if it has no whitespace / shell-ish chars. */
function isSafeBranchName(b: string): boolean {
  return /^[A-Za-z0-9._\-/]+$/.test(b) && !b.includes('..')
}

function baseCommitState(job: ClaudeAutoBuildJob | undefined, jobId: string): ClaudeJobCommitState {
  return {
    jobId,
    status: 'not-ready',
    changedFiles: [],
    diffStat: '',
    gitStatusShort: '',
    commitMessage: commitMessageFrom(job?.title ?? ''),
    commitHash: job?.commitHash,
    currentBranch: '',
    pushRemote: 'origin',
    pushTargetBranch: '',
    committedAt: undefined,
    logLines: []
  }
}

/** Read-only: changed files + eligibility for a succeeded job (no writes). */
export async function loadJobCommitState(jobId: string): Promise<ClaudeJobCommitState> {
  const job = jobs.get(jobId)
  const state = baseCommitState(job, jobId)
  if (!job) return { ...state, status: 'blocked', errorMessage: '작업을 찾을 수 없습니다.' }
  const cwd = allowedRoot()

  const branchR = await runFixed(cwd, 'git', ['branch', '--show-current'])
  const currentBranch = branchR.out.trim().split(/\r?\n/)[0] ?? ''
  const statusR = await runFixed(cwd, 'git', ['status', '--short'])
  const statR = await runFixed(cwd, 'git', ['diff', '--stat'])
  const entries = commitChangedFiles(statusR.out)

  const verified = job.verification.typecheckStatus === 'passed' && job.verification.buildStatus === 'passed'
  let status: ClaudeJobCommitState['status'] = 'ready-to-review'
  let errorMessage: string | undefined
  if (job.pushed) status = 'pushed'
  else if (job.committed) status = 'push-ready'
  else if (job.status !== 'succeeded') { status = 'blocked'; errorMessage = '검증에 통과한 완료 작업만 커밋할 수 있습니다.' }
  else if (!verified) { status = 'blocked'; errorMessage = '검증 실패 상태에서는 커밋할 수 없습니다.' }
  else if (entries.length === 0) { status = 'blocked'; errorMessage = '커밋할 변경사항이 없습니다.' }
  else status = 'commit-ready'

  return {
    ...state,
    status,
    changedFiles: entries.map((e) => e.path),
    diffStat: statR.out.trim().slice(0, 6000),
    gitStatusShort: statusR.out.trim().slice(0, 4000),
    currentBranch,
    pushTargetBranch: currentBranch,
    errorMessage
  }
}

/** Commit the job's changes (explicit; safe staging; no `git add .`). */
export async function commitApprovedJob(jobId: string): Promise<ClaudeJobCommitState> {
  const job = jobs.get(jobId)
  const state = baseCommitState(job, jobId)
  if (!job) return { ...state, status: 'blocked', errorMessage: '작업을 찾을 수 없습니다.' }
  const cwd = allowedRoot()
  const logLines: string[] = []

  // Eligibility.
  if (job.status !== 'succeeded') return { ...state, status: 'blocked', errorMessage: '완료 상태의 작업만 커밋할 수 있습니다.' }
  if (job.verification.typecheckStatus !== 'passed' || job.verification.buildStatus !== 'passed') {
    return { ...state, status: 'blocked', errorMessage: '검증 실패 상태에서는 커밋할 수 없습니다.' }
  }
  const branchR = await runFixed(cwd, 'git', ['branch', '--show-current'])
  const currentBranch = branchR.out.trim().split(/\r?\n/)[0] ?? ''
  if (!currentBranch || !isSafeBranchName(currentBranch)) {
    return { ...state, status: 'blocked', errorMessage: '현재 브랜치를 확인할 수 없습니다.' }
  }
  const statusR = await runFixed(cwd, 'git', ['status', '--short'])
  const entries = commitChangedFiles(statusR.out)
  if (entries.length === 0) return { ...state, status: 'blocked', currentBranch, errorMessage: '커밋할 변경사항이 없습니다.' }
  if (entries.some((e) => commitBlockedPath(e.path))) {
    return { ...state, status: 'blocked', currentBranch, errorMessage: '.env 변경이 감지되어 커밋을 차단했습니다.' }
  }
  // git diff --check (whitespace errors / conflict markers).
  const checkR = await runFixed(cwd, 'git', ['diff', '--check'])
  if (checkR.code !== 0) {
    return { ...state, status: 'blocked', currentBranch, errorMessage: 'git diff --check 실패 (충돌 마커/공백 오류). 확인이 필요합니다.', logLines: [checkR.out.slice(-1000)] }
  }
  // Secret scan on the diff.
  const diffR = await runFixed(cwd, 'git', ['diff'])
  if (COMMIT_SECRET_RE.some((re) => re.test(diffR.out))) {
    return { ...state, status: 'blocked', currentBranch, errorMessage: '민감 정보(비밀 키 값)로 보이는 문자열이 diff에 있어 커밋을 차단했습니다.' }
  }
  const safeFiles = entries.map((e) => e.path).filter((p) => !commitSkippedPath(p))
  if (safeFiles.length === 0) return { ...state, status: 'blocked', currentBranch, errorMessage: '커밋 가능한 안전한 변경 파일이 없습니다.' }

  // Stage ONLY specific safe files (never `git add .`).
  const addR = await runFixed(cwd, 'git', ['add', ...safeFiles])
  logLines.push(`git add ${safeFiles.length}개 파일 · exit ${addR.code}`)
  if (addR.code !== 0) return { ...state, status: 'failed', currentBranch, changedFiles: safeFiles, logLines, errorMessage: 'git add 실패' }

  const message = commitMessageFrom(job.title)
  const commitR = await runFixed(cwd, 'git', ['commit', '-m', message])
  logLines.push(commitR.out.trim().split(/\r?\n/).slice(-6).join('\n'))
  if (commitR.code !== 0) return { ...state, status: 'failed', currentBranch, changedFiles: safeFiles, commitMessage: message, logLines, errorMessage: 'git commit 실패' }

  const logR = await runFixed(cwd, 'git', ['log', '--oneline', '-1'])
  const commitHash = logR.out.trim().split(/\s+/)[0] || undefined
  touch(job, { committed: true, commitHash, logLines: [...job.logLines, `커밋 완료 · ${commitHash} · ${message}`] })

  return {
    ...state,
    status: 'push-ready',
    changedFiles: safeFiles,
    currentBranch,
    pushTargetBranch: currentBranch,
    commitMessage: message,
    commitHash,
    committedAt: nowIso(),
    logLines: [...logLines, '커밋 완료 · push는 별도 승인이 필요합니다.']
  }
}

// --- completion report (read-only inspection; no deployment) ---------------

/** Generate a human-readable completion report for a finished job. */
export async function generateCompletionReport(jobId: string): Promise<ClaudeBuildCompletionReport | null> {
  const job = jobs.get(jobId)
  if (!job) return null
  const cwd = allowedRoot()

  // Changed files: from the last commit if committed, else the working tree.
  let changedFiles: string[] = []
  let diffStat = ''
  if (job.committed) {
    const nameStatus = await runFixed(cwd, 'git', ['diff', '--name-status', 'HEAD~1..HEAD'])
    changedFiles = nameStatus.out
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .slice(0, 500)
    const stat = await runFixed(cwd, 'git', ['diff', '--stat', 'HEAD~1..HEAD'])
    diffStat = stat.out.trim().slice(0, 6000)
  } else {
    const statusR = await runFixed(cwd, 'git', ['status', '--short'])
    changedFiles = statusR.out
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((l) => l.trim())
      .slice(0, 500)
    diffStat = statusR.out.trim().slice(0, 4000)
  }

  const pushStatus: ReportPushStatus = job.pushed ? 'pushed' : 'not-pushed'
  return {
    id: `report-${jobId}`,
    jobId,
    title: job.title,
    originalUserCommand: job.originalUserCommand,
    summary: `${job.title} · 상태 ${job.status}${job.commitHash ? ` · 커밋 ${job.commitHash}` : ''}`,
    changedFiles,
    diffStat,
    verification: job.verification,
    commitHash: job.commitHash,
    pushedAt: job.pushed ? nowIso() : undefined,
    pushStatus,
    releaseNote: generateReleaseNote({
      title: job.title,
      command: job.originalUserCommand,
      verification: job.verification
    }),
    manualTestChecklist: generateManualTestChecklist(job.originalUserCommand),
    riskNotes: generateRiskNotes(job.verification),
    nextRecommendedActions: generateNextActions(pushStatus),
    createdAt: nowIso()
  }
}

/** Push the committed job to origin/<currentBranch> (explicit; NEVER force). */
export async function pushApprovedCommit(jobId: string): Promise<ClaudeJobCommitState> {
  const job = jobs.get(jobId)
  const state = baseCommitState(job, jobId)
  if (!job) return { ...state, status: 'blocked', errorMessage: '작업을 찾을 수 없습니다.' }
  if (!job.committed || !job.commitHash) return { ...state, status: 'blocked', errorMessage: '먼저 커밋을 생성해야 합니다.' }
  const cwd = allowedRoot()

  const branchR = await runFixed(cwd, 'git', ['branch', '--show-current'])
  const currentBranch = branchR.out.trim().split(/\r?\n/)[0] ?? ''
  if (!currentBranch || !isSafeBranchName(currentBranch)) {
    return { ...state, status: 'blocked', commitHash: job.commitHash, errorMessage: '현재 브랜치를 확인할 수 없습니다.' }
  }

  // Fixed remote 'origin' + the current branch. NO --force, NO arbitrary refspec.
  const pushR = await runFixed(cwd, 'git', ['push', 'origin', currentBranch])
  const logLines = pushR.out.trim().split(/\r?\n/).slice(-12)
  if (pushR.code !== 0) {
    return { ...state, status: 'failed', commitHash: job.commitHash, currentBranch, pushTargetBranch: currentBranch, logLines, errorMessage: 'git push 실패 (로그 확인)' }
  }
  touch(job, { pushed: true, logLines: [...job.logLines, `push 완료 · origin/${currentBranch}`] })
  return {
    ...state,
    status: 'pushed',
    commitHash: job.commitHash,
    currentBranch,
    pushTargetBranch: currentBranch,
    pushedAt: nowIso(),
    logLines: [...logLines, `push 완료 · origin/${currentBranch}`]
  }
}
