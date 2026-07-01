import type { DevOsSnapshot } from './types'

/**
 * Local persistence for Development OS memory. Uses the renderer's localStorage
 * so SJ OS remembers development state across restarts — no chat history, no
 * external API, no database setup. All access is guarded so the module is safe
 * to import in environments without localStorage.
 */

const STORAGE_KEY = 'sj-os:devos:v1'

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function isSnapshot(value: unknown): value is DevOsSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<DevOsSnapshot>
  return typeof candidate.session === 'object' && Array.isArray(candidate.workers)
}

/** Read the persisted snapshot, or null if absent/invalid/unavailable. */
export function loadSnapshot(): DevOsSnapshot | null {
  if (!hasStorage()) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isSnapshot(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Persist the snapshot. Silently no-ops if storage is unavailable. */
export function saveSnapshot(snapshot: DevOsSnapshot): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* storage full or unavailable — memory stays in-process for this session */
  }
}
