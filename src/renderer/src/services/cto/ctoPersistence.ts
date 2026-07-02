import type { CtoSnapshot } from './types'

/**
 * Local persistence for the CTO Room. Uses the renderer's localStorage so SJ OS
 * remembers CTO state across restarts — no chat history, no external API, no
 * database setup. All access is guarded so the module is safe to import in
 * environments without localStorage. Mirrors pmPersistence / devOsPersistence.
 */

const STORAGE_KEY = 'sj-os:cto:v1'

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function isSnapshot(value: unknown): value is CtoSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CtoSnapshot>
  return (
    typeof candidate.currentSprint === 'string' &&
    typeof candidate.architectureHealth === 'object' &&
    candidate.architectureHealth !== null &&
    Array.isArray(candidate.technicalDebtItems) &&
    Array.isArray(candidate.riskItems) &&
    Array.isArray(candidate.blockedDecisions) &&
    Array.isArray(candidate.nextPriorities)
  )
}

/** Read the persisted snapshot, or null if absent/invalid/unavailable. */
export function loadSnapshot(): CtoSnapshot | null {
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
export function saveSnapshot(snapshot: CtoSnapshot): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* storage full or unavailable — state stays in-process for this session */
  }
}
