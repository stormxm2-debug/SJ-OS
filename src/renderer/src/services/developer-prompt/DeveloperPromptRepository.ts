import { DeveloperPromptEvents, type DeveloperPromptEventName } from './DeveloperPromptEvents'
import { DeveloperPromptState } from './DeveloperPromptState'
import { developerPromptSeed } from './seed'
import type {
  DeveloperPromptLogEntry,
  DeveloperPromptLogType,
  DeveloperPromptPacket,
  DeveloperPromptSnapshot,
  DeveloperPromptStatus,
  DeveloperPromptSummary,
  NewDeveloperPromptInput
} from './types'

export interface DeveloperPromptOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 80

/** Default verification steps attached to every packet. */
const DEFAULT_CHECKLIST = ['npm run typecheck', 'npm run build', 'git status --short']

function cloneSeed(): DeveloperPromptSnapshot {
  return JSON.parse(JSON.stringify(developerPromptSeed)) as DeveloperPromptSnapshot
}

/** Statuses grouped for summary rollups. */
const PENDING_STATUSES = new Set<DeveloperPromptStatus>(['draft', 'generated'])
const IN_DEV_STATUSES = new Set<DeveloperPromptStatus>(['sent-to-claude', 'in-development'])
const DONE_STATUSES = new Set<DeveloperPromptStatus>(['verified', 'completed'])
const BLOCKED_STATUSES = new Set<DeveloperPromptStatus>(['blocked', 'rejected'])

/**
 * Repository over the Developer Prompt Center queue. Same shape as the other SJ
 * OS repositories: a state holder + event bus; mutations return a result and
 * persist through DeveloperPromptState.
 *
 * This is the safe bridge before fully-autonomous code execution: Jarvis turns a
 * CEO development command into a structured Claude Code prompt packet WITHOUT
 * editing source files, running git, or calling external APIs. The CEO copies the
 * prompt into Claude Code, and the packet's status is tracked here
 * (생성됨 → 복사됨 → Claude 전달됨 → 개발 중 → 완료).
 */
export class DeveloperPromptRepository {
  private seq = 0

  constructor(
    private readonly state = new DeveloperPromptState(),
    private readonly events = new DeveloperPromptEvents()
  ) {
    if (this.state.seededFresh) {
      this.announceFoundation()
    }
  }

