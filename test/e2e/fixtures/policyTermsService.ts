// E2E 합성 어댑터.
export async function listPolicyTerms() {
  const g = globalThis as unknown as { __FIX?: { terms?: unknown[] } }
  return { ok: true, items: (g.__FIX?.terms ?? []) as never }
}
