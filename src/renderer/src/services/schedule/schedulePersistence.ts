import type { ScheduleSnapshot } from './types'

/**
 * Local persistence for the Schedule Workspace. Uses the renderer's
 * localStorage so the shared calendar survives restarts — no external API, no
 * database setup. All access is guarded so the module is safe to import in
 * environments without localStorage.
 */

const STORAGE_KEY = 'sj-os:schedule:v1'

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function isSnapshot(value: unknown): value is ScheduleSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ScheduleSnapshot>
  return Array.isArray(candidate.items) && Array.isArray(candidate.eventLog)
}

/** Read the persisted snapshot, or null if absent/invalid/unavailable. */
export function loadSnapshot(): ScheduleSnapshot | null {
  if (!hasStorage()) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isSnapshot(parsed)) return null
    return {
      ...parsed,
      selectedScheduleId: parsed.selectedScheduleId ?? null
    }
  } catch {
    return null
  }
}

/** Persist the snapshot. Silently no-ops if storage is unavailable. */
export function saveSnapshot(snapshot: ScheduleSnapshot): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* storage full or unavailable — state stays in-process for this session */
  }
}
