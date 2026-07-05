import { app } from 'electron'
import { type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  ChangedFileStatus,
  ParallelBuildJob,
  ReviewDecision,
  WorktreeChangedFile,
  WorktreeCommitResult,
  WorktreeMergeResult,
  WorktreeReview
} from '@shared/claudeParallel'
import {
  MAX_DIFF_PREVIEW_CHARS,
  MAX_DIFF_PREVIEW_LINES,
  MAX_PARALLEL_JOBS
} from '@shared/claudeParallel'
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

/**
 * Link the main workspace's node_modules into the worktree (read-only dep reuse)
 * so typecheck/build can run there. Best-effort, never destructive: a Windows
 * junction / posix dir symlink; skipped if it already exists.
 */
function linkNodeModules(worktreePath: string): string {
  const target = join(mainWorkspace(), 'node_modules')
  const link = join(worktreePath, 'node_modules')
  if (existsSync(link)) return 'node_modules 이미 존재'
  if (!existsSync(target)) return 'node_modules 원본 없음 (검증이 제한될 수 있음)'
  try {
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    return 'node_modules 링크 생성 (검증 가능)'
  } catch (e) {
    return `node_modules 링크 실패: ${e instanceof Error ? e.message : ''}`
  }
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
      // Link the main workspace's node_modules into the worktree (read-only dep
      // reuse) so typecheck/build can run there. Best-effort; never destructive.
      const linkMsg = linkNodeModules(worktreePath)
      touch(cur, {
        parallelStatus: 'worktree-created',
        canRunInParallel: true,
        logLines: [...cur.logLines, trimmed, `worktree 생성 완료 · 브랜치 ${branchName}`, linkMsg].filter(Boolean)
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
  // If verification passed AND there are changes → ready to commit. Otherwise park
  // at merge review (nothing to commit, or verification needs attention).
  const hasChanges = verification.gitStatusShort.trim().length > 0
  const verified = typecheckStatus === 'passed' && buildStatus === 'passed'
  const nextStatus = verified && hasChanges ? 'commit-ready' : 'needs-merge-review'
  touch(parallelJobs.get(sourceJobId)!, {
    parallelStatus: nextStatus,
    finishedAt: nowIso(),
    verificationResult: verification,
    logLines: [
      ...parallelJobs.get(sourceJobId)!.logLines,
      `검증: typecheck=${typecheckStatus}, build=${buildStatus}`,
      nextStatus === 'commit-ready'
        ? '변경사항이 있어 커밋 준비됨. “Worktree 커밋 생성”을 눌러 커밋하세요.'
        : hasChanges
          ? '검증 실패 상태입니다. 커밋 전에 확인이 필요합니다.'
          : '변경된 파일이 없습니다.'
    ]
  })
}

// --- worktree result review (read-only; NO merge) --------------------------

/** Parse `git status --short` into a changed-file list (covers untracked too). */
function parseStatusShort(out: string): WorktreeChangedFile[] {
  return out
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const code = line.slice(0, 2)
      let path = line.slice(3).trim()
      const c = code.trim()
      let status: ChangedFileStatus = 'unknown'
      if (code === '??' || c === 'A') status = 'added'
      else if (c.includes('D')) status = 'deleted'
      else if (c.includes('R')) status = 'renamed'
      else if (c.includes('M')) status = 'modified'
      if (status === 'renamed' && path.includes('->')) path = path.split('->').pop()!.trim()
      return { path, status }
    })
    .slice(0, 500)
}

/**
 * Read-only inspection of a worktree job's changes. Runs ONLY fixed git inspection
 * commands (status/diff/branch) inside the validated worktree — never a merge,
 * never a write. The diff preview is size-limited to keep the UI responsive.
 */
