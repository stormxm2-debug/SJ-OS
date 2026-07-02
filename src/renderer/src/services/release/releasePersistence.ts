import type { ReleaseSnapshot } from './types'

/**
 * Local persistence for the Release Center. Uses the renderer's localStorage so
 * SJ OS remembers releases across restarts — no chat history, no external API,
 * no database setup. All access is guarded so the module is safe to import in
 * environments without localStorage. Mirrors qaPersistence / approvalPersistence.
 */

const STORAGE_KEY = 'sj-os:release:v1'

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function isSnapshot(value: unknown): value is ReleaseSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ReleaseSnapshot>
  return Array.isArray(candidate.releases)
}

/** Read the persisted snapshot, or null if absent/invalid/unavailable. */
export function loadSnapshot(): ReleaseSnapshot | null {
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
export function saveSnapshot(snapshot: ReleaseSnapshot): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* storage full or unavailable — releases stay in-process for this session */
  }
}
