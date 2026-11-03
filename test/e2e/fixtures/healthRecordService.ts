// E2E 합성 어댑터. recordDelay 로 고객별 지연을 줘 경쟁 상태를 재현한다.
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function listHealthRecords(customerId?: string) {
  const g = globalThis as unknown as { __FIX?: { records?: Array<Record<string, unknown>>; recordDelay?: number | Record<string, number> } }
  const dc = g.__FIX?.recordDelay
  const ms = typeof dc === 'number' ? dc : customerId && dc ? dc[customerId] ?? 0 : 0
  if (ms) await delay(ms)
  const items = (g.__FIX?.records ?? []).filter((r) => !customerId || r.customerId === customerId)
  return { ok: true, items: items as never }
}
