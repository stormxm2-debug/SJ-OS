import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { fcRepository } from '@renderer/services/fc/FcRepository'
import type { FcMember } from '@renderer/services/fc/types'
import { scheduleRepository, isOpen as isScheduleOpen } from '@renderer/services/schedule/ScheduleRepository'
import type { ScheduleItem } from '@renderer/services/schedule/types'
import { TeamLeaderEvents, type TeamLeaderEventName } from './TeamLeaderEvents'
import { TeamLeaderState } from './TeamLeaderState'
import { teamLeaderSeed } from './seed'
import type {
  Blocker,
  BlockerSeverity,
  BlockerStatus,
  CoachingNote,
  LeaderNextAction,
  TeamLeaderLogEntry,
  TeamLeaderLogType,
  TeamLeaderSnapshot,
  TeamLeaderView,
  TeamMemberRow
} from './types'

export interface TeamLeaderOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 60

/** Canonical Jarvis query keys the Team Leader Workspace answers locally. */
export type TeamLeaderJarvisQuery =
  | '팀 현황'
  | '팀 출근 현황'
  | '팀 실적'
  | '미해결 블로커'
  | '오늘 코칭 대상'
  | '팀 다음 액션'

function cloneSeed(): TeamLeaderSnapshot {
  return JSON.parse(JSON.stringify(teamLeaderSeed)) as TeamLeaderSnapshot
}

function rate(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 100)
}

/** Members that belong to an operating team (exclude CEO / branch/regional). */
function isTeamMember(member: FcMember): boolean {
  return member.role === 'FC' || member.role === 'Team Leader'
}

/**
 * Repository over the Team Leader Workspace. Same shape as PerformanceRepository
 * / ScheduleRepository: a state holder + event bus, mutations return a result
 * and persist through TeamLeaderState.
 *
 * The team roster, attendance, activity and performance for a team are derived
 * live from the FC OS roster (via its public API); customer follow-ups are
 * derived from the Schedule Workspace (customer-follow-up items). The persisted
 * snapshot holds only the leader-owned coaching notes, blockers, next actions,
 * selected team and event log. Actions are safe and local only — no external
 * API, no database. On first initialisation it records a single, non-intrusive
 * note into the Development OS event log; it never rewrites the active DevOS
 * session or next action.
 */
export class TeamLeaderRepository {
  private seq = 0

  constructor(
    private readonly state = new TeamLeaderState(),
    private readonly events = new TeamLeaderEvents()
  ) {
    if (this.state.seededFresh) {
      this.announceFoundation()
    }
  }

