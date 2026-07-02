import type { TeamLeaderSnapshot } from './types'

/**
 * Local persistence for the Team Leader Workspace. Uses the renderer's
 * localStorage so coaching notes, blockers, next actions and the selected team
 * survive restarts — no external API, no database setup. All access is guarded
 * so the module is safe to import in environments without localStorage.
 */

const STORAGE_KEY = 'sj-os:team-leader:v1'

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function isSnapshot(value: unknown): value is TeamLeaderSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<TeamLeaderSnapshot>
  return (
    Array.isArray(candidate.coachingNotes) &&
    Array.isArray(candidate.blockers) &&
    Array.isArray(candidate.nextActions) &&
    Array.isArray(candidate.eventLog)
  )
}

/** Read the persisted snapshot, or null if absent/invalid/unavailable. */
export function loadSnapshot(): TeamLeaderSnapshot | null {
  if (!hasStorage()) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isSnapshot(parsed)) return null
    return {
      ...parsed,
      selectedTeam: parsed.selectedTeam ?? null
    }
  } catch {
    return null
  }
}

/** Persist the snapshot. Silently no-ops if storage is unavailable. */
export function saveSnapshot(snapshot: TeamLeaderSnapshot): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* storage full or unavailable — state stays in-process for this session */
  }
}
