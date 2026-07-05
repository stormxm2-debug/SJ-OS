/**
 * Shared contract for the Jarvis → Claude Code Auto Builder.
 *
 * A ClaudeAutoBuildJob is a development task: SJ OS generates a Claude Code-ready
 * prompt from a user command, then the ELECTRON MAIN process runs Claude Code
 * (never the renderer) inside the allowed workspace, streams logs back, and runs
 * fixed verification commands (typecheck / build / git status). No arbitrary shell
 * command ever crosses from the renderer.
 */

import { DANGEROUS_COMMAND_PATTERNS } from './claudeCode'

export type ClaudeAutoBuildSource = 'jarvis' | 'developer-prompt-center' | 'universal-app-builder'

export type ClaudeAutoBuildStatus =
  | 'draft'
  | 'prompt-generated'
  | 'safety-checking'
  | 'blocked'
  | 'ready'
  | 'queued'
  | 'running'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'needs-review'
  | 'skipped'

/**
 * Which resources a job's changes touch. Used to reason about (future) parallel
 * safety. For now every real code-writing job is 'main-workspace' and serialized.
 */
export type ConflictGroup = 'main-workspace' | 'frontend' | 'backend' | 'docs' | 'tests' | 'unknown'

/** Queue-level state (Electron main owns it). */
export interface QueueState {
  autoRun: boolean
  paused: boolean
  pausedReason?: string
}

export type VerificationStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped'

export interface SafetyResult {
  workspaceAllowed: boolean
  /** True when the prompt is safe to run (no execution-intent danger, no secrets). */
  promptSafe: boolean
  /** True when execution is blocked (unsafe prompt or disallowed workspace). */
  blocked: boolean
  /** Dangerous commands that appear as EXECUTION instructions → block. */
  dangerousPatterns: string[]
  /** Dangerous commands that appear ONLY inside forbidden/safety lists → allowed. */
  allowedSafetyMentions: string[]
  /** Real secret-value matches → block. */
  secretPatterns: string[]
  /** All blocking reasons (empty when allowed). */
  blockedReasons: string[]
  /** Convenience: blockedReasons joined for one-line display. */
  blockedReason?: string
}

export interface ClaudeAutoBuildVerification {
  typecheckStatus: VerificationStatus
  buildStatus: VerificationStatus
  gitStatusShort: string
}

export interface ClaudeAutoBuildJob {
  id: string
  title: string
  source: ClaudeAutoBuildSource
  originalUserCommand: string
  generatedPrompt: string
  workspacePath: string
  status: ClaudeAutoBuildStatus
  safetyResult: SafetyResult
  logLines: string[]
  stdoutPreview: string
  stderrPreview: string
  startedAt?: string
  finishedAt?: string
  exitCode?: number
  verification: ClaudeAutoBuildVerification
  promptFilePath?: string
  // --- auto-repair (this job repairs a failed source job) ---
  /** The source job this repair job fixes (undefined for normal jobs). */
  repairOfJobId?: string
  /** 1-based repair attempt in the source chain (max 2). */
  repairAttempt?: number
  /** Repair jobs never run until the user explicitly approves. */
  repairApproved?: boolean
  /** Which stage of the source job failed. */
  failedStage?: RepairStage
  /** One-line error summary shown in the repair card. */
  errorSummary?: string
  // --- commit / push (main workspace) ---
  committed?: boolean
  commitHash?: string
  pushed?: boolean
  // --- queue ---
  /** Monotonic position used to order the queue (FIFO). */
  queueIndex: number
  queuedAt?: string
  /** Optional explicit predecessor (reserved for future dependency ordering). */
  runAfterJobId?: string
  /** Snapshot of queue auto-run at enqueue time (informational). */
  autoRun: boolean
  /** Which resources this job's edits touch (all serialize on 'main-workspace' now). */
  conflictGroup: ConflictGroup
  /** Always false for now — true parallel writers are not enabled. */
  canRunInParallel: boolean
  createdAt: string
  updatedAt: string
}

export type CommitPushStatus =
  | 'not-ready'
  | 'ready-to-review'
  | 'commit-ready'
  | 'committing'
  | 'committed'
  | 'push-ready'
  | 'pushing'
  | 'pushed'
  | 'blocked'
  | 'failed'

/** Commit/push state for a succeeded main-workspace job (main-only git). */
export interface ClaudeJobCommitState {
  jobId: string
  status: CommitPushStatus
  changedFiles: string[]
  diffStat: string
  gitStatusShort: string
  commitMessage: string
  commitHash?: string
  currentBranch: string
  pushRemote: 'origin'
  pushTargetBranch: string
  committedAt?: string
  pushedAt?: string
  errorMessage?: string
  logLines: string[]
}

