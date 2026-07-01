/**
 * Timing helpers shared by the mock backends. They only simulate the latency a
 * real remote backend (an API call, a CI run, a worker process) would have, so
 * the Chief of Staff exercises its async, cancellable control flow exactly as
 * it will against real services.
 */

/** An abortable delay. Resolves early (does not reject) when aborted. */
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

/** Drive a progress callback from 0→100 in steps; rejects on abort. */
export function runProgress(
  steps: number,
  stepMs: number,
  onProgress: (percent: number) => void,
  signal: AbortSignal
): Promise<void> {
  const inc = Math.max(1, Math.round(100 / Math.max(1, steps)))
  return new Promise((resolve, reject) => {
    let current = 0
    const timer = setInterval(() => {
      if (signal.aborted) {
        clearInterval(timer)
        reject(new Error('aborted'))
        return
      }
      current = Math.min(100, current + inc)
      onProgress(current)
      if (current >= 100) {
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
