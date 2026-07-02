import type { AutopilotState } from './types'

/**
 * Local persistence for Autopilot state. Uses the renderer's localStorage so
 * the operating loop remembers where it stands across restarts — no external
 * API, no database setup. All access is guarded so the module is safe to import
 * in environments without localStorage.
 */

const STORAGE_KEY = 'sj-os:autopilot:v1'

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function isState(value: unknown): value is AutopilotState {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AutopilotState>
  return (
    typeof candidate.status === 'string' &&
    typeof candidate.currentStep === 'number' &&
    Array.isArray(candidate.timeline) &&
    Array.isArray(candidate.activity)
  )
}

/** Read the persisted state, or null if absent/invalid/unavailable. */
export function loadState(): AutopilotState | null {
  if (!hasStorage()) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isState(parsed)) return null
    // Tolerate older snapshots that predate a field.
    return {
      ...parsed,
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : []
    }
  } catch {
    return null
  }
}

/** Persist the state. Silently no-ops if storage is unavailable. */
export function saveState(state: AutopilotState): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* storage full or unavailable — state stays in-process for this session */
  }
}
