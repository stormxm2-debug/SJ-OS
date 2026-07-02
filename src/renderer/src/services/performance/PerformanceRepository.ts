import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { fcRepository } from '@renderer/services/fc/FcRepository'
import type { FcMember } from '@renderer/services/fc/types'
import { PerformanceEvents, type PerformanceEventName } from './PerformanceEvents'
import { PerformanceState } from './PerformanceState'
import { performanceSeed } from './seed'
import type {
  FcPerformanceRank,
  PeriodView,
  PerformanceLogEntry,
  PerformanceLogType,
  PerformanceSnapshot,
  PerformanceSummary,
  ProductionPoint,
  TeamPerformanceRank,
  TrendCard
} from './types'

export interface PerformanceOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 60

/** Canonical Jarvis query keys the Performance Workspace answers locally. */
export type PerformanceJarvisQuery =
  | '이번달 실적'
  | '목표 달성률'
  | 'FC 실적 순위'
  | '팀 실적 순위'
  | '실적 추세'
  | '목표 달성 FC'

function cloneSeed(): PerformanceSnapshot {
  return JSON.parse(JSON.stringify(performanceSeed)) as PerformanceSnapshot
}

function rate(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 100)
}

/** Members that actually produce — exclude the CEO and zero-target rows. */
function isProducer(member: FcMember): boolean {
  return member.role !== 'CEO' && (member.targetPremium > 0 || member.monthlyPremium > 0)
}

/**
 * Repository over the Performance Workspace. Same shape as ScheduleRepository /
 * SalesActivityRepository: a state holder + event bus, mutations return a result
 * and persist through PerformanceState.
 *
 * Current-period FC and team rankings and the production summary are derived
 * live from the FC OS roster (via its public API) so there is a single source of
 * truth for production figures — no duplicated numbers to drift. The persisted
 * snapshot holds only the seeded daily / weekly / monthly trend series, the
 * selected view and the event log. Actions are safe and local only — no external
 * API, no database. On first initialisation it records a single, non-intrusive
 * note into the Development OS event log; it never rewrites the active DevOS
 * session or next action.
 */
export class PerformanceRepository {
  private seq = 0

  constructor(
    private readonly state = new PerformanceState(),
    private readonly events = new PerformanceEvents()
  ) {
    if (this.state.seededFresh) {
      this.announceFoundation()
    }
  }

