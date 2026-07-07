import { useEffect, useState } from 'react'
import type { AnnouncementRecord } from '@shared/commercial/announcements'

/**
 * Local-mock announcements store (localStorage). Mirrors public.announcements +
 * announcement_reads for local/dev use. Reads are single-local-user. No sensitive
 * data logged.
 */

const A_KEY = 'sj.announcements'
const R_KEY = 'sj.announcement.reads'
let items: AnnouncementRecord[] = load()
let reads: string[] = loadReads()
const listeners = new Set<() => void>()

function load(): AnnouncementRecord[] {
  try {
    const raw = localStorage.getItem(A_KEY)
    if (raw) return JSON.parse(raw) as AnnouncementRecord[]
  } catch {
    /* ignore */
  }
  // No demo announcement — a real admin publishes the first notice.
  return []
}
function loadReads(): string[] {
  try {
    const raw = localStorage.getItem(R_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}
function persist(): void {
  try {
    localStorage.setItem(A_KEY, JSON.stringify(items.slice(0, 500)))
    localStorage.setItem(R_KEY, JSON.stringify(reads.slice(0, 2000)))
  } catch {
    /* best effort */
  }
  listeners.forEach((l) => l())
}
function nowIso(): string {
  return new Date().toISOString()
}
function rid(): string {
  return `ann-${items.length}-${Math.floor(performance.now())}`
}

export function listLocalAnnouncements(): AnnouncementRecord[] {
  return items
}
export function localReadIds(): string[] {
  return reads
}
export function createLocalAnnouncement(a: Omit<AnnouncementRecord, 'id' | 'createdAt' | 'updatedAt'>): void {
  items = [{ ...a, id: rid(), createdAt: nowIso(), updatedAt: nowIso() }, ...items]
  persist()
}
function patch(id: string, fn: (a: AnnouncementRecord) => AnnouncementRecord): void {
  items = items.map((a) => (a.id === id ? { ...fn(a), updatedAt: nowIso() } : a))
  persist()
}
export function updateLocalAnnouncement(id: string, a: Partial<AnnouncementRecord>): void {
  patch(id, (cur) => ({ ...cur, ...a }))
}
export function setLocalAnnouncementStatus(id: string, status: AnnouncementRecord['status']): void {
  patch(id, (a) => ({ ...a, status, publishedAt: status === 'published' ? a.publishedAt ?? nowIso() : a.publishedAt }))
}
export function deleteLocalAnnouncement(id: string): void {
  items = items.filter((a) => a.id !== id)
  persist()
}
export function markLocalRead(id: string): void {
  if (!reads.includes(id)) {
    reads = [...reads, id]
    persist()
  }
}

export function subscribeAnnouncements(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
export function useAnnouncementStore(): { items: AnnouncementRecord[]; reads: string[] } {
  const [state, setState] = useState({ items, reads })
  useEffect(() => {
    const l = (): void => setState({ items: [...items], reads: [...reads] })
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return state
}
