import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import { customerRepository } from '@renderer/services/customer/CustomerRepository'
import { AnalysisEvents, type AnalysisEventName } from './AnalysisEvents'
import { AnalysisState } from './AnalysisState'
import { analysisSeed } from './seed'
import type {
  AnalysisLogEntry,
  AnalysisLogType,
  AnalysisSnapshot,
  AnalysisStatus,
  AnalysisSummary,
  CoverageCategory,
  GapSeverity,
  InsuranceAnalysis,
  JarvisEntryPoint
} from './types'

export interface AnalysisOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Keep the persisted event log bounded. */
const MAX_LOG_ENTRIES = 60

const RECOMMENDATION_PLACEHOLDER =
  '※ 자동 분석 미연동 — 향후 Jarvis 분석 엔진이 보장 공백/추천을 자동 생성합니다. 현재는 FC 수동 검토용 초안입니다.'

/**
 * Future Jarvis entry points. These describe the seams a later analysis engine
 * (AI/rule-based) will answer — they are NOT wired to any AI call yet, so every
 * entry has ready = false. This is the foundation the next milestone builds on.
 */
const JARVIS_ENTRY_POINTS: JarvisEntryPoint[] = [
  { key: 'coverage-gap', label: '보장 공백 분석', description: '고객 보유 증권 대비 부족 보장 자동 진단', ready: false },
  { key: 'recommendation', label: '맞춤 추천 설계', description: '리스크 태그 기반 상품/보장 추천 생성', ready: false },
  { key: 'risk-scoring', label: '리스크 스코어링', description: '가족/소득/건강 리스크 점수화', ready: false },
  { key: 'policy-summary', label: '증권 요약', description: '보유 증권 자동 요약 및 카테고리 분류', ready: false },
  { key: 'premium-optimization', label: '보험료 최적화', description: '중복/과다 보장 정리 및 보험료 최적화 제안', ready: false }
]

function cloneSeed(): AnalysisSnapshot {
  return JSON.parse(JSON.stringify(analysisSeed)) as AnalysisSnapshot
}

/** True when the analysis has any insufficient / uninsured coverage category. */
export function isUnderinsured(analysis: InsuranceAnalysis): boolean {
  return analysis.coverage.some((c) => c.adequacy === 'insufficient' || c.adequacy === 'none')
}

/**
 * Repository over the Insurance Analysis Entry. Same shape as
 * ConsultationRepository / ScheduleRepository: a state holder + event bus,
 * mutations return a result and persist through AnalysisState.
 *
 * IMPORTANT: this is a *foundation only* — it performs no real AI or external
 * API calls. Recommendations are local placeholders and getJarvisEntryPoints()
 * describes seams a future engine will fill. Opening an analysis reuses the
 * Customer Workspace roster (risk tags, assigned FC). All actions are safe and
 * local only — no external API, no database. On first initialisation it records
 * a single, non-intrusive note into the Development OS event log; it never
 * rewrites the active DevOS session or next action.
 */
export class AnalysisRepository {
  private seq = 0

  constructor(
    private readonly state = new AnalysisState(),
    private readonly events = new AnalysisEvents()
  ) {
    if (this.state.seededFresh) {
      this.announceFoundation()
    }
  }

  getSnapshot(): AnalysisSnapshot {
    return this.state.getSnapshot()
  }

