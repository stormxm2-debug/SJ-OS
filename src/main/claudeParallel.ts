import { app } from 'electron'
import { type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ParallelBuildJob } from '@shared/claudeParallel'
import { MAX_PARALLEL_JOBS } from '@shared/claudeParallel'
import { scanAutoBuildPrompt } from '@shared/claudeAutoBuild'
import { getAutoBuildJob, spawnTool } from './claudeAutoBuild'
import type { ClaudeAutoBuildVerification } from '@shared/claudeAutoBuild'

/**
 * Worktree-based parallel Claude builder (foundation) — Electron MAIN only.
 *
 * Each parallel job runs in its OWN git worktree + branch, so two jobs never edit
 * the same working tree. The renderer sends only a source job id; git/Claude are
 * spawned here with fixed args (no shell string, nothing renderer-controlled).
 *
 * SAFETY: no auto-merge, no auto-delete (no `git worktree remove`), no force push,
 * no destructive commands. Only these git verbs are used: `worktree add`, plus the
 * fixed verification commands inside the worktree.
 */

const CLAUDE_PERMISSION_MODE = 'acceptEdits'

function mainWorkspace(): string {
  return resolve(app.getAppPath())
}
/** Sibling folder of the main workspace, e.g. …\.vscode\SJ-OS-worktrees */
function worktreesRoot(): string {
  return resolve(join(mainWorkspace(), '..', 'SJ-OS-worktrees'))
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Keep Korean/alphanumerics; collapse the rest to '-'. */
function slugify(text: string): string {
  const cleaned = (text ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return cleaned || 'job'
}

let emitParallel: (job: ParallelBuildJob) => void = () => {}
export function setParallelEmitter(fn: (job: ParallelBuildJob) => void): void {
  emitParallel = fn
}

const parallelJobs = new Map<string, ParallelBuildJob>() // keyed by sourceJobId
const procs = new Map<string, ChildProcess>()

function touch(job: ParallelBuildJob, patch: Partial<ParallelBuildJob>): ParallelBuildJob {
  const next: ParallelBuildJob = { ...job, ...patch, updatedAt: nowIso() }
  parallelJobs.set(next.sourceJobId, next)
  emitParallel(next)
  return next
}
function log(sourceJobId: string, line: string): void {
  const job = parallelJobs.get(sourceJobId)
  if (!job) return
  touch(job, { logLines: [...job.logLines, line].slice(-300) })
}

function activeParallelCount(): number {
  return Array.from(parallelJobs.values()).filter(
    (j) => j.parallelStatus === 'running' || j.parallelStatus === 'verifying'
  ).length
}

/** Create (or fetch) the parallel job derived from an auto-build job. */
function deriveOrGet(sourceJobId: string): ParallelBuildJob | null {
  const existing = parallelJobs.get(sourceJobId)
  if (existing) return existing
  const source = getAutoBuildJob(sourceJobId)
  if (!source) return null
  const job: ParallelBuildJob = {
    id: `par-${sourceJobId}`,
    sourceJobId,
    title: source.title,
    originalUserCommand: source.originalUserCommand,
    generatedPrompt: source.generatedPrompt,
    baseWorkspacePath: mainWorkspace(),
    conflictGroup: source.conflictGroup,
    parallelStatus: 'not-created',
    canRunInParallel: false,
    logLines: [`병렬 후보 생성 · ${nowIso()}`],
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  parallelJobs.set(sourceJobId, job)
  emitParallel(job)
  return job
}

export function listParallelJobs(): ParallelBuildJob[] {
  return Array.from(parallelJobs.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}
export function getParallelJob(sourceJobId: string): ParallelBuildJob | null {
  return parallelJobs.get(sourceJobId) ?? null
}

// --- worktree preparation --------------------------------------------------

export function prepareWorktree(sourceJobId: string): ParallelBuildJob | null {
  let job = deriveOrGet(sourceJobId)
  if (!job) return null

  // Safety: prompt scan + workspace validation.
  const workspaceAllowed = job.baseWorkspacePath === mainWorkspace()
  const safety = scanAutoBuildPrompt(job.generatedPrompt, workspaceAllowed)
  if (!safety.promptSafe || !workspaceAllowed) {
    return touch(job, {
      parallelStatus: 'blocked',
      blockedReason: safety.blockedReason ?? '작업 폴더 불일치',
      logLines: [...job.logLines, `차단됨: ${safety.blockedReason ?? '작업 폴더 불일치'}`]
    })
  }

  const slug = slugify(job.title || job.originalUserCommand)
  const branchName = `sjos/auto/${slug}`
  const worktreePath = resolve(join(worktreesRoot(), `${sourceJobId}-${slug}`))

  // The worktree path MUST stay inside the allowed worktrees root.
  if (!worktreePath.startsWith(worktreesRoot())) {
    return touch(job, {
      parallelStatus: 'blocked',
      blockedReason: '허용되지 않은 worktree 경로입니다.',
      logLines: [...job.logLines, '차단됨: 허용되지 않은 worktree 경로']
    })
  }

  // Already prepared (folder exists) → treat as created (idempotent).
  if (existsSync(worktreePath)) {
    return touch(job, {
      parallelStatus: 'worktree-created',
      worktreePath,
      branchName,
      canRunInParallel: true,
      logLines: [...job.logLines, `worktree가 이미 존재합니다: ${worktreePath}`]
    })
  }

  try {
    mkdirSync(worktreesRoot(), { recursive: true })
  } catch {
    /* creating the sibling root is best-effort; git will error if truly blocked */
  }

  job = touch(job, {
    parallelStatus: 'preparing',
    worktreePath,
    branchName,
    logLines: [...job.logLines, `$ git worktree add ${worktreePath} -b ${branchName}`]
  })

  let child: ChildProcess
  try {
    child = spawnTool('git', ['worktree', 'add', worktreePath, '-b', branchName], {
      cwd: mainWorkspace(),
      windowsHide: true
    })
  } catch {
    touch(job, {
      parallelStatus: 'failed',
      logLines: [...job.logLines, 'git worktree add 실행에 실패했습니다.']
    })
    return parallelJobs.get(sourceJobId) ?? job
  }

  let out = ''
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
  child.stderr?.on('data', (d: Buffer) => (out += d.toString()))
  child.on('error', (e) =>
    touch(parallelJobs.get(sourceJobId)!, {
      parallelStatus: 'failed',
      logLines: [...parallelJobs.get(sourceJobId)!.logLines, `worktree 오류: ${e.message}`]
    })
  )
  child.on('close', (code) => {
    const cur = parallelJobs.get(sourceJobId)
    if (!cur) return
    const trimmed = out.trim().slice(0, 1500)
    if (code === 0) {
      touch(cur, {
        parallelStatus: 'worktree-created',
        canRunInParallel: true,
        logLines: [...cur.logLines, trimmed, `worktree 생성 완료 · 브랜치 ${branchName}`].filter(Boolean)
      })
    } else {
      touch(cur, {
        parallelStatus: 'failed',
        logLines: [...cur.logLines, trimmed, `worktree 생성 실패 · exit ${code}`].filter(Boolean)
      })
    }
  })

  return parallelJobs.get(sourceJobId) ?? job
}

// --- parallel run (inside the worktree) ------------------------------------

export function runWorktreeJob(sourceJobId: string): ParallelBuildJob | null {
  let job = parallelJobs.get(sourceJobId)
  if (!job) return null
  if (
    job.parallelStatus !== 'worktree-created' &&
    job.parallelStatus !== 'ready' &&
    job.parallelStatus !== 'failed'
  ) {
    return job
  }
  if (!job.worktreePath || !job.worktreePath.startsWith(worktreesRoot()) || !existsSync(job.worktreePath)) {
    return touch(job, {
      parallelStatus: 'blocked',
      blockedReason: 'worktree 폴더를 찾을 수 없습니다. 먼저 worktree를 준비하세요.',
      logLines: [...job.logLines, '차단됨: worktree 폴더 없음']
    })
  }
  // Max-2 concurrency for parallel worktree writers.
  if (activeParallelCount() >= MAX_PARALLEL_JOBS) {
    return touch(job, {
      logLines: [...job.logLines, `병렬 실행 한도(${MAX_PARALLEL_JOBS})에 도달했습니다. 잠시 후 다시 시도하세요.`]
    })
  }
  const safety = scanAutoBuildPrompt(job.generatedPrompt, true)
  if (!safety.promptSafe) {
    return touch(job, {
      parallelStatus: 'blocked',
      blockedReason: safety.blockedReason,
      logLines: [...job.logLines, `차단됨: ${safety.blockedReason}`]
    })
  }

  job = touch(job, {
    parallelStatus: 'running',
    startedAt: nowIso(),
    logLines: [...job.logLines, `Claude Code를 worktree에서 실행합니다: ${job.worktreePath}`]
  })
  spawnClaudeInWorktree(sourceJobId, 'claude')
  return parallelJobs.get(sourceJobId) ?? job
}

function spawnClaudeInWorktree(sourceJobId: string, command: 'claude' | 'npx'): void {
  const job = parallelJobs.get(sourceJobId)
  if (!job || !job.worktreePath) return
  const runArgs = ['-p', '--permission-mode', CLAUDE_PERMISSION_MODE]
  const args = command === 'claude' ? runArgs : ['@anthropic-ai/claude-code', ...runArgs]

  let child: ChildProcess
  try {
    child = spawnTool(command, args, { cwd: job.worktreePath, windowsHide: true })
  } catch {
    onSpawnErr(sourceJobId, command)
    return
  }
  procs.set(sourceJobId, child)
  child.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') onSpawnErr(sourceJobId, command)
    else log(sourceJobId, `실행 오류: ${err.message}`)
  })
  try {
    child.stdin?.write(job.generatedPrompt)
    child.stdin?.end()
  } catch {
    log(sourceJobId, '프롬프트 전달 중 오류가 발생했습니다.')
  }
  child.stdout?.on('data', (d: Buffer) =>
    log(sourceJobId, d.toString().split(/\r?\n/).filter(Boolean).join('\n'))
  )
  child.stderr?.on('data', (d: Buffer) =>
    log(sourceJobId, d.toString().split(/\r?\n/).filter(Boolean).join('\n'))
  )
  child.on('close', (code) => {
    procs.delete(sourceJobId)
    const cur = parallelJobs.get(sourceJobId)
    if (!cur) return
    if (code !== 0) {
      touch(cur, {
        parallelStatus: 'failed',
        finishedAt: nowIso(),
        logLines: [...cur.logLines, `Claude Code 실패 · exit ${code}`]
      })
      return
    }
    touch(cur, { logLines: [...cur.logLines, `Claude Code 완료 · exit ${code} · 검증을 시작합니다…`] })
    void verifyWorktree(sourceJobId)
  })
}

function onSpawnErr(sourceJobId: string, command: 'claude' | 'npx'): void {
  if (command === 'claude') {
    log(sourceJobId, 'claude 명령을 찾을 수 없습니다. npx @anthropic-ai/claude-code 로 재시도합니다…')
    spawnClaudeInWorktree(sourceJobId, 'npx')
    return
  }
  const job = parallelJobs.get(sourceJobId)
  if (!job) return
  touch(job, {
    parallelStatus: 'failed',
    finishedAt: nowIso(),
    logLines: [...job.logLines, 'Claude Code 실행 환경을 찾지 못했습니다.']
  })
}

function runFixedIn(cwd: string, command: string, args: string[]): Promise<{ code: number; out: string }> {
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
    child.on('error', () => resolveP({ code: -1, out: `${command} 실행 실패` }))
    child.on('close', (code) => resolveP({ code: code ?? -1, out }))
  })
}

