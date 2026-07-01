import type { EventBus } from './events'
import {
  concludeMeeting,
  type ConveneInput,
  type Meeting,
  type MeetingParticipant,
  type MeetingPhase
} from './meeting'
import type { KernelState } from './state'
import type { WorkerRegistry } from './workerRegistry'

interface MeetingEngineHooks {
  id: (prefix: string) => string
  onChange: () => void
  stepMs?: number
}

/**
 * The AI Meeting Engine — a Kernel subsystem.
 *
 * It transforms a CEO request into a development strategy BEFORE any coding.
 * Participants contribute real opinions (derived from the request), the meeting
 * moves through planning → discussion → voting → approved, and it concludes with
 * a `MeetingDecision` that DIRECTLY drives the task breakdown, priority and
 * worker engagement. Everything it does lands in Kernel State and on the Event
 * Bus — it is the single source of truth for the meeting, and it communicates
 * with the rest of the company only through the Kernel it lives in.
 *
 * Contributions are paced over time so the CEO watches the meeting happen; the
 * content is real, not an animation.
 */
export class MeetingEngine {
  private controller: AbortController | null = null
  private readonly awaiters = new Map<string, ((m: Meeting) => void)[]>()

  constructor(
    private readonly state: KernelState,
    private readonly eventBus: EventBus,
    private readonly registry: WorkerRegistry,
    private readonly participants: MeetingParticipant[],
    private readonly clock: () => number,
    private readonly hooks: MeetingEngineHooks
  ) {}

  convene(input: ConveneInput): string {
    const id = this.hooks.id('meeting')
    const meeting: Meeting = {
      id,
      request: input.request,
      phase: 'planning',
      participants: this.participants.map((p) => p.role),
      opinions: [],
      decision: null
    }
    this.state.addMeeting(meeting)
    this.eventBus.emit({
      type: 'MeetingCreated',
      meetingId: id,
      request: input.request,
      ...this.stamp()
    })
    // The whole company is now in the meeting.
    for (const w of this.registry.all()) this.registry.setActivity(w.id, 'meeting')
    this.hooks.onChange()
    void this.run(id, input)
    return id
  }

  awaitMeeting(id: string): Promise<Meeting> {
    const m = this.state.getMeeting(id)
    if (m && (m.phase === 'approved' || m.phase === 'failed')) return Promise.resolve(m)
    return new Promise((resolve) => {
      const list = this.awaiters.get(id) ?? []
      list.push(resolve)
      this.awaiters.set(id, list)
    })
  }

  cancel(): void {
    this.controller?.abort()
    this.controller = null
    this.awaiters.clear()
  }

  private async run(id: string, input: ConveneInput): Promise<void> {
    const controller = new AbortController()
    this.controller = controller
    const step = this.hooks.stepMs ?? 450

    // Discussion — every participant submits a real opinion, one at a time.
    this.setPhase(id, 'discussion')
    if (await this.paused(step, controller.signal)) return
    for (const participant of this.participants) {
      if (controller.signal.aborted) return
      const contribution = participant.contribute(input)
      const current = this.state.getMeeting(id)
      if (!current) return
      this.state.updateMeeting(id, { opinions: [...current.opinions, contribution] })
      this.eventBus.emit({
        type: 'MeetingOpinion',
        meetingId: id,
        role: contribution.role,
        summary: contribution.decision,
        ...this.stamp()
      })
      this.hooks.onChange()
      if (await this.paused(step, controller.signal)) return
    }

    // Voting — tally and settle.
    this.setPhase(id, 'voting')
    if (await this.paused(step, controller.signal)) return

    // Conclusion — the decision that drives implementation.
    const opinions = this.state.getMeeting(id)?.opinions ?? []
    const decision = concludeMeeting(input, opinions)
    this.state.updateMeeting(id, { decision })
    this.setPhase(id, 'approved')
    for (const w of this.registry.all()) this.registry.setActivity(w.id, 'idle')
    this.eventBus.emit({
      type: 'MeetingConcluded',
      meetingId: id,
      approved: true,
      ...this.stamp()
    })
    this.hooks.onChange()
    this.resolve(id)
  }

  private setPhase(id: string, phase: MeetingPhase): void {
    this.state.updateMeeting(id, { phase })
    this.eventBus.emit({
      type: 'MeetingPhaseChanged',
      meetingId: id,
      phase,
      ...this.stamp()
    })
    this.hooks.onChange()
  }

  private resolve(id: string): void {
    const meeting = this.state.getMeeting(id)
    const waiters = this.awaiters.get(id)
    if (!meeting || !waiters) return
    this.awaiters.delete(id)
    for (const resolve of waiters) resolve(meeting)
  }

  /** Resolves to true if aborted during the wait. */
  private paused(ms: number, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve(true)
        return
      }
      const timer = setTimeout(() => resolve(signal.aborted), ms)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve(true)
        },
        { once: true }
      )
    })
  }

  private stamp(): { id: string; at: number } {
    return { id: this.hooks.id('evt'), at: this.clock() }
  }
}
