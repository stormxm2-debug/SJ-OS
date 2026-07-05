/**
 * Shared contract for the release snapshot / Git tag center.
 *
 * Creates an annotated Git tag (`vX.Y.Z`) for a staff release version, after
 * explicit approval, from Electron MAIN only. Tag creation and tag push are two
 * separate explicit steps. It never runs `npm version`, builds installers,
 * publishes, or force-pushes. The renderer never runs git.
 */

import type { ClaudeAutoBuildVerification } from './claudeAutoBuild'

export type SnapshotStatus =
  | 'draft'
  | 'approval-required'
  | 'approved'
  | 'tag-ready'
  | 'tag-creating'
  | 'tagged'
  | 'tag-push-ready'
  | 'tag-pushing'
  | 'tag-pushed'
  | 'blocked'
  | 'failed'
  | 'cancelled'

/** Display metadata the renderer may attach for the report/copy (never used in commands). */
export interface SnapshotMeta {
  title?: string
  releaseNote?: string
  verification?: ClaudeAutoBuildVerification
  manualTestChecklist?: string[]
  linkedReleaseApprovalItemId?: string
  linkedStaffVersionId?: string
}

export interface ReleaseSnapshot {
  id: string
  version: string
  tagName: string
  title: string
  releaseNote: string
  commitHash: string
  packageJsonVersion: string
  linkedStaffVersionId?: string
  linkedReleaseApprovalItemId?: string
  verification?: ClaudeAutoBuildVerification
  manualTestChecklist: string[]
  status: SnapshotStatus
  tagExists: boolean
  pushed: boolean
  validSemver: boolean
  riskNotes: string[]
  logLines: string[]
  createdAt: string
  approvedAt?: string
  taggedAt?: string
  pushedAt?: string
  errorMessage?: string
}

/** X.Y.Z (semantic version, digits only). */
export function isValidSemver(v: string): boolean {
  return /^\d+\.\d+\.\d+$/.test((v ?? '').trim())
}
/** vX.Y.Z tag name. */
export function isValidTagName(t: string): boolean {
  return /^v\d+\.\d+\.\d+$/.test((t ?? '').trim())
}
export function tagNameForVersion(version: string): string {
  return `v${(version ?? '').trim()}`
}