/**
 * Verification INSIDE the worktree (informational). A fresh worktree has no
 * node_modules, so typecheck/build may fail — results are shown for the merge
 * review but do NOT block the needs-merge-review status. No commit / merge.
 */
async function verifyWorktree(sourceJobId: string): Promise<void> {
  let job = parallelJobs.get(sourceJobId)
  if (!job || !job.worktreePath) return
  const cwd = job.worktreePath
  job = touch(job, {
    parallelStatus: 'verifying',
    verificationResult: { typecheckStatus: 'running', buildStatus: 'pending', gitStatusShort: '' },
    logLines: [...job.logLines, '검증(참고용): npm run typecheck']
  })
  const tc = await runFixedIn(cwd, 'npm', ['run', 'typecheck'])
  const typecheckStatus = tc.code === 0 ? 'passed' : 'failed'
  const bd = await runFixedIn(cwd, 'npm', ['run', 'build'])
  const buildStatus = bd.code === 0 ? 'passed' : 'failed'
  const gs = await runFixedIn(cwd, 'git', ['status', '--short'])
  const verification: ClaudeAutoBuildVerification = {
    typecheckStatus,
    buildStatus,
    gitStatusShort: gs.out.trim().slice(0, 2000)
  }
  // Claude finished in an isolated folder → always park at merge review (no merge).
  touch(parallelJobs.get(sourceJobId)!, {
    parallelStatus: 'needs-merge-review',
    finishedAt: nowIso(),
    verificationResult: verification,
    logLines: [
      ...parallelJobs.get(sourceJobId)!.logLines,
      `검증(참고): typecheck=${typecheckStatus}, build=${buildStatus}`,
      '작업이 별도 폴더에서 완료되었습니다. 병합은 다음 단계에서 대표님 승인 후 진행됩니다.'
    ]
  })
}
