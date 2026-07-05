import { useEffect, useState } from 'react'
import type {
  StaffDistributionPackage,
  StaffDistributionRecord,
  DistributionStatus,
  StaffRecordStatus
} from '@shared/distributionPackage'

/**
 * Local staff distribution package registry (renderer, localStorage). Tracking
 * only — no upload, no send, no shell, no git. Registered package metadata +
 * per-staff distribution records live here.
 */

const KEY = 'sj.dist.packages'
let items: StaffDistributionPackage[] = load()
const listeners = new Set<() => void>()

function load(): StaffDistributionPackage[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as StaffDistributionPackage[]) : []
  } catch {
    return []
  }
}
function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, 100)))
  } catch {
    /* best effort */
  }
  listeners.forEach((l) => l())
}
function nowIso(): string {
  return new Date().toISOString()
}
function rid(prefix: string): string {
  return `${prefix}-${items.length}-${Math.floor(performance.now())}`
}

export function listDistributionPackages(): StaffDistributionPackage[] {
  return items
}
export function subscribeDistribution(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function upsertDistributionPackage(pkg: StaffDistributionPackage): void {
  items = [pkg, ...items.filter((i) => i.id !== pkg.id)]
  persist()
}
function patchPackage(id: string, fn: (p: StaffDistributionPackage) => StaffDistributionPackage): void {
  items = items.map((p) => (p.id === id ? { ...fn(p), updatedAt: nowIso() } : p))
  persist()
}
export function setDistributionStatus(id: string, status: DistributionStatus): void {
  patchPackage(id, (p) => ({ ...p, status }))
}
export function addStaffRecord(id: string, staffName: string, staffRole: string | undefined, version: string): void {
  if (!staffName.trim()) return
  const rec: StaffDistributionRecord = { id: rid('rec'), staffName: staffName.trim(), staffRole: staffRole?.trim() || undefined, version, status: 'not-sent' }
  patchPackage(id, (p) => ({ ...p, distributionRecords: [...p.distributionRecords, rec] }))
}
export function setStaffRecordStatus(id: string, recId: string, status: StaffRecordStatus): void {
  patchPackage(id, (p) => ({
    ...p,
    distributionRecords: p.distributionRecords.map((r) =>
      r.id === recId
        ? { ...r, status, sentAt: status === 'sent' ? nowIso() : r.sentAt, installedAt: status === 'installed' ? nowIso() : r.installedAt }
        : r
    )
  }))
}

export function useDistributionPackages(): StaffDistributionPackage[] {
  const [state, setState] = useState<StaffDistributionPackage[]>(items)
  useEffect(() => subscribeDistribution(() => setState([...items])), [])
  return state
}
