import type { ClaudeRunnerDiagnostics, ClaudeSmokeTestResult } from '@shared/claudeAutoBuild'

/**
 * Shared Claude runner diagnostics store (renderer). One cached result is shared
 * across every hook consumer (Jarvis card + auto-build panel) so the run button
 * gating is consistent. The renderer never runs shell commands — it only asks the
 * main process to perform its fixed checks.
 */

function api(): Window['sj']['claudeBuild'] | undefined {
  return typeof window !== 'undefined' ? window.sj?.claudeBuild : undefined
}

let cached: ClaudeRunnerDiagnostics | null = null
let inFlight: Promise<ClaudeRunnerDiagnostics | null> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((l) => l())
}

export function subscribeDiagnostics(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getRunnerDiagnostics(): ClaudeRunnerDiagnostics | null {
  return cached
}

/** Run (or reuse an in-flight) environment check and notify subscribers. */
export async function refreshRunnerDiagnostics(): Promise<ClaudeRunnerDiagnostics | null> {
  const bridge = api()
  if (!bridge) return null
  if (inFlight) return inFlight
  inFlight = bridge
    .checkRunnerEnvironment()
    .then((result) => {
      cached = result
      emit()
      return result
    })
    .catch(() => null)
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

export async function runSmokeTest(): Promise<ClaudeSmokeTestResult | null> {
  const bridge = api()
  if (!bridge) return null
  try {
    return await bridge.smokeTest()
  } catch {
    return { ok: false, runner: 'unavailable', output: '', error: '스모크 테스트 호출 실패', timedOut: false }
  }
}
