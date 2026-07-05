import { useEffect, useState } from 'react'
import type { ClaudeAutoBuildJob, ClaudeAutoBuildVerification } from '@shared/claudeAutoBuild'
import { generateManualTestChecklist, generateReleaseNote } from '@shared/claudeAutoBuild'

/**
 * Release Approval Center store (renderer, localStorage-persisted). This is
 * approval + readiness bookkeeping ONLY — it never deploys, runs git, or touches
 * external services. No shell.
 */

export type ReleaseApprovalStatus =
  | 'draft'
  | 'review-ready'
  | 'approved'
  | 'rejected'
  | 'needs-fix'
  | 'release-ready'
  | 'released-manually'

export type ReleaseRiskLevel = 'low' | 'medium' | 'high'

export interface ReleaseReadiness {
  changedFilesReviewed: boolean
  manualTestsDone: boolean
  releaseNoteConfirmed: boolean
  pushConfirmed: boolean
}

export interface ReleaseApprovalItem {
  id: string
  sourceJobId: string
  title: string
  originalUserCommand: string
  releaseNote: string
  commitHash?: string
  pushStatus: 'not-pushed' | 'pushed' | 'failed'
  verification: ClaudeAutoBuildVerification
  manualTestChecklist: string[]
  riskLevel: ReleaseRiskLevel
  status: ReleaseApprovalStatus
  notes?: string
  approvedBy?: string
  approvedAt?: string
  readiness: ReleaseReadiness
  testChecks: Record<string, boolean>
  createdAt: string
  updatedAt: string
}

const KEY = 'sj.release.approvalItems'
let items: ReleaseApprovalItem[] = load()
const listeners = new Set<() => void>()

function load(): ReleaseApprovalItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as ReleaseApprovalItem[]) : []
  } catch {
    return []
  }
}
function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, 100)))
  } catch {
    /* best effort */
  }
  listeners.forEach((l) => l())
}

function riskFrom(v: ClaudeAutoBuildVerification): ReleaseRiskLevel {
  if (v.typecheckStatus === 'failed' || v.buildStatus === 'failed') return 'high'
  if (v.typecheckStatus === 'passed' && v.buildStatus === 'passed') return 'low'
  return 'medium'
}

/** Create (or refresh) a release approval item from a succeeded job. */
export function createReleaseApprovalFromJob(job: ClaudeAutoBuildJob): ReleaseApprovalItem {
  const existing = items.find((i) => i.sourceJobId === job.id)
  const now = new Date().toISOString()
  const base: ReleaseApprovalItem = {
    id: existing?.id ?? `rel-${job.id}`,
    sourceJobId: job.id,
    title: job.title,
    originalUserCommand: job.originalUserCommand,
    releaseNote: generateReleaseNote({
      title: job.title,
      command: job.originalUserCommand,
      verification: job.verification
    }),
    commitHash: job.commitHash,
    pushStatus: job.pushed ? 'pushed' : 'not-pushed',
    verification: job.verification,
    manualTestChecklist: generateManualTestChecklist(job.originalUserCommand),
    riskLevel: riskFrom(job.verification),
    status: existing?.status ?? 'review-ready',
    notes: existing?.notes,
    approvedBy: existing?.approvedBy,
    approvedAt: existing?.approvedAt,
    readiness: existing?.readiness ?? {
      changedFilesReviewed: false,
      manualTestsDone: false,
      releaseNoteConfirmed: false,
      pushConfirmed: job.pushed === true
    },
    testChecks: existing?.testChecks ?? {},
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  items = [base, ...items.filter((i) => i.sourceJobId !== job.id)]
  persist()
  return base
}

export function listReleaseApprovals(): ReleaseApprovalItem[] {
  return items
}
export function subscribeReleaseApprovals(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

function patch(id: string, fn: (i: ReleaseApprovalItem) => ReleaseApprovalItem): void {
  items = items.map((i) => (i.id === id ? { ...fn(i), updatedAt: new Date().toISOString() } : i))
  persist()
}

export function setReleaseStatus(id: string, status: ReleaseApprovalStatus): void {
  patch(id, (i) => ({
    ...i,
    status,
    approvedAt: status === 'approved' ? new Date().toISOString() : i.approvedAt,
    approvedBy: status === 'approved' ? '대표' : i.approvedBy
  }))
}
export function toggleReadiness(id: string, key: keyof ReleaseReadiness): void {
  patch(id, (i) => ({ ...i, readiness: { ...i.readiness, [key]: !i.readiness[key] } }))
}
export function toggleTestCheck(id: string, label: string): void {
  patch(id, (i) => ({ ...i, testChecks: { ...i.testChecks, [label]: !i.testChecks[label] } }))
}

/** Missing critical items that block release-ready (empty ⇒ ready). */
export function missingForReleaseReady(item: ReleaseApprovalItem): string[] {
  const allTestsDone =
    item.manualTestChecklist.length > 0 && item.manualTestChecklist.every((t) => item.testChecks[t])
  const missing: string[] = []
  if (item.verification.typecheckStatus !== 'passed') missing.push('typecheck 통과')
  if (item.verification.buildStatus !== 'passed') missing.push('build 통과')
  if (!item.readiness.changedFilesReviewed) missing.push('변경 파일 검토')
  if (!(item.readiness.manualTestsDone || allTestsDone)) missing.push('수동 테스트 완료')
  if (!item.readiness.releaseNoteConfirmed) missing.push('릴리즈 노트 확인')
  if (item.status !== 'approved' && item.status !== 'release-ready') missing.push('대표 승인 완료')
  if (!(item.readiness.pushConfirmed || item.pushStatus === 'pushed')) missing.push('push 상태 확인')
  return missing
}

/** React hook mirroring the store. */
export function useReleaseApprovals(): ReleaseApprovalItem[] {
  const [state, setState] = useState<ReleaseApprovalItem[]>(items)
  useEffect(() => subscribeReleaseApprovals(() => setState([...items])), [])
  return state
}
