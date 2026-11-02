// E2E 합성 어댑터(테스트 전용) — 운영 인증/서비스 우회 아님. window.__FIX 로 데이터 주입.
export async function listCustomers() {
  const g = globalThis as unknown as { __FIX?: { customers?: unknown[] } }
  return { ok: true, customers: (g.__FIX?.customers ?? []) as never }
}
