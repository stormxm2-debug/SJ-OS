import type { AssetManifest, Capability } from '../kernel'
import type { ProviderAction, ProviderPhase } from './types'

/**
 * Coding execution backend — the transport under a real coding provider.
 *
 * A `ClaudeCodeProvider` performs no work itself; it delegates to a
 * `CodingExecutionBackend`. In Electron that backend runs in the Node main
 * process (real filesystem generation) and is reached over IPC. It could as
 * easily be an HTTP service or an in-process engine. This keeps the provider
 * layer provider-neutral and location-transparent: the same contract crosses a
 * process or network boundary unchanged.
 */

/** A unit of coding work sent to the backend. */
export interface CodingExecRequest {
  execId: string
  taskId: string
  projectId: string
  projectName: string
  title: string
  capability: Capability
}

/** Streamed progress from the backend during an execution. */
export type CodingExecEvent =
  | { execId: string; kind: 'phase'; phase: ProviderPhase }
  | { execId: string; kind: 'progress'; progress: number }
  | { execId: string; kind: 'log'; message: string }

/** The final result the backend returns for an execution. */
export interface CodingExecResult {
  ok: boolean
  summary: string
  actions: ProviderAction[]
  artifacts: string[]
  workspace: string
  assets: AssetManifest[]
  logs: string[]
}

/** Callbacks a provider hands the backend to stream real progress back. */
export interface CodingBackendHandlers {
  readonly signal: AbortSignal
  onPhase(phase: ProviderPhase): void
  onProgress(percent: number): void
  onLog(message: string): void
}

export interface CodingExecutionBackend {
  run(
    request: CodingExecRequest,
    handlers: CodingBackendHandlers
  ): Promise<CodingExecResult>
}