  subscribe(
    listener: (event: { type: AnalysisEventName; payload?: unknown; timestamp: string }) => void
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

  private makeLogEntry(type: AnalysisLogType, message: string): AnalysisLogEntry {
    return { id: this.nextId('anaevt'), type, message, createdAt: new Date().toISOString() }
  }

  private withLog(
    snapshot: AnalysisSnapshot,
    type: AnalysisLogType,
    message: string
  ): AnalysisSnapshot {
    const entry = this.makeLogEntry(type, message)
    return { ...snapshot, eventLog: [entry, ...snapshot.eventLog].slice(0, MAX_LOG_ENTRIES) }
  }

  private commit(snapshot: AnalysisSnapshot): void {
    this.state.setSnapshot(snapshot)
    this.emitUpdated()
  }

  // --- reads ---------------------------------------------------------------

  listAnalyses(): InsuranceAnalysis[] {
    return this.state.getSnapshot().analyses
  }

  getAnalysis(analysisId: string): InsuranceAnalysis | null {
    return this.state.getSnapshot().analyses.find((a) => a.analysisId === analysisId) ?? null
  }

  getSelectedAnalysis(): InsuranceAnalysis | null {
    const { selectedAnalysisId } = this.state.getSnapshot()
    return selectedAnalysisId ? this.getAnalysis(selectedAnalysisId) : null
  }

  getByCustomer(customerId: string): InsuranceAnalysis | null {
    return this.state.getSnapshot().analyses.find((a) => a.customerId === customerId) ?? null
  }

  getEventLog(): AnalysisLogEntry[] {
    return this.state.getSnapshot().eventLog
  }

  /** The future Jarvis entry points this foundation exposes (all not-ready). */
  getJarvisEntryPoints(): JarvisEntryPoint[] {
    return JARVIS_ENTRY_POINTS
  }

  /** Pretty-printed JSON of the full workspace, for the export action. */
  serializeSnapshot(): string {
    return JSON.stringify(this.state.getSnapshot(), null, 2)
  }

  // --- rollups -------------------------------------------------------------

  /** Organization-wide analysis summary. */
  getSummary(): AnalysisSummary {
    const list = this.listAnalyses()
    const count = (predicate: (a: InsuranceAnalysis) => boolean): number =>
      list.filter(predicate).length
    const gaps = list.flatMap((a) => a.missingCoverage)
    const premiumTotal = list.reduce(
      (sum, a) => sum + a.policies.reduce((s, p) => s + p.monthlyPremium, 0),
      0
    )
    return {
      total: list.length,
      notStarted: count((a) => a.status === 'not-started'),
      inProgress: count((a) => a.status === 'in-progress'),
      draft: count((a) => a.status === 'draft'),
      reviewed: count((a) => a.status === 'reviewed'),
      totalGaps: gaps.length,
      highSeverityGaps: gaps.filter((g) => g.severity === 'high').length,
      underinsured: count(isUnderinsured),
      averageMonthlyPremium: list.length > 0 ? Math.round(premiumTotal / list.length) : 0
    }
  }

  // --- selection -----------------------------------------------------------

  selectAnalysis(analysisId: string | null): AnalysisOperationResult<string | null> {
    const snapshot = this.state.getSnapshot()
    if (analysisId && !snapshot.analyses.some((a) => a.analysisId === analysisId)) {
      return { success: false, error: 'analysis not found' }
    }
    this.state.setSnapshot({ ...snapshot, selectedAnalysisId: analysisId })
    this.events.emit('selection:changed', analysisId)
    this.events.emit('snapshot:updated')
    return { success: true, data: analysisId }
  }

  // --- create --------------------------------------------------------------

  /** Open a fresh analysis for a customer (reuses Customer Workspace data). */
  createAnalysis(customerId: string): AnalysisOperationResult<InsuranceAnalysis> {
    const customer = customerRepository.getCustomer(customerId)
    if (!customer) return { success: false, error: 'customer not found' }
    if (this.getByCustomer(customer.customerId)) {
      return { success: false, error: 'analysis already exists for customer' }
    }
    const now = new Date().toISOString()
    const analysis: InsuranceAnalysis = {
      analysisId: this.nextId('ana'),
      customerId: customer.customerId,
      customerName: customer.name,
      fcId: customer.assignedFcId,
      fcName: customer.assignedFcName,
      team: customer.team,
      status: 'not-started',
      policies: [],
      coverage: [],
      missingCoverage: [],
      riskTags: [...customer.riskTags],
      recommendationPlaceholder: RECOMMENDATION_PLACEHOLDER,
      aiReady: false,
      analyzedAt: null,
      createdAt: now,
      updatedAt: now
    }
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        { ...snapshot, analyses: [analysis, ...snapshot.analyses] },
        'created',
        `보험분석 개설: ${customer.name}`
      )
    )
    return { success: true, data: analysis }
  }

  // --- shared mutation -----------------------------------------------------

  private updateAnalysis(
    analysisId: string,
    mutate: (a: InsuranceAnalysis) => InsuranceAnalysis,
    type: AnalysisLogType,
    message: (a: InsuranceAnalysis) => string
  ): AnalysisOperationResult<InsuranceAnalysis> {
    const snapshot = this.state.getSnapshot()
    const index = snapshot.analyses.findIndex((a) => a.analysisId === analysisId)
    if (index === -1) return { success: false, error: 'analysis not found' }
    const next: InsuranceAnalysis = {
      ...mutate(snapshot.analyses[index]),
      analysisId,
      updatedAt: new Date().toISOString()
    }
    const analyses = [...snapshot.analyses]
    analyses[index] = next
    this.commit(this.withLog({ ...snapshot, analyses }, type, message(next)))
    this.events.emit('analysis:updated', next)
    return { success: true, data: next }
  }

  // --- edits ---------------------------------------------------------------

  setStatus(analysisId: string, status: AnalysisStatus): AnalysisOperationResult<InsuranceAnalysis> {
    const now = new Date().toISOString()
    return this.updateAnalysis(
      analysisId,
      (a) => ({ ...a, status, analyzedAt: status === 'reviewed' ? a.analyzedAt ?? now : a.analyzedAt }),
      'status-changed',
      (a) => `${a.customerName} 분석 상태 → ${status}`
    )
  }

  /**
   * Update the local recommendation placeholder text. This stays a manual FC
   * note until a real analysis engine backs it — aiReady remains false.
   */
  updateRecommendationPlaceholder(
    analysisId: string,
    text: string
  ): AnalysisOperationResult<InsuranceAnalysis> {
    const body = text.trim()
    if (!body) return { success: false, error: 'recommendation is empty' }
    return this.updateAnalysis(
      analysisId,
      (a) => ({ ...a, recommendationPlaceholder: body }),
      'recommendation-updated',
      (a) => `${a.customerName} 추천 메모 업데이트`
    )
  }

  addMissingCoverage(
    analysisId: string,
    category: CoverageCategory,
    note: string,
    severity: GapSeverity = 'medium'
  ): AnalysisOperationResult<InsuranceAnalysis> {
    const body = note.trim()
    if (!body) return { success: false, error: 'note is empty' }
    return this.updateAnalysis(
      analysisId,
      (a) => ({
        ...a,
        missingCoverage: [
          ...a.missingCoverage,
          { id: this.nextId('gap'), category, note: body, severity }
        ]
      }),
      'gap-added',
      (a) => `${a.customerName} 보장 공백 추가: ${category}`
    )
  }

  addRiskTag(analysisId: string, tag: string): AnalysisOperationResult<InsuranceAnalysis> {
    const value = tag.trim()
    if (!value) return { success: false, error: 'tag is empty' }
    return this.updateAnalysis(
      analysisId,
      (a) => ({ ...a, riskTags: a.riskTags.includes(value) ? a.riskTags : [...a.riskTags, value] }),
      'risk-tag-added',
      (a) => `${a.customerName} 리스크 태그 추가: ${value}`
    )
  }

  // --- Jarvis integration prep (local placeholders only, no AI call) -------

  /**
   * Answer a canonical Insurance Analysis question locally. This foundation
   * returns placeholder / rule-free summaries and clearly flags that automatic
   * AI analysis is not yet connected. UI wiring and the real engine are future
   * milestones.
   */
  answerJarvisQuery(key: string): string {
    const entry = JARVIS_ENTRY_POINTS.find((e) => e.key === key)
    if (!entry) return '해당 분석 항목을 아직 이해하지 못했습니다.'
    const s = this.getSummary()
    switch (key) {
      case 'coverage-gap':
        return `보장 공백(수동 집계) ${s.totalGaps}건 · 고위험 ${s.highSeverityGaps}건 · 보장부족 고객 ${s.underinsured}명. ${entry.label} 자동 분석은 향후 연동 예정입니다.`
      case 'policy-summary':
        return `분석 대상 ${s.total}건 · 평균 월납 ${Math.round(s.averageMonthlyPremium / 1_000).toLocaleString('ko-KR')}천원. 증권 자동 요약은 향후 연동 예정입니다.`
      default:
        return `${entry.label}: ${entry.description}. (자동 분석 미연동 — 향후 Jarvis 엔진 연결 예정)`
    }
  }

  // --- company integration -------------------------------------------------

  private announceFoundation(): void {
    const snapshot = this.state.getSnapshot()
    this.commit(
      this.withLog(
        snapshot,
        'foundation',
        'Insurance Analysis Entry foundation created — local mock structure ready; AI analysis engine not yet wired'
      )
    )
    devOsRepository.recordEvent(
      'Insurance Analysis Entry foundation created — next recommended action: connect analysis engine (future Jarvis)'
    )
  }

  // --- demo controls -------------------------------------------------------

  /** Reset the Insurance Analysis Entry back to the seed. */
  resetDemoState(): AnalysisOperationResult<AnalysisSnapshot> {
    const fresh = this.withLog(cloneSeed(), 'reset', 'Insurance Analysis Entry demo state reset to seed')
    this.commit(fresh)
    return { success: true, data: fresh }
  }
}

export const analysisRepository = new AnalysisRepository()
