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
  | 'running'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'needs-review'

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
  createdAt: string
  updatedAt: string
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
