/**
 * Shared contract for the Claude Code Bridge.
 *
 * SJ OS generates Claude Code-ready prompts and lets the user COPY them or EXPORT
 * them to a local .md file for pasting into the Claude Code CLI. The renderer
 * never runs shell commands; file export happens in the Electron MAIN process,
 * restricted to a safe folder inside the project workspace. Actual Claude Code
 * execution is intentionally NOT implemented yet.
 */

/** Renderer → main: request to write a prompt to a safe .md file. */
export interface ClaudeExportRequest {
  /** Human title (used to derive the filename). */
  title: string
  /** The full prompt text to write. */
  promptText: string
  /** The workspace the prompt targets (validated in main; write path is main-controlled). */
  workspacePath: string
}

/** Main → renderer: result of a prompt export. Never throws across IPC. */
export interface ClaudeExportResult {
  success: boolean
  /** Absolute path of the written file (present on success). */
  filePath?: string
  /** File name only (present on success). */
  fileName?: string
  /** Machine-readable failure code. */
  errorCode?: string
  /** Korean, UI-ready failure message. */
  errorMessage?: string
}

/**
 * Destructive command patterns. Prompts that would instruct Claude Code to run
 * these are flagged for review. (Our own generated prompts mention them in
 * "금지" safety rules, so these are WARNINGS for review, not hard blocks.)
 */
export const DANGEROUS_COMMAND_PATTERNS = [
  'git reset --hard',
  'git clean -fd',
  'git push --force',
  'git push -f',
  'rm -rf',
  'Remove-Item -Recurse',
  'del /s',
  'format '
]

/** Secret / .env patterns that must never be exported or exposed. */
export const SECRET_ENV_PATTERNS = ['.env', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'sk-']

/** Result of scanning prompt text for risky content. */
export interface PromptSafetyScan {
  containsDangerousCommand: boolean
  containsEnvWarning: boolean
  matchedDangerous: string[]
  matchedEnv: string[]
}

/** Scan prompt text for dangerous-command and secret/.env patterns. */
export function scanPromptText(text: string): PromptSafetyScan {
  const matchedDangerous = DANGEROUS_COMMAND_PATTERNS.filter((p) => text.includes(p))
  const matchedEnv = SECRET_ENV_PATTERNS.filter((p) => text.includes(p))
  return {
    containsDangerousCommand: matchedDangerous.length > 0,
    containsEnvWarning: matchedEnv.length > 0,
    matchedDangerous,
    matchedEnv
  }
}
