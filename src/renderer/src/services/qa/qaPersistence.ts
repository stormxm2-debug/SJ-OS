import type { QaSnapshot } from './types'

/**
 * Local persistence for the QA Center. Uses the renderer's localStorage so SJ
 * OS remembers QA runs across restarts — no chat history, no external API, no
 * database setup. All access is guarded so the module is safe to import in
 * environments without localStorage. Mirrors approvalPersistence / ctoPersistence.
 */

const STORAGE_KEY = 'sj-os:qa:v1'

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function isSnapshot(value: unknown): value is QaSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<QaSnapshot>
  return Array.isArray(candidate.runs)
}

/** Read the persisted snapshot, or null if absent/invalid/unavailable. */
export function loadSnapshot(): QaSnapshot | null {
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
export function saveSnapshot(snapshot: QaSnapshot): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* storage full or unavailable — QA state stays in-process for this session */
  }
}