export async function loadWorktreeReview(sourceJobId: string): Promise<WorktreeReview> {
  const job = parallelJobs.get(sourceJobId)
  const base: WorktreeReview = {
    jobId: sourceJobId,
    title: job?.title ?? sourceJobId,
    worktreePath: job?.worktreePath,
    branchName: job?.branchName,
    status: 'failed',
    changedFiles: [],
    diffStat: '',
    diffPreview: '',
    diffTruncated: false,
    gitStatusShort: '',
    reviewDecision: job?.reviewDecision ?? 'not-reviewed',
    reviewedAt: job?.reviewedAt,
    notes: job?.reviewNotes
  }
  if (!job) return { ...base, error: '작업을 찾을 수 없습니다.' }
  const wp = job.worktreePath
  if (!wp || !wp.startsWith(worktreesRoot()) || !existsSync(wp)) {
    return { ...base, error: 'worktree 폴더를 찾을 수 없습니다. 먼저 worktree를 준비/실행하세요.' }
  }

  const [statusR, statR, diffR, branchR] = await Promise.all([
    runFixedIn(wp, 'git', ['status', '--short']),
    runFixedIn(wp, 'git', ['diff', '--stat']),
    runFixedIn(wp, 'git', ['diff']),
    runFixedIn(wp, 'git', ['branch', '--show-current'])
  ])

  const rawDiff = diffR.out
  const lines = rawDiff.split(/\r?\n/)
  let diffTruncated = false
  let diffPreview = rawDiff
  if (lines.length > MAX_DIFF_PREVIEW_LINES || rawDiff.length > MAX_DIFF_PREVIEW_CHARS) {
    diffTruncated = true
    diffPreview = lines.slice(0, MAX_DIFF_PREVIEW_LINES).join('\n').slice(0, MAX_DIFF_PREVIEW_CHARS)
  }

  return {
    ...base,
    branchName: branchR.out.trim() || job.branchName,
    status: 'ready',
    changedFiles: parseStatusShort(statusR.out),
    diffStat: statR.out.trim().slice(0, 6000),
    diffPreview,
    diffTruncated,
    gitStatusShort: statusR.out.trim().slice(0, 4000),
    verificationSummary: job.verificationResult
  }
}

/** Record a review decision. This ONLY marks state — it never merges. */
export function markReviewDecision(
  sourceJobId: string,
  decision: ReviewDecision,
  notes?: string
): ParallelBuildJob | null {
  const job = parallelJobs.get(sourceJobId)
  if (!job) return null
  return touch(job, {
    reviewDecision: decision,
    reviewNotes: notes,
    reviewedAt: nowIso(),
    logLines: [...job.logLines, `검토 결정: ${decision}${notes ? ` · ${notes}` : ''}`]
  })
}

// --- approved merge (main workspace; explicit; no push, no force) ----------

/** A safe worktree branch is exactly `sjos/auto/<slug>`. */
function isSafeBranch(branch: string | undefined): boolean {
  return !!branch && /^sjos\/auto\/[\p{L}\p{N}-]+$/u.test(branch)
}

/** Parse conflict/unmerged files from `git status --short` (UU/AA/DD/AU/UA/UD/DU). */
function parseConflictFiles(statusShort: string): string[] {
  return statusShort
    .split(/\r?\n/)
    .filter((l) => /^(UU|AA|DD|AU|UA|UD|DU)\s/.test(l))
    .map((l) => l.slice(3).trim())
    .slice(0, 200)
}

/**
 * Merge an APPROVED worktree branch into the main workspace — only on explicit
 * request, only when eligible. Runs `git merge --no-ff <safeBranch>` in the main
 * workspace, then verification. Conflicts are left for MANUAL resolution (no
 * abort/reset/clean/force). NEVER pushes.
 */
