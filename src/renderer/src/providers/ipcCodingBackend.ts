import type {
  CodingBackendHandlers,
  CodingExecRequest,
  CodingExecResult,
  CodingExecutionBackend
} from '@shared/providers'

/**
 * Renderer-side coding backend: fulfils the provider-neutral
 * `CodingExecutionBackend` contract over the preload IPC bridge. It forwards a
 * request to the main process, filters the streamed events by execId, and pipes
 * real phase/progress/log signals into the provider's handlers.
 */
export class IpcCodingBackend implements CodingExecutionBackend {
  constructor(private readonly coding: Window['sj']['coding']) {}

  run(
    request: CodingExecRequest,
    handlers: CodingBackendHandlers
  ): Promise<CodingExecResult> {
    const unsubscribe = this.coding.onEvent((event) => {
      if (event.execId !== request.execId) return
      if (event.kind === 'phase') handlers.onPhase(event.phase)
      else if (event.kind === 'progress') handlers.onProgress(event.progress)
      else if (event.kind === 'log') handlers.onLog(event.message)
    })

    return new Promise<CodingExecResult>((resolve, reject) => {
      if (handlers.signal.aborted) {
        unsubscribe()
        reject(new Error('aborted'))
        return
      }
      handlers.signal.addEventListener(
        'abort',
        () => {
          unsubscribe()
          reject(new Error('aborted'))
        },
        { once: true }
      )
      this.coding
        .execute(request)
        .then(resolve, reject)
        .finally(unsubscribe)
    })
  }
}
