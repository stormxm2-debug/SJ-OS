/**
 * Claude Code Bridge domain (renderer).
 *
 * A ClaudeCodeJob is a Claude Code-ready prompt prepared for delivery: the user
 * can copy it or export it to a local .md file. Actual Claude Code CLI execution
 * is intentionally NOT implemented yet — jobs stay in a "prepare" state.
 */

export type ClaudeCodeJobStatus =
  | 'draft'
  | 'ready'
  | 'copied'
  | 'exported'
  | 'queued'
  | 'blocked'
  | 'completed'

/** Safety assessment of a prompt before copy/export. */
export interface ClaudeCodeSafetyChecks {
  /** The target workspace is the allowed SJ OS project folder. */
  workspaceAllowed: boolean
  /** The prompt mentions .env / secrets (review before sharing). */
  containsEnvWarning: boolean
  /** The prompt mentions a destructive command (review before running). */
  containsDangerousCommand: boolean
  /** Human approval recommended before delivery. */
  requiresApproval: boolean
}

export interface ClaudeCodeJob {
  id: string
  title: string
  promptPacketId: string
  promptText: string
  status: ClaudeCodeJobStatus
  workspacePath: string
  promptFilePath?: string
  createdAt: string
  updatedAt: string
  lastCopiedAt?: string
  lastExportedAt?: string
  safetyChecks: ClaudeCodeSafetyChecks
  notes?: string
}