  getSnapshot(): TeamLeaderSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: TeamLeaderEventName; payload?: unknown; timestamp: string }) => void
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

  private makeLogEntry(type: TeamLeaderLogType, message: string): TeamLeaderLogEntry {
    return { id: this.nextId('tlevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(
    snapshot: TeamLeaderSnapshot,
    type: TeamLeaderLogType,
    message: string
  ): TeamLeaderSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  private commit(snapshot: TeamLeaderSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  getEventLog(): TeamLeaderLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** Pretty-printed JSON of the full workspace, for the export action. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  // --- teams (derived from FC OS) ------------------------------------------

  /** Operating team names that have a Team Leader, in roster order. */
  listTeams(): string[] {
    const teams: string[] = []
    for (const member of fcRepository.listMembers()) {
      if (member.role === 'Team Leader' && !teams.includes(member.team)) {
        teams.push(member.team)
      }
    }
    return teams
  }

  /** The team currently in focus, defaulting to the first team. */
  getSelectedTeam(): string | null {
    const { selectedTeam } = this.state.getSnapshot()
    const teams = this.listTeams()
    if (selectedTeam && teams.includes(selectedTeam)) return selectedTeam
    return teams[0] ?? null
  }

  selectTeam(team: string): TeamLeaderOperationResult<string> {
    if (!this.listTeams().includes(team)) return { success: false, error: 'team not found' }
    const snapshot = this.state.getSnapshot()
    if (snapshot.selectedTeam === team) return { success: true, data: team }
    this.commit(this.withLog({ ...snapshot, selectedTeam: team }, 'team-selected', `팀 선택: ${team}`))
    this.events.emit('team:selected', team)
    return { success: true, data: team }
  }

  /** The full derived cockpit view for a team (FC OS integration). */
  getTeamView(team: string): TeamLeaderView | null {
    const members = fcRepository.listMembers().filter((m) => m.team === team && isTeamMember(m))
    if (members.length === 0) return null
    const leader = members.find((m) => m.role === 'Team Leader')
    const fcs = members.filter((m) => m.role === 'FC')
    const rows: TeamMemberRow[] = members
      .map<TeamMemberRow>((m) => ({
        fcId: m.fcId,
        name: m.name,
        role: m.role,
        rank: m.rank,
        attendanceStatus: m.attendanceStatus,
        todayActivityCount: m.todayActivityCount,
        todayScheduleCount: m.todayScheduleCount,
        monthlyPremium: m.monthlyPremium,
        targetPremium: m.targetPremium,
        achievementRate: m.targetPremium > 0 ? rate(m.monthlyPremium, m.targetPremium) : 0,
        monthlyContractCount: m.monthlyContractCount
      }))
      .sort((a, b) => b.monthlyPremium - a.monthlyPremium)
    const monthlyPremium = members.reduce((sum, m) => sum + m.monthlyPremium, 0)
    const targetPremium = members.reduce((sum, m) => sum + m.targetPremium, 0)
    const attStatus = (status: string): number =>
      members.filter((m) => m.attendanceStatus === status).length
    return {
      team,
      leaderName: leader?.name ?? '—',
      fcCount: fcs.length,
      attendance: {
        total: members.length,
        checkedIn: attStatus('checked-in'),
        late: attStatus('late'),
        absent: attStatus('absent'),
        outside: attStatus('outside'),
        notCheckedIn: attStatus('not-checked-in')
      },
      todayActivityTotal: members.reduce((sum, m) => sum + m.todayActivityCount, 0),
      todayScheduleTotal: members.reduce((sum, m) => sum + m.todayScheduleCount, 0),
      monthlyPremium,
      targetPremium,
      contractTotal: members.reduce((sum, m) => sum + m.monthlyContractCount, 0),
      achievementRate: rate(monthlyPremium, targetPremium),
      inactiveCount: members.filter((m) => m.todayActivityCount === 0).length,
      members: rows
    }
  }

  /** Open customer follow-ups for a team (Schedule Workspace integration). */
  getTeamFollowUps(team: string): ScheduleItem[] {
    return scheduleRepository
      .listItems()
      .filter((i) => i.team === team && i.kind === 'customer-follow-up' && isScheduleOpen(i))
      .sort((a, b) => (a.startAt < b.startAt ? -1 : 1))
  }

  // --- leader-owned data (reads) -------------------------------------------

  getCoachingNotes(team: string): CoachingNote[] {
    return this.state
      .getSnapshot()
      .coachingNotes.filter((n) => n.team === team)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  getBlockers(team: string): Blocker[] {
    const order: Record<BlockerStatus, number> = { open: 0, 'in-progress': 1, resolved: 2 }
    return this.state
      .getSnapshot()
      .blockers.filter((b) => b.team === team)
      .sort((a, b) => order[a.status] - order[b.status] || (a.createdAt < b.createdAt ? 1 : -1))
  }

  getNextActions(team: string): LeaderNextAction[] {
    return this.state
      .getSnapshot()
      .nextActions.filter((a) => a.team === team)
      .sort((a, b) => {
        if (a.done !== b.done) return Number(a.done) - Number(b.done)
        return (a.due ?? '') < (b.due ?? '') ? -1 : 1
      })
  }

  // --- coaching notes ------------------------------------------------------

  addCoachingNote(
    team: string,
    text: string,
    fcId: string | null = null,
    author = '팀장'
  ): TeamLeaderOperationResult<CoachingNote> {
    const body = text.trim()
    if (!body) return { success: false, error: 'note is empty' }
    const fc = fcId ? fcRepository.getMember(fcId) : null
    const note: CoachingNote = {
      id: this.nextId('tlc'),
      team,
      fcId: fc?.fcId ?? null,
      fcName: fc?.name ?? null,
      author,
      text: body,
      createdAt: new Date().toISOString()
    }
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        { ...snapshot, coachingNotes: [note, ...snapshot.coachingNotes] },
        'note-added',
        `코칭 노트 추가: ${team}${fc ? ` · ${fc.name}` : ''}`
      )
    )
    return { success: true, data: note }
  }

  // --- blockers ------------------------------------------------------------

  addBlocker(
    team: string,
    title: string,
    detail = '',
    severity: BlockerSeverity = 'medium',
    fcId: string | null = null
  ): TeamLeaderOperationResult<Blocker> {
    const name = title.trim()
    if (!name) return { success: false, error: 'title is empty' }
    const fc = fcId ? fcRepository.getMember(fcId) : null
    const now = new Date().toISOString()
    const blocker: Blocker = {
      id: this.nextId('tlb'),
      team,
      fcId: fc?.fcId ?? null,
      fcName: fc?.name ?? null,
      title: name,
      detail: detail.trim(),
      severity,
      status: 'open',
      createdAt: now,
      updatedAt: now
    }
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        { ...snapshot, blockers: [blocker, ...snapshot.blockers] },
        'blocker-added',
        `블로커 등록: ${team} · ${name}`
      )
    )
    return { success: true, data: blocker }
  }

  setBlockerStatus(id: string, status: BlockerStatus): TeamLeaderOperationResult<Blocker> {
    const snapshot = this.state.getSnapshot()
    const index = snapshot.blockers.findIndex((b) => b.id === id)
    if (index === -1) return { success: false, error: 'blocker not found' }
    const next: Blocker = { ...snapshot.blockers[index], status, updatedAt: new Date().toISOString() }
    const blockers = [...snapshot.blockers]
    blockers[index] = next
    this.commit(this.withLog({ ...snapshot, blockers }, 'blocker-updated', `블로커 상태 → ${status}: ${next.title}`))
    return { success: true, data: next }
  }

  // --- next actions --------------------------------------------------------

  addNextAction(
    team: string,
    label: string,
    due: string | null = null,
    fcId: string | null = null
  ): TeamLeaderOperationResult<LeaderNextAction> {
    const text = label.trim()
    if (!text) return { success: false, error: 'label is empty' }
    const fc = fcId ? fcRepository.getMember(fcId) : null
    const action: LeaderNextAction = {
      id: this.nextId('tla'),
      team,
      fcId: fc?.fcId ?? null,
      fcName: fc?.name ?? null,
      label: text,
      due,
      done: false,
      createdAt: new Date().toISOString()
    }
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        { ...snapshot, nextActions: [action, ...snapshot.nextActions] },
        'action-added',
        `다음 액션 추가: ${team} · ${text}`
      )
    )
    return { success: true, data: action }
  }

  toggleNextAction(id: string): TeamLeaderOperationResult<LeaderNextAction> {
    const snapshot = this.state.getSnapshot()
    const index = snapshot.nextActions.findIndex((a) => a.id === id)
    if (index === -1) return { success: false, error: 'action not found' }
    const next: LeaderNextAction = { ...snapshot.nextActions[index], done: !snapshot.nextActions[index].done }
    const nextActions = [...snapshot.nextActions]
    nextActions[index] = next
    this.commit(
      this.withLog(
        { ...snapshot, nextActions },
        'action-toggled',
        `다음 액션 ${next.done ? '완료' : '재개'}: ${next.label}`
      )
    )
    return { success: true, data: next }
  }

  // --- Jarvis integration prep (local, no AI call yet) ---------------------

  /**
   * Answer one of the canonical Team Leader questions locally, for the selected
   * team. This is the seam a future Jarvis intent will call — it returns a
   * ready-to-speak Korean summary built from local data, with no external AI
   * call. UI wiring is left for a later sprint.
   */
  answerJarvisQuery(query: TeamLeaderJarvisQuery): string {
    const team = this.getSelectedTeam()
    if (!team) return '팀 데이터가 없습니다.'
    const view = this.getTeamView(team)
    if (!view) return `${team} 데이터가 없습니다.`
    const won = (v: number): string => `${Math.round(v / 10_000).toLocaleString('ko-KR')}만원`
    switch (query) {
      case '팀 현황':
        return `${team} · FC ${view.fcCount}명, 출근 ${view.attendance.checkedIn}, 오늘 활동 ${view.todayActivityTotal}건, 달성률 ${view.achievementRate}%`
      case '팀 출근 현황':
        return `${team} 출근 · 출근 ${view.attendance.checkedIn}, 지각 ${view.attendance.late}, 외근 ${view.attendance.outside}, 결근 ${view.attendance.absent}`
      case '팀 실적':
        return `${team} 실적 · 보험료 ${won(view.monthlyPremium)}, 계약 ${view.contractTotal}건, 달성률 ${view.achievementRate}%`
      case '미해결 블로커': {
        const open = this.getBlockers(team).filter((b) => b.status !== 'resolved')
        return open.length === 0
          ? `${team} 미해결 블로커가 없습니다.`
          : `${team} 미해결 블로커 ${open.length}건 · ${open.map((b) => b.title).join(', ')}`
      }
      case '오늘 코칭 대상': {
        const inactive = view.members.filter((m) => m.todayActivityCount === 0)
        return inactive.length === 0
          ? `${team} 오늘 활동 미기록 FC가 없습니다.`
          : `${team} 코칭 대상 ${inactive.length}명 · ${inactive.map((m) => m.name).join(', ')}`
      }
      case '팀 다음 액션': {
        const open = this.getNextActions(team).filter((a) => !a.done)
        return open.length === 0
          ? `${team} 예정된 다음 액션이 없습니다.`
          : `${team} 다음 액션 ${open.length}건 · ${open.map((a) => a.label).join(', ')}`
      }
      default:
        return '해당 질문을 아직 이해하지 못했습니다.'
    }
  }

  // --- company integration -------------------------------------------------

  private announceFoundation(): void {
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        snapshot,
        'foundation',
        'Team Leader Workspace foundation created — team leadership cockpit ready for future Jarvis reporting'
      )
    )
    devOsRepository.recordEvent(
      'Team Leader Workspace foundation created — next recommended action: build Consultation Workspace'
    )
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the Team Leader Workspace back to the seed. */
  resetDemoState(): TeamLeaderOperationResult<TeamLeaderSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'Team Leader Workspace demo state reset to seed')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const teamLeaderRepository = new TeamLeaderRepository()
