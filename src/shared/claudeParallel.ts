/**
 * Shared contract for the worktree-based parallel Claude builder (foundation).
 *
 * Same-folder parallel coding is dangerous, so a parallel job runs in its OWN git
 * worktree + branch, with its own Claude Code run, logs, and verification. The
 * Electron MAIN process performs all git/Claude execution; the renderer only sends
 * a source job id. NO auto-merge, NO auto-delete, NO force push.
 */

import type { ClaudeAutoBuildVerification, ConflictGroup } from './claudeAutoBuild'

export type ParallelStatus =
  | 'not-created'
  | 'preparing'
  | 'worktree-created'
  | 'ready'
  | 'running'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'needs-merge-review'
  | 'blocked'

export interface ParallelBuildJob {
  id: string
  /** The auto-build job this parallel job was derived from. */
  sourceJobId: string
  title: string
  originalUserCommand: string
  generatedPrompt: string
  baseWorkspacePath: string
  worktreePath?: string
  branchName?: string
  conflictGroup: ConflictGroup
  parallelStatus: ParallelStatus
  canRunInParallel: boolean
  logLines: string[]
  verificationResult?: ClaudeAutoBuildVerification
  blockedReason?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  updatedAt: string
}

/** Emitted to the renderer whenever a parallel job changes. */
export interface ParallelJobUpdate {
  job: ParallelBuildJob
}

/** Max parallel worktree jobs allowed to run at once in this sprint. */
export const MAX_PARALLEL_JOBS = 2
