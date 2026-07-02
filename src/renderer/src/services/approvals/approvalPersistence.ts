import type { ApprovalSnapshot } from './types'

/**
 * Local persistence for the Approval Center. Uses the renderer's localStorage
 * so SJ OS remembers approvals across restarts — no chat history, no external
 * API, no database setup. All access is guarded so the module is safe to import
 * in environments without localStorage. Mirrors ctoPersistence / pmPersistence.
 */

const STORAGE_KEY = 'sj-os:approvals:v1'

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function isSnapshot(value: unknown): value is ApprovalSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ApprovalSnapshot>
  return Array.isArray(candidate.approvals)
}

/** Read the persisted snapshot, or null if absent/invalid/unavailable. */
export function loadSnapshot(): ApprovalSnapshot | null {
  if (!hasStorage()) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isSnapshot(parsed)) return null
    // Tolerate snapshots persisted before the event log existed.
    return { ...parsed, eventLog: Array.isArray(parsed.eventLog) ? parsed.eventLog : [] }
  } catch {
    return null
  }
}

/** Persist the snapshot. Silently no-ops if storage is unavailable. */
export function saveSnapshot(snapshot: ApprovalSnapshot): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* storage full or unavailable — approvals stay in-process for this session */
  }
}
