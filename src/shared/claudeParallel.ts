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

/** The user's review decision on a completed worktree job. */
export type ReviewDecision = 'not-reviewed' | 'approved-for-merge' | 'needs-fix' | 'rejected'

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
  // --- review (does NOT merge) ---
  reviewDecision?: ReviewDecision
  reviewNotes?: string
  reviewedAt?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  updatedAt: string
}

export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown'

export interface WorktreeChangedFile {
  path: string
  status: ChangedFileStatus
  additions?: number
  deletions?: number
}

export type WorktreeReviewStatus = 'pending' | 'loading' | 'ready' | 'failed'

/** Read-only inspection result of a worktree job's changes (no merge). */
export interface WorktreeReview {
  jobId: string
  title: string
  worktreePath?: string
  branchName?: string
  status: WorktreeReviewStatus
  changedFiles: WorktreeChangedFile[]
  diffStat: string
  diffPreview: string
  diffTruncated: boolean
  gitStatusShort: string
  verificationSummary?: ClaudeAutoBuildVerification
  reviewDecision: ReviewDecision
  reviewedAt?: string
  notes?: string
  error?: string
}

/** Diff preview safety limits (avoid freezing the UI on huge diffs). */
export const MAX_DIFF_PREVIEW_LINES = 300
export const MAX_DIFF_PREVIEW_CHARS = 30000

export type MergeStatus =
  | 'not-ready'
  | 'ready'
  | 'merging'
  | 'merged'
  | 'conflict'
  | 'failed'
  | 'blocked'
  | 'verifying'
  | 'succeeded'
  | 'needs-review'

/** Result of an approved worktree → main merge attempt (main-only; no push). */
export interface WorktreeMergeResult {
  jobId: string
  status: MergeStatus
  branchName?: string
  worktreePath?: string
  mainWorkspacePath: string
  /** `git status --short` of the main workspace BEFORE the merge. */
  preMergeStatus: string
  mergeLogLines: string[]
  conflictFiles: string[]
  verification?: ClaudeAutoBuildVerification
  startedAt?: string
  finishedAt?: string
  errorMessage?: string
}

/** Emitted to the renderer whenever a parallel job changes. */
export interface ParallelJobUpdate {
  job: ParallelBuildJob
}

/** Max parallel worktree jobs allowed to run at once in this sprint. */
export const MAX_PARALLEL_JOBS = 2
