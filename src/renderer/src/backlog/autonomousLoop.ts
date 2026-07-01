import { chiefOfStaff } from '@renderer/chief-of-staff/chiefOfStaff'
import { backlogStore } from './backlogStore'
import type { BacklogItem } from '@renderer/data/productBacklog'

/**
 * The autonomous execution loop.
 *
 * It works the Product Backlog on its own: pick the highest-priority eligible
 * item, hand it to the Chief of Staff (which runs the existing pipeline —
 * executive meeting → plan → reuse assets → generate tasks → execute in parallel
 * across departments → QA/Git/Release → report), then update the backlog and
 * pick the next item. Repeats until nothing is eligible.
 *
 * It ORCHESTRATES only — it reuses the Chief of Staff and Kernel unchanged. The
 * CEO drives it with start / pause / resume / cancel; task assignment is never
 * manual.
 */

export interface ProcessedItem {
  itemId: string
  title: string
  outcome: 'completed' | 'blocked'
}

export interface AutonomousState {
  running: boolean
  paused: boolean
  currentItemId: string | null
  processed: ProcessedItem[]
}

function deriveRequest(item: BacklogItem): string {
  // The company builds the item; the Chief of Staff/engine reuse existing assets.
  return `Build ${item.title}`
}

class AutonomousLoop {
  private state: AutonomousState = {
    running: false,
    paused: false,
    currentItemId: null,
    processed: []
  }
  private readonly listeners = new Set<() => void>()
  private cosUnsub: (() => void) | null = null

  getState = (): AutonomousState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  start = (): void => {
    if (this.state.running) return
    this.patch({ running: true, paused: false })
    if (!this.cosUnsub) this.cosUnsub = chiefOfStaff.subscribe(() => this.onChiefOfStaffChange())
    this.dispatchNext()
  }

  pause = (): void => {
    if (this.state.running) this.patch({ paused: true })
  }

  resume = (): void => {
    if (this.state.running && this.state.paused) {
      this.patch({ paused: false })
      this.dispatchNext()
    }
  }

  cancel = (): void => {
    this.cosUnsub?.()
    this.cosUnsub = null
    chiefOfStaff.reset()
    this.patch({ running: false, paused: false, currentItemId: null })
  }

  private onChiefOfStaffChange(): void {
    if (!this.state.running) return
    const cos = chiefOfStaff.getState()
    // The current item finished — record it and free the slot (even if paused).
    if (this.state.currentItemId && (cos.phase === 'done' || cos.phase === 'failed')) {
      const item = backlogStore.get(this.state.currentItemId)
      if (item) {
        const outcome = cos.phase === 'done' ? 'completed' : 'blocked'
        backlogStore.setStatus(item.id, outcome)
        this.patch({
          currentItemId: null,
          processed: [...this.state.processed, { itemId: item.id, title: item.title, outcome }]
        })
      } else {
        this.patch({ currentItemId: null })
      }
    }
    if (!this.state.paused) this.dispatchNext()
  }

  private dispatchNext(): void {
    if (!this.state.running || this.state.paused || this.state.currentItemId) return
    const phase = chiefOfStaff.getState().phase
    if (phase !== 'idle' && phase !== 'done' && phase !== 'failed') return

    const next = backlogStore.nextEligible()
    if (!next) {
      // Backlog drained of eligible work — the loop goes idle.
      this.patch({ running: false })
      return
    }
    backlogStore.setStatus(next.id, 'in_progress')
    this.patch({ currentItemId: next.id })
    chiefOfStaff.receiveRequest(deriveRequest(next))
  }

  private patch(patch: Partial<AutonomousState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
}

export const autonomousLoop = new AutonomousLoop()
