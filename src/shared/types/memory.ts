export type MemoryKind = 'fact' | 'task' | 'learning' | 'preference'

/** A single thing an AI worker "remembers" about its work or the company. */
export interface MemoryEntry {
  id: string
  workerId: string
  kind: MemoryKind
  content: string
  createdAt: string
}