  getSnapshot(): DeveloperPromptSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: DeveloperPromptEventName; payload?: unknown; timestamp: string }) => void
  ): () => void {
    return this.events.subscribe(listener)
  }

  private emitUpdated(): void {
    this.events.emit('snapshot:updated')
  }

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`
  }

  private makeLogEntry(type: DeveloperPromptLogType, message: string): DeveloperPromptLogEntry {
    return { id: this.nextId('dpevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(
    snapshot: DeveloperPromptSnapshot,
    type: DeveloperPromptLogType,
    message: string
  ): DeveloperPromptSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  private commit(snapshot: DeveloperPromptSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- reads ---------------------------------------------------------------

  listPackets(): DeveloperPromptPacket[] {
    return this.state.getSnapshot().packets
  }

  getPacket(packetId: string): DeveloperPromptPacket | null {
    return this.state.getSnapshot().packets.find((p) => p.id === packetId) ?? null
  }

  getEventLog(): DeveloperPromptLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Pretty-printed JSON of the full queue, for the export action. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  /** Organization-wide developer-prompt rollup. */
  getSummary(): DeveloperPromptSummary {
    const list = this.listPackets()
    const inGroup = (group: Set<DeveloperPromptStatus>): number =>
      list.filter((p) => group.has(p.status)).length
    return {
      total: list.length,
      pending: inGroup(PENDING_STATUSES),
      waitingForClaude: list.filter((p) => p.status === 'copied').length,
      inDevelopment: inGroup(IN_DEV_STATUSES),
      completed: inGroup(DONE_STATUSES),
      blocked: inGroup(BLOCKED_STATUSES),
      highRisk: list.filter(
        (p) =>
          (p.riskLevel === 'high' || p.riskLevel === 'critical') && !DONE_STATUSES.has(p.status)
      ).length
    }
  }

  /** The next packet still waiting to be pasted into Claude Code (oldest first). */
  getNextForClaude(): DeveloperPromptPacket | null {
    const waiting = this.listPackets().filter(
      (p) => p.status === 'generated' || p.status === 'copied'
    )
    if (waiting.length === 0) return null
    return waiting.reduce((oldest, p) => (p.createdAt < oldest.createdAt ? p : oldest))
  }

  /** Packets that reference a generated Claude Code prompt (DevOS-readable). */
  getPromptReadyPackets(): DeveloperPromptPacket[] {
    return this.listPackets().filter((p) => !BLOCKED_STATUSES.has(p.status))
  }

  // --- selection -----------------------------------------------------------

  selectPacket(packetId: string | null): DeveloperPromptOperationResult<string | null> {
    const snapshot = this.state.getSnapshot()
    if (packetId && !snapshot.packets.some((p) => p.id === packetId)) {
      return { success: false, error: 'packet not found' }
    }
    this.state.setSnapshot({ ...snapshot, selectedPacketId: packetId })
    this.events.emit('selection:changed', packetId)
    this.events.emit('snapshot:updated')
    return { success: true, data: packetId }
  }

  // --- create --------------------------------------------------------------

  /**
   * Register a new prompt packet from a Jarvis-generated developer/build prompt.
   * Idempotent per source: if a packet already exists for the same sourceId, it
   * is returned unchanged so re-running a command does not duplicate the queue.
   */
  registerPacket(input: NewDeveloperPromptInput): DeveloperPromptOperationResult<DeveloperPromptPacket> {
    const promptText = input.promptText.trim()
    if (!promptText) return { success: false, error: 'prompt text is empty' }

    const existing = this.listPackets().find((p) => p.sourceId === input.sourceId)
    if (existing) return { success: true, data: existing }

    const now = new Date().toISOString()
    const packet: DeveloperPromptPacket = {
      id: this.nextId('dpp'),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      title: input.title,
      targetWorkspace: input.targetWorkspace,
      interpretedGoal: input.interpretedGoal,
      promptText,
      status: 'generated',
      priority: input.priority,
      riskLevel: input.riskLevel,
      approvalRequired: input.approvalRequired,
      copiedAt: null,
      sentToClaudeAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      verificationChecklist: input.verificationChecklist ?? [...DEFAULT_CHECKLIST],
      commitMessage: input.commitMessage,
      notes: ''
    }

    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        { ...snapshot, packets: [packet, ...snapshot.packets] },
        'generated',
        `개발 프롬프트 생성: ${packet.title} (${packet.targetWorkspace})`
      )
    )
    this.events.emit('packet:updated', packet)
    return { success: true, data: packet }
  }

  // --- shared mutation -----------------------------------------------------

  private updatePacket(
    packetId: string,
    mutate: (p: DeveloperPromptPacket) => DeveloperPromptPacket,
    type: DeveloperPromptLogType,
    message: (p: DeveloperPromptPacket) => string
  ): DeveloperPromptOperationResult<DeveloperPromptPacket> {
    const snapshot = this.state.getSnapshot()
    const index = snapshot.packets.findIndex((p) => p.id === packetId)
    if (index === -1) return { success: false, error: 'packet not found' }
    const next: DeveloperPromptPacket = {
      ...mutate(snapshot.packets[index]),
      id: packetId,
      updatedAt: new Date().toISOString()
    }
    const packets = [...snapshot.packets]
    packets[index] = next
    this.commit(this.withLog({ ...snapshot, packets }, type, message(next)))
    this.events.emit('packet:updated', next)
    return { success: true, data: next }
  }

  // --- lifecycle -----------------------------------------------------------

  /** Mark the prompt as copied to the clipboard (생성됨 → 복사됨). */
  markCopied(packetId: string): DeveloperPromptOperationResult<DeveloperPromptPacket> {
    return this.updatePacket(
      packetId,
      (p) => ({
        ...p,
        copiedAt: new Date().toISOString(),
        status: p.status === 'generated' || p.status === 'draft' ? 'copied' : p.status
      }),
      'copied',
      (p) => `프롬프트 복사됨: ${p.title}`
    )
  }

  /** Mark the prompt as pasted into Claude Code (복사됨 → Claude 전달됨). */
  markSentToClaude(packetId: string): DeveloperPromptOperationResult<DeveloperPromptPacket> {
    return this.updatePacket(
      packetId,
      (p) => ({ ...p, sentToClaudeAt: new Date().toISOString(), status: 'sent-to-claude' }),
      'sent-to-claude',
      (p) => `Claude Code 전달: ${p.title}`
    )
  }

  /** Mark the packet as actively in development. */
  markInDevelopment(packetId: string): DeveloperPromptOperationResult<DeveloperPromptPacket> {
    return this.updatePacket(
      packetId,
      (p) => ({ ...p, status: 'in-development' }),
      'status-changed',
      (p) => `개발 중: ${p.title}`
    )
  }

  /** Mark the packet as completed (개발 완료). */
  markCompleted(packetId: string): DeveloperPromptOperationResult<DeveloperPromptPacket> {
    return this.updatePacket(
      packetId,
      (p) => ({ ...p, status: 'completed', completedAt: new Date().toISOString() }),
      'completed',
      (p) => `완료: ${p.title}`
    )
  }

  /** Mark the packet as blocked. */
  markBlocked(packetId: string): DeveloperPromptOperationResult<DeveloperPromptPacket> {
    return this.updatePacket(
      packetId,
      (p) => ({ ...p, status: 'blocked' }),
      'blocked',
      (p) => `차단됨: ${p.title}`
    )
  }

  /** Reject the packet. */
  rejectPacket(packetId: string): DeveloperPromptOperationResult<DeveloperPromptPacket> {
    return this.updatePacket(
      packetId,
      (p) => ({ ...p, status: 'rejected' }),
      'rejected',
      (p) => `반려됨: ${p.title}`
    )
  }

  setStatus(
    packetId: string,
    status: DeveloperPromptStatus
  ): DeveloperPromptOperationResult<DeveloperPromptPacket> {
    return this.updatePacket(
      packetId,
      (p) => ({ ...p, status }),
      'status-changed',
      (p) => `상태 변경 → ${status}: ${p.title}`
    )
  }

  /** Attach or replace the CEO's free-form notes on a packet. */
  setNotes(packetId: string, notes: string): DeveloperPromptOperationResult<DeveloperPromptPacket> {
    return this.updatePacket(
      packetId,
      (p) => ({ ...p, notes }),
      'status-changed',
      (p) => `메모 업데이트: ${p.title}`
    )
  }

  // --- company integration -------------------------------------------------

  private announceFoundation(): void {
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        snapshot,
        'foundation',
        'Developer Prompt Center created — Jarvis가 CEO 개발 지시를 구조화된 Claude Code 프롬프트 패킷으로 관리합니다.'
      )
    )
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the Developer Prompt Center queue back to empty. */
  resetDemoState(): DeveloperPromptOperationResult<DeveloperPromptSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'Developer Prompt Center queue reset')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const developerPromptRepository = new DeveloperPromptRepository()
