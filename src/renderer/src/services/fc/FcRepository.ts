import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { FcEvents, type FcEventName } from './FcEvents'
import { FcState } from './FcState'
import { fcSeed } from './seed'
import type {
  FcAttendanceStatus,
  FcLogEntry,
  FcLogType,
  FcMember,
  FcPriorityAction,
  FcSnapshot,
  FcSummary,
  TeamSummary
} from './types'

export interface FcOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 50

/** Canonical Jarvis query keys the FC OS answers locally (no AI call yet). */
export type FcJarvisQuery =
  | '오늘 FC 출근 현황'
  | '이번 달 실적'
  | '팀별 실적'
  | '미활동 FC'
  | '오늘 일정'

function cloneSeed(): FcSnapshot {
  return JSON.parse(JSON.stringify(fcSeed)) as FcSnapshot
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.max(0, Math.round(value))
}

/** Achievement rate from premium vs target, 0+ (0 when no target). */
function achievement(premium: number, target: number): number {
  if (target <= 0) return 0
  return clampPercent((premium / target) * 100)
}

/** Format a KRW amount for compact display, e.g. 12,600,000 → "1,260만원". */
export function formatKrw(amount: number): string {
  if (amount === 0) return '0원'
  const man = Math.round(amount / 10_000)
  return `${man.toLocaleString('ko-KR')}만원`
}

/**
 * Repository over the FC Operating System. Same shape as DevOsRepository /
 * CtoRepository / PmRepository: a state holder + event bus, mutations return a
 * result and persist through FcState. All FC business logic lives here, not in
 * React components. Meaningful changes also append to the persisted event log.
 *
 * Actions are safe and local only — no external API, no database. On first
 * initialisation it records a single, non-intrusive note into the Development OS
 * event log so the Live Company activity feed reflects that the FC OS exists;
 * it never rewrites the active DevOS session or next action.
 */
export class FcRepository {
  private seq = 0

  constructor(
    private readonly state = new FcState(),
    private readonly events = new FcEvents()
  ) {
    if (this.state.seededFresh) {
      this.announceFoundation()
    }
  }

