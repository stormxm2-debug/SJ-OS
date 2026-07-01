import {
  BACKLOG,
  type BacklogItem,
  type BacklogPriority,
  type BacklogStatus
} from '@renderer/data/productBacklog'

/**
 * A mutable, observable view over the Product Backlog. The autonomous loop and
 * the CEO reprioritize through it; the UI observes it. Pure product-management
 * state — no platform machinery. Seeded from the static backlog.
 */

const RANK: Record<BacklogPriority, number> = { P0: 0, P1: 1, P2: 2 }

function cloneItem(item: BacklogItem): BacklogItem {
  return {
    ...item,
    dependencies: [...item.dependencies],
    acceptanceCriteria: [...item.acceptanceCriteria],
    definitionOfDone: [...item.definitionOfDone]
  }
}

class BacklogStore {
  private readonly items: BacklogItem[] = BACKLOG.map(cloneItem)
  private readonly order = new Map<string, number>()
  private snapshot: BacklogItem[]
  private readonly listeners = new Set<() => void>()

  constructor() {
    this.items.forEach((item, i) => this.order.set(item.id, i))
    this.snapshot = this.items.map(cloneItem)
  }

  getSnapshot = (): BacklogItem[] => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get(id: string): BacklogItem | undefined {
    return this.items.find((i) => i.id === id)
  }

  setStatus(id: string, status: BacklogStatus): void {
    const item = this.items.find((i) => i.id === id)
    if (!item || item.status === status) return
    item.status = status
    this.emit()
  }

  reprioritize(id: string, priority: BacklogPriority): void {
    const item = this.items.find((i) => i.id === id)
    if (!item || item.priority === priority) return
    item.priority = priority
    this.emit()
  }

  /** The next item to work: highest priority, planned, all backlog deps completed. */
  nextEligible(): BacklogItem | undefined {
    const completed = new Set(
      this.items.filter((i) => i.status === 'completed').map((i) => i.id)
    )
    const eligible = this.items.filter(
      (i) =>
        i.status === 'planned' &&
        i.dependencies.every((d) => !d.startsWith('MUP-') || completed.has(d))
    )
    eligible.sort(
      (a, b) =>
        RANK[a.priority] - RANK[b.priority] ||
        (this.order.get(a.id) ?? 0) - (this.order.get(b.id) ?? 0)
    )
    return eligible[0]
  }

  private emit(): void {
    this.snapshot = this.items.map(cloneItem)
    for (const listener of this.listeners) listener()
  }
}

export const backlogStore = new BacklogStore()
