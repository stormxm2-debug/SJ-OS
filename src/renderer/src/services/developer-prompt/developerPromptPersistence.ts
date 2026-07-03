import type { DeveloperPromptSnapshot } from './types'

/**
 * Local persistence for the Developer Prompt Center queue. Uses the renderer's
 * localStorage so Jarvis-registered prompt packets survive restarts — no external
 * API, no database. All access is guarded so the module is safe to import in
 * environments without localStorage. Mirrors the other SJ OS *Persistence files.
 */

const STORAGE_KEY = 'sj-os:developer-prompt:v1'

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function isSnapshot(value: unknown): value is DeveloperPromptSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<DeveloperPromptSnapshot>
  return Array.isArray(candidate.packets) && Array.isArray(candidate.eventLog)
}

/** Read the persisted snapshot, or null if absent/invalid/unavailable. */
export function loadSnapshot(): DeveloperPromptSnapshot | null {
  if (!hasStorage()) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isSnapshot(parsed)) return null
    return {
      ...parsed,
      selectedPacketId: parsed.selectedPacketId ?? null
    }
  } catch {
    return null
  }
}

/** Persist the snapshot. Silently no-ops if storage is unavailable. */
export function saveSnapshot(snapshot: DeveloperPromptSnapshot): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* storage full or unavailable — state stays in-process for this session */
  }
}
