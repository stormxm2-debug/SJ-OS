import type { UniversalBuilderSnapshot } from './types'

/**
 * Local persistence for the Universal Builder queue. Uses the renderer's
 * localStorage so Jarvis-raised build projects survive restarts — no external
 * API, no database. All access is guarded so the module is safe to import in
 * environments without localStorage. Mirrors the other SJ OS *Persistence files.
 */

const STORAGE_KEY = 'sj-os:universal-builder:v1'

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function isSnapshot(value: unknown): value is UniversalBuilderSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<UniversalBuilderSnapshot>
  return Array.isArray(candidate.projects) && Array.isArray(candidate.eventLog)
}

/** Read the persisted snapshot, or null if absent/invalid/unavailable. */
export function loadSnapshot(): UniversalBuilderSnapshot | null {
  if (!hasStorage()) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isSnapshot(parsed)) return null
    return {
      ...parsed,
      selectedProjectId: parsed.selectedProjectId ?? null
    }
  } catch {
    return null
  }
}

/** Persist the snapshot. Silently no-ops if storage is unavailable. */
export function saveSnapshot(snapshot: UniversalBuilderSnapshot): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* storage full or unavailable — state stays in-process for this session */
  }
}
