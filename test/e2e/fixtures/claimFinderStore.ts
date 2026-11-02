// E2E 합성 저장 서비스. 호출을 window.__CALLS 에 기록, 결과/구성여부는 window.__FIX 로 제어.
interface G {
  __CALLS?: Array<[string, unknown]>
  __FIX?: { saveResult?: { ok: boolean; id?: string; error?: string; disabled?: boolean }; reviewResult?: { ok: boolean; id?: string; error?: string; disabled?: boolean }; persistence?: boolean }
}
function g(): G {
  const x = globalThis as unknown as G
  if (!x.__CALLS) x.__CALLS = []
  return x
}

export const claimFinderStore = {
  async saveRun(input: unknown) {
    g().__CALLS!.push(['saveRun', input])
    return g().__FIX?.saveResult ?? { ok: true, id: 'run-abcdef12' }
  },
  async addReview(input: unknown) {
    g().__CALLS!.push(['addReview', input])
    return g().__FIX?.reviewResult ?? { ok: true, id: 'rev-1' }
  }
}

export function isClaimFinderPersistenceConfigured(): boolean {
  return g().__FIX?.persistence !== false
}
