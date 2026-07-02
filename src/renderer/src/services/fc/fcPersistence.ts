import type { FcSnapshot } from './types'

/**
 * Local persistence for FC OS state. Uses the renderer's localStorage so the
 * organization roster and today's attendance survive restarts — no external
 * API, no database setup. All access is guarded so the module is safe to import
 * in environments without localStorage.
 */

const STORAGE_KEY = 'sj-os:fc:v1'

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function isSnapshot(value: unknown): value is FcSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<FcSnapshot>
  return Array.isArray(candidate.members) && Array.isArray(candidate.eventLog)
}

/** Read the persisted snapshot, or null if absent/invalid/unavailable. */
export function loadSnapshot(): FcSnapshot | null {
  if (!hasStorage()) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isSnapshot(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

/** Persist the snapshot. Silently no-ops if storage is unavailable. */
export function saveSnapshot(snapshot: FcSnapshot): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* storage full or unavailable — state stays in-process for this session */
  }
}
