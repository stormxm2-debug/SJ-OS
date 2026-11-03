// E2E 합성 저장 서비스. 호출을 window.__CALLS 에 기록, 결과/구성여부는 window.__FIX 로 제어.
interface G {
  __CALLS?: Array<[string, unknown]>
  __SAVE_N?: number
  __FIX?: { saveResult?: { ok: boolean; id?: string; error?: string; disabled?: boolean }; reviewResult?: { ok: boolean; id?: string; error?: string; disabled?: boolean }; persistence?: boolean; saveDelay?: number }
}
function g(): G {
  const x = globalThis as unknown as G
  if (!x.__CALLS) x.__CALLS = []
  return x
}
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export const claimFinderStore = {
  async saveRun(input: unknown) {
    g().__CALLS!.push(['saveRun', input])
    const ms = g().__FIX?.saveDelay ?? 0
    if (ms) await delay(ms)
    if (g().__FIX?.saveResult) return g().__FIX!.saveResult
    // payload 고객으로 식별 가능한 id 반환(스테일 완료 검증용).
    g().__SAVE_N = (g().__SAVE_N ?? 0) + 1
    const cid = (input as { customerId?: string | null })?.customerId ?? 'demo'
    return { ok: true, id: `run-${cid}-${g().__SAVE_N}` }
  },
  async addReview(input: unknown) {
    g().__CALLS!.push(['addReview', input])
    return g().__FIX?.reviewResult ?? { ok: true, id: 'rev-1' }
  }
}

export function isClaimFinderPersistenceConfigured(): boolean {
  return g().__FIX?.persistence !== false
}
