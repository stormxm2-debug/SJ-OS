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
  promptSafe: boolean
  dangerousPatterns: string[]
  secretPatterns: string[]
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

/**
 * Actual secret-VALUE patterns (e.g. `sk-abc123…`). We deliberately do NOT block
 * on the bare words `.env` / `OPENAI_API_KEY`, because our own prompts mention
 * them in "do not touch" safety rules. Only real-looking secret values block.
 */
const SECRET_VALUE_PATTERNS = [/sk-[A-Za-z0-9-]{16,}/, /sk-ant-[A-Za-z0-9-]{16,}/]

/** Scan a generated prompt for destructive commands and real secret values. */
export function scanAutoBuildPrompt(promptText: string, workspaceAllowed: boolean): SafetyResult {
  const dangerousPatterns = DANGEROUS_COMMAND_PATTERNS.filter((p) => promptText.includes(p))
  const secretPatterns = SECRET_VALUE_PATTERNS.filter((re) => re.test(promptText)).map((re) => re.source)
  const promptSafe = dangerousPatterns.length === 0 && secretPatterns.length === 0
  const reasons: string[] = []
  if (!workspaceAllowed) reasons.push('허용된 작업 폴더가 아닙니다.')
  if (dangerousPatterns.length > 0) reasons.push(`위험 명령 감지: ${dangerousPatterns.join(', ')}`)
  if (secretPatterns.length > 0) reasons.push('민감 정보(비밀 키 값)로 보이는 문자열이 포함되어 있습니다.')
  return {
    workspaceAllowed,
    promptSafe,
    dangerousPatterns,
    secretPatterns,
    blockedReason: reasons.length > 0 ? reasons.join(' / ') : undefined
  }
}