  getSnapshot(): PerformanceSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: PerformanceEventName; payload?: unknown; timestamp: string }) => void
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

  private makeLogEntry(type: PerformanceLogType, message: string): PerformanceLogEntry {
    return { id: this.nextId('perfevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(
    snapshot: PerformanceSnapshot,
    type: PerformanceLogType,
    message: string
  ): PerformanceSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  private commit(snapshot: PerformanceSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- trend series (persisted local mock) ---------------------------------

  getEventLog(): PerformanceLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  getSelectedView(): PeriodView {
    return this.state.getSnapshot().selectedView
  }

  getSeries(view: PeriodView): ProductionPoint[] {
    const snapshot = this.state.getSnapshot()
    return view === 'daily' ? snapshot.daily : view === 'weekly' ? snapshot.weekly : snapshot.monthly
  }

  /** Pretty-printed JSON of the full workspace, for the export action. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  // --- derived rollups (live from FC OS) -----------------------------------

  private producers(): FcMember[] {
    return fcRepository.listMembers().filter(isProducer)
  }

  /** Per-FC performance ranking, highest premium first (FC OS integration). */
  getFcRanking(): FcPerformanceRank[] {
    return this.producers()
      .map<FcPerformanceRank>((m) => ({
        fcId: m.fcId,
        fcName: m.name,
        team: m.team,
        role: m.role,
        monthlyPremium: m.monthlyPremium,
        contractCount: m.monthlyContractCount,
        targetPremium: m.targetPremium,
        achievementRate: m.targetPremium > 0 ? rate(m.monthlyPremium, m.targetPremium) : 0
      }))
      .sort((a, b) => b.monthlyPremium - a.monthlyPremium)
  }

  /** Per-team performance ranking, highest premium first (FC OS integration). */
  getTeamRanking(): TeamPerformanceRank[] {
    const byTeam = new Map<string, FcMember[]>()
    for (const member of this.producers()) {
      const list = byTeam.get(member.team) ?? []
      list.push(member)
      byTeam.set(member.team, list)
    }
    const ranks: TeamPerformanceRank[] = []
    for (const [team, list] of byTeam) {
      const monthlyPremium = list.reduce((sum, m) => sum + m.monthlyPremium, 0)
      const targetPremium = list.reduce((sum, m) => sum + m.targetPremium, 0)
      ranks.push({
        team,
        memberCount: list.length,
        monthlyPremium,
        targetPremium,
        contractCount: list.reduce((sum, m) => sum + m.monthlyContractCount, 0),
        achievementRate: rate(monthlyPremium, targetPremium)
      })
    }
    return ranks.sort((a, b) => b.monthlyPremium - a.monthlyPremium)
  }

  /** Organization-wide production summary (FC OS integration). */
  getSummary(): PerformanceSummary {
    const fcRanking = this.getFcRanking()
    const teamRanking = this.getTeamRanking()
    const monthlyPremiumTotal = fcRanking.reduce((sum, r) => sum + r.monthlyPremium, 0)
    const targetPremiumTotal = fcRanking.reduce((sum, r) => sum + r.targetPremium, 0)
    const contractTotal = fcRanking.reduce((sum, r) => sum + r.contractCount, 0)
    return {
      monthlyPremiumTotal,
      targetPremiumTotal,
      contractTotal,
      achievementRate: rate(monthlyPremiumTotal, targetPremiumTotal),
      producingFcCount: fcRanking.length,
      topFcName: fcRanking[0]?.fcName ?? '—',
      topTeamName: teamRanking[0]?.team ?? '—',
      averagePremiumPerFc: fcRanking.length > 0 ? Math.round(monthlyPremiumTotal / fcRanking.length) : 0,
      targetHitCount: fcRanking.filter((r) => r.achievementRate >= 100).length
    }
  }

  /** Trend cards comparing the latest bucket of each series to the previous. */
  getTrendCards(view: PeriodView): TrendCard[] {
    const series = this.getSeries(view)
    const current = series[series.length - 1]
    const previous = series[series.length - 2]
    if (!current) return []
    const card = (label: string, cur: number, prev: number): TrendCard => {
      const deltaPct = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0
      return {
        label,
        current: cur,
        previous: prev,
        deltaPct,
        direction: deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat'
      }
    }
    return [
      card('보험료', current.premium, previous?.premium ?? 0),
      card('계약건수', current.contractCount, previous?.contractCount ?? 0),
      card('활동량', current.activityCount, previous?.activityCount ?? 0)
    ]
  }

  // --- view selection ------------------------------------------------------

  setView(view: PeriodView): PerformanceOperationResult<PeriodView> {
    const snapshot = this.state.getSnapshot()
    if (snapshot.selectedView === view) return { success: true, data: view }
    this.commit(this.withLog({ ...snapshot, selectedView: view }, 'view-changed', `실적 뷰 전환: ${view}`))
    this.events.emit('view:changed', view)
    return { success: true, data: view }
  }

  // --- Jarvis integration prep (local, no AI call yet) ---------------------

  /**
   * Answer one of the canonical Performance questions locally. This is the seam
   * a future Jarvis intent will call — it returns a ready-to-speak Korean
   * summary built from local data, with no external AI call. UI wiring is left
   * for a later sprint.
   */
  answerJarvisQuery(query: PerformanceJarvisQuery): string {
    const s = this.getSummary()
    const won = (v: number): string => `${Math.round(v / 10_000).toLocaleString('ko-KR')}만원`
    switch (query) {
      case '이번달 실적':
        return `이번달 실적 · 보험료 ${won(s.monthlyPremiumTotal)}, 계약 ${s.contractTotal}건, 달성률 ${s.achievementRate}%`
      case '목표 달성률':
        return `목표 달성률 ${s.achievementRate}% · 목표 ${won(s.targetPremiumTotal)} 대비 실적 ${won(s.monthlyPremiumTotal)}`
      case 'FC 실적 순위':
        return `FC 실적 순위 · ${this.getFcRanking()
          .slice(0, 5)
          .map((r) => `${r.fcName} ${won(r.monthlyPremium)}`)
          .join(', ')}`
      case '팀 실적 순위':
        return `팀 실적 순위 · ${this.getTeamRanking()
          .map((r) => `${r.team} ${r.achievementRate}%`)
          .join(', ')}`
      case '실적 추세': {
        const cards = this.getTrendCards(this.getSelectedView())
        const premium = cards[0]
        return premium
          ? `실적 추세(${this.getSelectedView()}) · 보험료 ${premium.deltaPct >= 0 ? '+' : ''}${premium.deltaPct}%`
          : '추세 데이터가 없습니다.'
      }
      case '목표 달성 FC':
        return s.targetHitCount === 0
          ? '이번달 목표를 달성한 FC가 아직 없습니다.'
          : `목표 달성 FC ${s.targetHitCount}명`
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
        'Performance Workspace foundation created — production scoreboard ready for future Jarvis reporting'
      )
    )
    devOsRepository.recordEvent(
      'Performance Workspace foundation created — next recommended action: build Team Leader Workspace'
    )
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the Performance Workspace trend series back to the seed. */
  resetDemoState(): PerformanceOperationResult<PerformanceSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'Performance Workspace demo state reset to seed')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const performanceRepository = new PerformanceRepository()