export async function mergeApprovedWorktree(sourceJobId: string): Promise<WorktreeMergeResult> {
  const main = mainWorkspace()
  const job = parallelJobs.get(sourceJobId)
  const base: WorktreeMergeResult = {
    jobId: sourceJobId,
    status: 'blocked',
    branchName: job?.branchName,
    worktreePath: job?.worktreePath,
    mainWorkspacePath: main,
    preMergeStatus: '',
    mergeLogLines: [],
    conflictFiles: []
  }
  if (!job) return { ...base, errorMessage: '작업을 찾을 수 없습니다.' }

  // 1) Eligibility: paths, branch, review decision.
  if (!job.worktreePath || !job.worktreePath.startsWith(worktreesRoot()) || !existsSync(job.worktreePath)) {
    return { ...base, errorMessage: '허용된 worktree를 찾을 수 없습니다.' }
  }
  if (!isSafeBranch(job.branchName)) {
    return { ...base, errorMessage: '안전한 브랜치 이름이 아닙니다.' }
  }
  if (job.baseWorkspacePath !== main) {
    return { ...base, errorMessage: '메인 작업 폴더가 일치하지 않습니다.' }
  }
  if (job.reviewDecision !== 'approved-for-merge') {
    return { ...base, errorMessage: '병합 승인(approved-for-merge) 상태가 아닙니다.' }
  }

  // 2) Main workspace must be clean.
  const preStatus = await runFixedIn(main, 'git', ['status', '--short'])
  const preMergeStatus = preStatus.out.trim()
  if (preMergeStatus.length > 0) {
    return {
      ...base,
      preMergeStatus,
      errorMessage: '메인 작업 폴더에 미커밋 변경사항이 있어 병합을 차단했습니다.'
    }
  }

  // 3) Merge (explicit, no-ff, no push).
  const startedAt = nowIso()
  const branch = job.branchName!
  const merge = await runFixedIn(main, 'git', ['merge', '--no-ff', branch])
  const mergeLogLines = merge.out.trim().split(/\r?\n/).filter(Boolean).slice(-200)

  // 4) Detect conflicts (never auto-resolve).
  const postStatus = await runFixedIn(main, 'git', ['status', '--short'])
  const conflictFiles = parseConflictFiles(postStatus.out)
  if (merge.code !== 0 || conflictFiles.length > 0) {
    return {
      ...base,
      status: 'conflict',
      preMergeStatus,
      startedAt,
      finishedAt: nowIso(),
      mergeLogLines: [
        ...mergeLogLines,
        '병합 충돌이 발생했습니다. 자동 해결하지 않습니다. 수동 확인이 필요합니다.'
      ],
      conflictFiles,
      errorMessage: '병합 충돌 · 수동 확인 필요'
    }
  }

  // 5) Post-merge verification in the MAIN workspace (has node_modules).
  const tc = await runFixedIn(main, 'npm', ['run', 'typecheck'])
  const typecheckStatus = tc.code === 0 ? 'passed' : 'failed'
  const bd = await runFixedIn(main, 'npm', ['run', 'build'])
  const buildStatus = bd.code === 0 ? 'passed' : 'failed'
  const gs = await runFixedIn(main, 'git', ['status', '--short'])
  const verification = {
    typecheckStatus: typecheckStatus as 'passed' | 'failed',
    buildStatus: buildStatus as 'passed' | 'failed',
    gitStatusShort: gs.out.trim().slice(0, 2000)
  }
  const finalStatus = typecheckStatus === 'passed' && buildStatus === 'passed' ? 'succeeded' : 'needs-review'

  return {
    ...base,
    status: finalStatus,
    preMergeStatus,
    startedAt,
    finishedAt: nowIso(),
    mergeLogLines: [
      ...mergeLogLines,
      `병합 완료 · 검증 typecheck=${typecheckStatus}, build=${buildStatus}`,
      '병합은 완료되었지만 push는 자동으로 하지 않았습니다.'
    ],
    conflictFiles: [],
    verification
  }
}

// --- controlled worktree commit (explicit; safe staging; no push) ----------