/** Which stage of an auto-build job failed. */
export type RepairStage = 'typecheck' | 'build' | 'claude-run' | 'unknown'

/** Max auto-repair jobs generated per source-job chain. */
export const MAX_REPAIR_ATTEMPTS = 2

/** Build a focused Claude Code repair prompt from a failed job's error logs. */
export function generateRepairPrompt(args: {
  originalCommand: string
  title: string
  stage: RepairStage
  errorLogs: string
  workspacePath: string
}): string {
  return `IMPORTANT:
시니어 Electron/React/TypeScript 엔지니어로서 행동하세요.

## Mission
이전 SJ OS 자동 개발 작업이 실패했습니다. 실패한 ${args.stage} 오류만 수정하세요.
새 기능 추가나 재설계는 하지 마세요.

## 원래 요청
${args.originalCommand}

## 작업
${args.title}

## 실패 단계
${args.stage}

## 오류 로그
\`\`\`
${args.errorLogs}
\`\`\`

## 규칙 (Hard rules)
- 위에 표시된 오류만 수정할 것. 관련 없는 파일/기능을 건드리지 말 것.
- 재설계 금지 · 동작하는 코드를 다시 쓰지 말 것.
- .env / .env.local 및 API 키를 만지지 말 것.
- 런타임 클릭 상호작용을 깨뜨리지 말 것.
- 파괴적 명령을 절대 사용 금지: git reset --hard, git clean -fd, git push --force,
  git push -f, rm -rf, Remove-Item -Recurse, del /s, format.

## 검증 (구현 후 반드시 실행)
- npm run typecheck
- npm run build
- git status --short

## 작업 폴더
${args.workspacePath}
`
}

/** Renderer → main: create a job from a pre-generated prompt. */
export interface CreateAutoBuildJobRequest {
  title: string
  source: ClaudeAutoBuildSource
  originalUserCommand: string
  generatedPrompt: string
  workspacePath: string
}

/** Emitted to the renderer whenever a job changes. */
export interface AutoBuildJobUpdate {
  job: ClaudeAutoBuildJob
}

/** Which runner the environment can use. */
export type SelectedRunner = 'claude' | 'npx' | 'unavailable'

/** Result of the fixed environment checks (main process). */
export interface ClaudeRunnerDiagnostics {
  checkedAt: string
  workspacePath: string
  workspaceAllowed: boolean
  nodeAvailable: boolean
  npmAvailable: boolean
  npxAvailable: boolean
  claudeCommandAvailable: boolean
  npxClaudeCodeAvailable: boolean
  selectedRunner: SelectedRunner
  claudeVersion?: string
  npxVersion?: string
  nodeVersion?: string
  npmVersion?: string
  /** Resolved full paths (Windows `where.exe`), for display/diagnostics. */
  nodePath?: string
  npmPath?: string
  npxPath?: string
  claudePath?: string
  errorMessages: string[]
  warnings: string[]
  canRun: boolean
}

/** Result of the harmless smoke test. */
export interface ClaudeSmokeTestResult {
  ok: boolean
  runner: SelectedRunner
  output: string
  error?: string
  timedOut: boolean
}

/**
 * Classify which resource group a command touches (heuristic). This does NOT
 * enable parallelism yet — every real code-writing job still serializes on the
 * main workspace — it only labels jobs for the future worktree strategy.
 */
export function classifyConflictGroup(command: string): ConflictGroup {
  const t = (command ?? '').toLowerCase()
  const has = (words: string[]): boolean => words.some((w) => t.includes(w.toLowerCase()))
  if (has(['서버', 'api', '백엔드', 'backend', 'db', '데이터베이스', '엔드포인트', 'endpoint'])) return 'backend'
  if (has(['화면', 'ui', '버튼', '페이지', 'page', 'screen', 'component', '컴포넌트', '프론트'])) return 'frontend'
  if (has(['문서', 'readme', 'docs', '가이드', 'documentation'])) return 'docs'
  if (has(['테스트', 'test', '검증', 'spec'])) return 'tests'
  return 'main-workspace'
}

/**
 * Actual secret-VALUE patterns. We deliberately do NOT block on the bare words
 * `.env` / `OPENAI_API_KEY`, because prompts mention them in "do not touch" rules.
 * Only real key values or `API_KEY = <token>` assignments block.
 */
