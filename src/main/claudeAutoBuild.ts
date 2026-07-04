import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  ClaudeAutoBuildJob,
  ClaudeAutoBuildStatus,
  CreateAutoBuildJobRequest
} from '@shared/claudeAutoBuild'
import { scanAutoBuildPrompt } from '@shared/claudeAutoBuild'

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
function bin(base: string): string {
  return isWin() ? `${base}.cmd` : base
}

let emitJobUpdate: (job: ClaudeAutoBuildJob) => void = () => {}
export function setAutoBuildEmitter(fn: (job: ClaudeAutoBuildJob) => void): void {
  emitJobUpdate = fn
}

const jobs = new Map<string, ClaudeAutoBuildJob>()
const procs = new Map<string, ChildProcess>()
let seq = 0

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
  const status: ClaudeAutoBuildStatus = safety.promptSafe && workspaceAllowed ? 'ready' : 'blocked'
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
      status === 'blocked' ? `차단됨: ${safety.blockedReason}` : '안전 검사 통과 · 실행 준비 완료'
    ],
    stdoutPreview: '',
    stderrPreview: '',
    verification: { typecheckStatus: 'pending', buildStatus: 'pending', gitStatusShort: '' },
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  jobs.set(job.id, job)
  emitJobUpdate(job)
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
  return touch(job, { status: 'cancelled', finishedAt: nowIso() })
}

/** Run an approved/ready job: spawn Claude Code, stream logs, then verify. */
export function runAutoBuildJob(id: string): ClaudeAutoBuildJob | null {
  let job = jobs.get(id)
  if (!job) return null
  if (job.status !== 'ready' && job.status !== 'needs-review' && job.status !== 'failed') {
    return job
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
    child = spawn(bin(command), args, { cwd: allowedRoot(), windowsHide: true })
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
    /* stdin may already be closed on immediate failure */
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
      return
    }
    touch(cur, { exitCode: exit, logLines: [...cur.logLines, `Claude Code 완료 · exit ${exit}`] })
    void runVerification(jobId)
  })
}

function handleSpawnError(jobId: string, command: 'claude' | 'npx'): void {
  if (command === 'claude') {
    // Fall back to npx once.
    log(jobId, 'claude 명령을 찾지 못해 npx @anthropic-ai/claude-code 로 재시도합니다…')
    spawnClaude(jobId, 'npx')
    return
  }
  const job = jobs.get(jobId)
  if (!job) return
  touch(job, {
    status: 'failed',
    finishedAt: nowIso(),
    logLines: [
      ...job.logLines,
      'Claude Code CLI를 찾을 수 없습니다. claude 명령 또는 npx @anthropic-ai/claude-code 실행 환경을 확인해주세요.'
    ]
  })
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
      child = spawn(bin(command), args, { cwd, windowsHide: true })
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

  touch(jobs.get(jobId)!, {
    status: finalStatus,
    finishedAt: nowIso(),
    verification: { typecheckStatus, buildStatus, gitStatusShort },
    logLines: [
      ...jobs.get(jobId)!.logLines,
      `git status --short:\n${gitStatusShort || '(변경 없음)'}`,
      finalStatus === 'succeeded' ? '완료: 검증 통과' : '검토 필요: 검증 실패 항목이 있습니다.'
    ]
  })
}
