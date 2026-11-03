// E2E 합성 저장 서비스(상태 보존). save→list→getRun→listReviews 왕복을 메모리로 재현.
// window.__FIX 로 구성/결과 제어, window.__CALLS 로 호출 기록.
interface RunRow {
  id: string
  customerId: string | null
  customerName: string | null
  healthRecordRequestId: string | null
  coverageAnalysisRef: string | null
  rulesVersion: string
  status: string
  isDemo: boolean
  result: unknown
  warnings: unknown
  createdAt: string
}
interface ReviewRow {
  id: string
  run_id: string
  candidate_id: string
  status_override: string | null
  note: string | null
  created_at: string
}
interface G {
  __CALLS?: Array<[string, unknown]>
  __RUNS?: RunRow[]
  __REVIEWS?: ReviewRow[]
  __SAVE_N?: number
  __FIX?: { persistence?: boolean; saveDelay?: number }
}
function g(): G {
  const x = globalThis as unknown as G
  if (!x.__CALLS) x.__CALLS = []
  if (!x.__RUNS) x.__RUNS = []
  if (!x.__REVIEWS) x.__REVIEWS = []
  return x
}
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const configured = (): boolean => g().__FIX?.persistence !== false

export const claimFinderStore = {
  async saveRun(input: Record<string, unknown>) {
    g().__CALLS!.push(['saveRun', input])
    if (!configured()) return { ok: false, disabled: true, error: 'disabled' }
    const ms = g().__FIX?.saveDelay ?? 0
    if (ms) await delay(ms)
    g().__SAVE_N = (g().__SAVE_N ?? 0) + 1
    const id = `run-${(input.customerId as string) ?? 'demo'}-${g().__SAVE_N}`
    g().__RUNS!.unshift({
      id,
      customerId: (input.customerId as string | null) ?? null,
      customerName: (input.customerName as string | null) ?? null,
      healthRecordRequestId: (input.healthRecordRequestId as string | null) ?? null,
      coverageAnalysisRef: (input.coverageAnalysisRef as string | null) ?? null,
      rulesVersion: String(input.rulesVersion ?? ''),
      status: 'completed',
      isDemo: Boolean(input.isDemo),
      result: input.result ?? null,
      warnings: input.warnings ?? null,
      createdAt: new Date().toISOString()
    })
    return { ok: true, id }
  },
  async addReview(input: Record<string, unknown>) {
    g().__CALLS!.push(['addReview', input])
    if (!configured()) return { ok: false, disabled: true, error: 'disabled' }
    const id = `rev-${(g().__REVIEWS!.length + 1)}`
    g().__REVIEWS!.push({
      id,
      run_id: String(input.runId),
      candidate_id: String(input.candidateId),
      status_override: (input.statusOverride as string | null) ?? null,
      note: (input.note as string | null) ?? null,
      created_at: new Date().toISOString()
    })
    return { ok: true, id }
  },
  async listRuns(customerId: string) {
    if (!configured()) return { ok: false, disabled: true, error: 'disabled' }
    return { ok: true, data: g().__RUNS!.filter((r) => r.customerId === customerId) }
  },
  async listReviews(runId: string) {
    g().__CALLS!.push(['listReviews', runId])
    if (!configured()) return { ok: false, disabled: true, error: 'disabled' }
    const rows = g().__REVIEWS!.filter((r) => r.run_id === runId).sort((a, b) => b.created_at.localeCompare(a.created_at))
    return { ok: true, data: rows }
  },
  async listVisibleRuns() {
    g().__CALLS!.push(['listVisibleRuns', null])
    if (!configured()) return { ok: false, disabled: true, error: 'disabled' }
    const summaries = g().__RUNS!.map((r) => ({ id: r.id, customerId: r.customerId, rulesVersion: r.rulesVersion, status: r.status, isDemo: r.isDemo, createdAt: r.createdAt }))
    return { ok: true, data: summaries }
  },
  async getRun(runId: string) {
    g().__CALLS!.push(['getRun', runId])
    if (!configured()) return { ok: false, disabled: true, error: 'disabled' }
    const run = g().__RUNS!.find((r) => r.id === runId) ?? null
    return { ok: true, data: run }
  }
}

export function isClaimFinderPersistenceConfigured(): boolean {
  return configured()
}