const SECRET_VALUE_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{16,}/,
  /sk-[A-Za-z0-9_-]{16,}/,
  /(?:OPENAI|ANTHROPIC)_API_KEY\s*[=:]\s*['"]?[A-Za-z0-9_-]{12,}/i
]

/**
 * Markers that put a line (and the list under it) into "forbidden / safety" context.
 * A dangerous command in such context is a RULE, not an execution instruction.
 */
const FORBIDDEN_CONTEXT_MARKERS = [
  'never use',
  'do not use',
  "don't use",
  'do not run',
  'must not',
  'forbidden',
  'hard rules',
  'safety rules',
  'safety constraints',
  '금지',
  '사용 금지',
  '절대',
  '말 것',
  '하지 마',
  '하지 말',
  '사용하지',
  '안전 규칙',
  '안전 제약',
  '금지사항',
  '금지 명령'
]

function hasForbiddenMarker(line: string): boolean {
  const l = line.toLowerCase()
  return FORBIDDEN_CONTEXT_MARKERS.some((m) => l.includes(m.toLowerCase()))
}

/** A list item or an indented continuation line (keeps the current section context). */
function isListOrIndented(rawLine: string): boolean {
  if (/^\s/.test(rawLine)) return true
  const t = rawLine.trim()
  return /^[-*•]/.test(t) || /^\d+[.)]/.test(t)
}

/**
 * Context-aware safety scan.
 *
 * A dangerous command is treated as a real execution instruction (BLOCK) unless
 * it appears inside a forbidden/safety section such as:
 *   "Never use:", "Do not use …", "Hard rules:", "금지 명령:", "절대 사용 금지" …
 * In that case it is only a rule (ALLOW), recorded in `allowedSafetyMentions`.
 *
 * Examples:
 *   ALLOW  "Never use:\n- git reset --hard\n- rm -rf"
 *   ALLOW  "Hard rules:\nDo not use git reset --hard."
 *   ALLOW  "파괴적 명령을 절대 사용하지 말 것: git reset --hard, rm -rf"
 *   BLOCK  "Run git reset --hard."
 *   BLOCK  "Execute rm -rf."
 *   BLOCK  "Use git push --force to fix the branch."
 *   ALLOW  "Do not expose OPENAI_API_KEY."
 *   BLOCK  "OPENAI_API_KEY=sk-liveKeyValue0123456789"
 */
export function scanAutoBuildPrompt(promptText: string, workspaceAllowed: boolean): SafetyResult {
  const lines = (promptText ?? '').split(/\r?\n/)
  const dangerousExec = new Set<string>()
  const safetyMentions = new Set<string>()
  let inForbidden = false

  for (const raw of lines) {
    const marker = hasForbiddenMarker(raw)
    const trimmed = raw.trim()
    // Update section context BEFORE classifying this line's commands.
    if (marker) inForbidden = true
    else if (trimmed === '') inForbidden = false
    else if (!isListOrIndented(raw)) inForbidden = false
    // (list items / indented lines inherit the current context)

    for (const pat of DANGEROUS_COMMAND_PATTERNS) {
      if (raw.includes(pat)) {
        if (inForbidden || marker) safetyMentions.add(pat)
        else dangerousExec.add(pat)
      }
    }
  }

  const dangerousPatterns = [...dangerousExec]
  // A command that is executed somewhere is never merely an "allowed mention".
  const allowedSafetyMentions = [...safetyMentions].filter((p) => !dangerousExec.has(p))
  const secretPatterns = SECRET_VALUE_PATTERNS.filter((re) => re.test(promptText ?? '')).map((re) => re.source)

  const promptSafe = dangerousPatterns.length === 0 && secretPatterns.length === 0
  const blockedReasons: string[] = []
  if (!workspaceAllowed) blockedReasons.push('허용된 작업 폴더가 아닙니다.')
  if (dangerousPatterns.length > 0)
    blockedReasons.push(`위험 명령 실행 지시 감지: ${dangerousPatterns.join(', ')}`)
  if (secretPatterns.length > 0) blockedReasons.push('민감 정보(비밀 키 값)로 보이는 문자열이 포함되어 있습니다.')

  return {
    workspaceAllowed,
    promptSafe,
    blocked: !promptSafe || !workspaceAllowed,
    dangerousPatterns,
    allowedSafetyMentions,
    secretPatterns,
    blockedReasons,
    blockedReason: blockedReasons.length > 0 ? blockedReasons.join(' / ') : undefined
  }
}