const AUDIO_EXT = /\.(mp3|wav|m4a|webm|ogg|flac|aac)$/i
const SECRET_IN_DIFF = [/sk-ant-[A-Za-z0-9_-]{16,}/, /sk-[A-Za-z0-9_-]{16,}/, /(?:OPENAI|ANTHROPIC)_API_KEY\s*=\s*['"]?[A-Za-z0-9_-]{12,}/]

/** A path that must NEVER be committed (blocks the whole commit). */
function isBlockedPath(p: string): boolean {
  const l = p.replace(/\\/g, '/').toLowerCase()
  return l === '.env' || l.endsWith('/.env') || l.includes('.env.local') || /(^|\/)\.env(\.|$)/.test(l)
}
/** A path that is skipped from staging (not committed, but doesn't block). */
function isSkippedPath(p: string): boolean {
  const l = p.replace(/\\/g, '/').toLowerCase()
  return l.includes('node_modules/') || AUDIO_EXT.test(l) || l.includes('..')
}

function sanitizeCommitMessage(title: string): string {
  const clean = (title ?? '')
    .replace(/[\r\n"`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
  if (!clean) return 'feat: SJ OS 자동 개발 변경'
  return /^(feat|fix|chore|docs|refactor|style|test)\b|:/.test(clean) ? clean : `feat: ${clean}`
}

/**
 * Commit a worktree's changes ON ITS BRANCH so the merge flow has something to
 * merge. Explicit only (user click). Stages ONLY the specific safe changed files
 * (never `git add .`), blocks .env/secrets, never pushes.
 */
export async function commitWorktreeJob(sourceJobId: string): Promise<WorktreeCommitResult> {
  const job = parallelJobs.get(sourceJobId)
  const base: WorktreeCommitResult = {
    jobId: sourceJobId,
    worktreePath: job?.worktreePath,
    branchName: job?.branchName,
    status: 'blocked',
    changedFiles: [],
    commitMessage: sanitizeCommitMessage(job?.title ?? '')
  }
  if (!job) return { ...base, errorMessage: '작업을 찾을 수 없습니다.' }
  const wp = job.worktreePath
  if (!wp || !wp.startsWith(worktreesRoot()) || !existsSync(wp)) {
    return { ...base, errorMessage: '허용된 worktree를 찾을 수 없습니다.' }
  }
  if (!isSafeBranch(job.branchName)) return { ...base, errorMessage: '안전한 브랜치 이름이 아닙니다.' }

  // Verification must have passed in the worktree.
  const v = job.verificationResult
  if (!v || v.typecheckStatus !== 'passed' || v.buildStatus !== 'passed') {
    return { ...base, errorMessage: '검증 실패 상태에서는 커밋할 수 없습니다.' }
  }

  // Changed files.
  const statusR = await runFixedIn(wp, 'git', ['status', '--short'])
  const entries = parseStatusShort(statusR.out)
  if (entries.length === 0) return { ...base, errorMessage: '커밋할 변경사항이 없습니다.' }

  // Block entirely on .env; skip node_modules/audio.
  if (entries.some((e) => isBlockedPath(e.path))) {
    return { ...base, errorMessage: '.env 변경이 감지되어 커밋을 차단했습니다.' }
  }
  const safeFiles = entries.map((e) => e.path).filter((p) => !isSkippedPath(p))
  if (safeFiles.length === 0) return { ...base, errorMessage: '커밋 가능한 안전한 변경 파일이 없습니다.' }

  // Secret scan on the diff text.
  const diffR = await runFixedIn(wp, 'git', ['diff'])
  if (SECRET_IN_DIFF.some((re) => re.test(diffR.out))) {
    return { ...base, errorMessage: '민감 정보(비밀 키 값)로 보이는 문자열이 diff에 있어 커밋을 차단했습니다.' }
  }

  const startedAt = nowIso()
  touch(job, { parallelStatus: 'committing', logLines: [...job.logLines, `커밋 준비: ${safeFiles.length}개 파일`] })

  // Stage ONLY the specific safe files (never `git add .`).
  const addR = await runFixedIn(wp, 'git', ['add', ...safeFiles])
  if (addR.code !== 0) {
    touch(job, { parallelStatus: 'commit-ready', logLines: [...job.logLines, 'git add 실패'] })
    return { ...base, status: 'failed', changedFiles: safeFiles, startedAt, finishedAt: nowIso(), errorMessage: 'git add 실패' }
  }

  const message = sanitizeCommitMessage(job.title)
  const commitR = await runFixedIn(wp, 'git', ['commit', '-m', message])
  if (commitR.code !== 0) {
    touch(job, { parallelStatus: 'commit-ready', logLines: [...job.logLines, `git commit 실패: ${commitR.out.slice(-300)}`] })
    return { ...base, status: 'failed', changedFiles: safeFiles, commitMessage: message, startedAt, finishedAt: nowIso(), errorMessage: 'git commit 실패' }
  }

  const logR = await runFixedIn(wp, 'git', ['log', '--oneline', '-1'])
  const commitHash = logR.out.trim().split(/\s+/)[0] || undefined

  touch(job, {
    parallelStatus: 'needs-merge-review',
    logLines: [
      ...job.logLines,
      `커밋 완료 · ${commitHash ?? ''} · ${message}`,
      'worktree 커밋은 완료됐지만 push는 자동으로 하지 않았습니다.'
    ]
  })

  return {
    ...base,
    status: 'committed',
    changedFiles: safeFiles,
    commitMessage: message,
    commitHash,
    stdoutPreview: commitR.out.slice(0, 2000),
    startedAt,
    finishedAt: nowIso()
  }
}
