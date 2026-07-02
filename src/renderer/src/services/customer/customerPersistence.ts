import type { CustomerSnapshot } from './types'

/**
 * Local persistence for the Customer Workspace. Uses the renderer's localStorage
 * so the pipeline and open customer survive restarts — no external API, no
 * database setup. All access is guarded so the module is safe to import in
 * environments without localStorage.
 */

const STORAGE_KEY = 'sj-os:customer:v1'

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function isSnapshot(value: unknown): value is CustomerSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CustomerSnapshot>
  return Array.isArray(candidate.customers) && Array.isArray(candidate.eventLog)
}

/** Read the persisted snapshot, or null if absent/invalid/unavailable. */
export function loadSnapshot(): CustomerSnapshot | null {
  if (!hasStorage()) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isSnapshot(parsed)) return null
    return {
      ...parsed,
      selectedCustomerId: parsed.selectedCustomerId ?? null
    }
  } catch {
    return null
  }
}

/** Persist the snapshot. Silently no-ops if storage is unavailable. */
export function saveSnapshot(snapshot: CustomerSnapshot): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* storage full or unavailable — state stays in-process for this session */
  }
}
