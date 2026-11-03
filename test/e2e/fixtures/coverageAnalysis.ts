// E2E 합성 어댑터.
export function listAnalyses() {
  const g = globalThis as unknown as { __FIX?: { analyses?: unknown[] } }
  return (g.__FIX?.analyses ?? []) as never
}
