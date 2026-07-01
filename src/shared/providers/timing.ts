/**
 * Provider-side timing helper. Simulates the latency of a real provider (an API
 * call, a build, a test run) so the worker/provider bridge exercises its async,
 * cancellable control flow exactly as it will against a real backend.
 */
export function runSteps(
  steps: number,
  stepMs: number,
  signal: AbortSignal,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    let progress = 0
    const increment = Math.max(1, Math.round(100 / Math.max(1, steps)))
    const timer = setInterval(() => {
      if (signal.aborted) {
        clearInterval(timer)
        reject(new Error('aborted'))
        return
      }
      progress = Math.min(100, progress + increment)
      onProgress(progress)
      if (progress >= 100) {
        clearInterval(timer)
        resolve()
      }
    }, stepMs)
    signal.addEventListener(
      'abort',
      () => {
        clearInterval(timer)
        reject(new Error('aborted'))
      },
      { once: true }
    )
  })
}