  getSnapshot(): FcSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: FcEventName; payload?: unknown; timestamp: string }) => void
  ): () => void {
    return this.events.subscribe(listener)
  }

  private emitUpdated(): void {
    this.events.emit('roster:updated')
    this.events.emit('snapshot:updated')
  }

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`
  }

  private makeLogEntry(type: FcLogType, message: string): FcLogEntry {
    return { id: this.nextId('fcevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(snapshot: FcSnapshot, type: FcLogType, message: string): FcSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  private commit(snapshot: FcSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- reads ---------------------------------------------------------------

  listMembers(): FcMember[] {
    return this.state.getSnapshot().members
  }

  getMember(fcId: string): FcMember | null {
    return this.state.getSnapshot().members.find((m) => m.fcId === fcId) ?? null
  }

  getEventLog(): FcLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Pretty-printed JSON of the full FC OS, for the export action. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  // --- rollups -------------------------------------------------------------

  /** Organization-wide summary for the FC OS home and CEO Dashboard. */
  getSummary(): FcSummary {
    const members = this.listMembers()
    const has = (s: FcAttendanceStatus): number =>
      members.filter((m) => m.attendanceStatus === s).length
    const monthlyPremiumTotal = members.reduce((sum, m) => sum + m.monthlyPremium, 0)
    const targetPremiumTotal = members.reduce((sum, m) => sum + m.targetPremium, 0)
    return {
      totalFc: members.length,
      activeFc: members.filter((m) => m.status === 'active').length,
      checkedIn: has('checked-in'),
      late: has('late'),
      absent: has('absent'),
      outside: has('outside'),
      onboarding: members.filter((m) => m.status === 'onboarding').length,
      todayScheduleTotal: members.reduce((sum, m) => sum + m.todayScheduleCount, 0),
      todayActivityTotal: members.reduce((sum, m) => sum + m.todayActivityCount, 0),
      monthlyPremiumTotal,
      targetPremiumTotal,
      monthlyContractTotal: members.reduce((sum, m) => sum + m.monthlyContractCount, 0),
      achievementRate: achievement(monthlyPremiumTotal, targetPremiumTotal),
      inactiveFcCount: members.filter((m) => m.role === 'FC' && m.todayActivityCount === 0).length
    }
  }

  /** Top performers by monthly premium (FCs and leaders who carry a target). */
  getTopPerformers(limit = 5): FcMember[] {
    return this.listMembers()
      .filter((m) => m.targetPremium > 0)
      .sort((a, b) => b.monthlyPremium - a.monthlyPremium)
      .slice(0, limit)
  }

  /** Per-team performance rollup, best-achieving team first. */
  getTeamSummaries(): TeamSummary[] {
    const byTeam = new Map<string, FcMember[]>()
    for (const member of this.listMembers()) {
      const list = byTeam.get(member.team) ?? []
      list.push(member)
      byTeam.set(member.team, list)
    }
    const summaries: TeamSummary[] = []
    for (const [team, members] of byTeam) {
      const monthlyPremium = members.reduce((sum, m) => sum + m.monthlyPremium, 0)
      const targetPremium = members.reduce((sum, m) => sum + m.targetPremium, 0)
      summaries.push({
        team,
        memberCount: members.length,
        checkedIn: members.filter((m) => m.attendanceStatus === 'checked-in').length,
        monthlyPremium,
        targetPremium,
        achievementRate: achievement(monthlyPremium, targetPremium),
        activityTotal: members.reduce((sum, m) => sum + m.todayActivityCount, 0)
      })
    }
    return summaries.sort((a, b) => b.achievementRate - a.achievementRate)
  }

  /** Today's priority actions surfaced on the FC OS home. */
  getPriorityActions(): FcPriorityAction[] {
    const summary = this.getSummary()
    const actions: FcPriorityAction[] = []
    const notCheckedIn = this.listMembers().filter(
      (m) => m.attendanceStatus === 'not-checked-in'
    ).length
    if (notCheckedIn > 0) {
      actions.push({
        id: 'not-checked-in',
        label: `미출근 FC ${notCheckedIn}명 확인`,
        detail: '아직 출근하지 않은 FC의 출근 상태를 확인하세요.',
        tone: 'warning'
      })
    }
    if (summary.late > 0) {
      actions.push({
        id: 'late',
        label: `지각 FC ${summary.late}명 점검`,
        detail: '지각한 FC의 일정과 활동을 점검하세요.',
        tone: 'warning'
      })
    }
    if (summary.absent > 0) {
      actions.push({
        id: 'absent',
        label: `결근 FC ${summary.absent}명 관리`,
        detail: '결근한 FC에 대한 후속 조치가 필요합니다.',
        tone: 'warning'
      })
    }
    if (summary.inactiveFcCount > 0) {
      actions.push({
        id: 'inactive',
        label: `미활동 FC ${summary.inactiveFcCount}명 독려`,
        detail: '오늘 활동이 0건인 FC의 영업 활동을 독려하세요.',
        tone: 'warning'
      })
    }
    actions.push({
      id: 'next-sprint',
      label: '다음 단계: Customer Workspace 구축',
      detail: 'FC OS 기반이 준비되었습니다. 다음 스프린트에서 고객 워크스페이스를 만드세요.',
      tone: 'info'
    })
    return actions
  }

  // --- attendance actions --------------------------------------------------

  private setAttendance(
    fcId: string,
    attendanceStatus: FcAttendanceStatus,
    type: FcLogType,
    label: string
  ): FcOperationResult<FcMember> {
    return this.updateMember(
      fcId,
      (m) => ({ ...m, attendanceStatus }),
      type,
      (m) => `${m.name} ${label}`
    )
  }

  checkIn(fcId: string): FcOperationResult<FcMember> {
    return this.setAttendance(fcId, 'checked-in', 'checked-in', '출근 처리됨')
  }

  checkOut(fcId: string): FcOperationResult<FcMember> {
    return this.setAttendance(fcId, 'checked-out', 'checked-out', '퇴근 처리됨')
  }

  markLate(fcId: string): FcOperationResult<FcMember> {
    return this.setAttendance(fcId, 'late', 'marked-late', '지각 처리됨')
  }

  markAbsent(fcId: string): FcOperationResult<FcMember> {
    return this.setAttendance(fcId, 'absent', 'marked-absent', '결근 처리됨')
  }

  // --- performance actions -------------------------------------------------

  /** Set a member's monthly premium (KRW); recomputes the achievement rate. */
  updateMonthlyPremium(fcId: string, monthlyPremium: number): FcOperationResult<FcMember> {
    const amount = Math.max(0, Math.round(monthlyPremium))
    return this.updateMember(
      fcId,
      (m) => ({ ...m, monthlyPremium: amount, achievementRate: achievement(amount, m.targetPremium) }),
      'premium-updated',
      (m) => `${m.name} 이번 달 실적 ${formatKrw(amount)} (${m.achievementRate}%)`
    )
  }

  /** Set a member's today activity count. */
  updateActivityCount(fcId: string, todayActivityCount: number): FcOperationResult<FcMember> {
    const count = Math.max(0, Math.round(todayActivityCount))
    return this.updateMember(
      fcId,
      (m) => ({ ...m, todayActivityCount: count }),
      'activity-updated',
      (m) => `${m.name} 오늘 활동 ${count}건`
    )
  }

  /** Move a member to another team. */
  assignToTeam(fcId: string, team: string): FcOperationResult<FcMember> {
    const next = team.trim()
    if (!next) return { success: false, error: 'team is empty' }
    return this.updateMember(
      fcId,
      (m) => ({ ...m, team: next }),
      'team-assigned',
      (m) => `${m.name} → ${next} 배치`
    )
  }

  // --- shared mutation -----------------------------------------------------

  private updateMember(
    fcId: string,
    mutate: (member: FcMember) => FcMember,
    type: FcLogType,
    message: (member: FcMember) => string
  ): FcOperationResult<FcMember> {
    const snapshot = this.state.getSnapshot()
    const index = snapshot.members.findIndex((m) => m.fcId === fcId)
    if (index === -1) return { success: false, error: 'FC not found' }
    const nextMember: FcMember = {
      ...mutate(snapshot.members[index]),
      fcId,
      updatedAt: new Date().toISOString()
    }
    const members = [...snapshot.members]
    members[index] = nextMember
    this.commit(this.withLog({ ...snapshot, members }, type, message(nextMember)))
    this.events.emit('member:updated', nextMember)
    return { success: true, data: nextMember }
  }

  // --- Jarvis integration prep (local, no AI call yet) ---------------------

  /**
   * Answer one of the canonical FC OS questions locally. This is the seam a
   * future Jarvis intent will call — it returns a ready-to-speak Korean summary
   * built from local data, with no external AI call. UI wiring is left for a
   * later sprint.
   */
  answerJarvisQuery(query: FcJarvisQuery): string {
    switch (query) {
      case '오늘 FC 출근 현황':
        return this.describeAttendanceToday()
      case '이번 달 실적':
        return this.describeMonthlyPerformance()
      case '팀별 실적':
        return this.describeTeamPerformance()
      case '미활동 FC':
        return this.describeInactiveFcs()
      case '오늘 일정':
        return this.describeTodaySchedule()
      default:
        return '해당 질문을 아직 이해하지 못했습니다.'
    }
  }

  describeAttendanceToday(): string {
    const s = this.getSummary()
    return `오늘 출근 현황 · 전체 ${s.totalFc}명 중 출근 ${s.checkedIn}명, 지각 ${s.late}명, 외근 ${s.outside}명, 결근 ${s.absent}명`
  }

  describeMonthlyPerformance(): string {
    const s = this.getSummary()
    return `이번 달 실적 · 총 ${formatKrw(s.monthlyPremiumTotal)} / 목표 ${formatKrw(
      s.targetPremiumTotal
    )} (달성률 ${s.achievementRate}%, 계약 ${s.monthlyContractTotal}건)`
  }

  describeTeamPerformance(): string {
    const teams = this.getTeamSummaries()
    if (teams.length === 0) return '팀 실적 데이터가 없습니다.'
    return `팀별 실적 · ${teams
      .map((t) => `${t.team} ${t.achievementRate}%`)
      .join(', ')}`
  }

  describeInactiveFcs(): string {
    const inactive = this.listMembers().filter(
      (m) => m.role === 'FC' && m.todayActivityCount === 0
    )
    if (inactive.length === 0) return '오늘 미활동 FC가 없습니다.'
    return `미활동 FC ${inactive.length}명 · ${inactive.map((m) => m.name).join(', ')}`
  }

  describeTodaySchedule(): string {
    const s = this.getSummary()
    return `오늘 일정 · 총 ${s.todayScheduleTotal}건, 활동 ${s.todayActivityTotal}건`
  }

  // --- company integration -------------------------------------------------

  /**
   * Record a one-time, non-intrusive note in the Development OS event log so the
   * Live Company activity feed shows the FC OS foundation. Does not touch the
   * active DevOS session or next action. Called once on first initialisation.
   */
  private announceFoundation(): void {
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        snapshot,
        'foundation',
        'FC Operating System foundation created — FC OS ready for next sprint'
      )
    )
    devOsRepository.recordEvent(
      'FC OS foundation created — next recommended action: build Customer Workspace'
    )
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the FC OS back to the seed. */
  resetDemoState(): FcOperationResult<FcSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'FC OS demo state reset to seed')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const fcRepository = new FcRepository()
