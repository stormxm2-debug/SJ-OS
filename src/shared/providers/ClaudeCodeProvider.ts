import type { CodingProvider } from './adapter'
import type { CodingExecutionBackend } from './backend'
import type {
  CodingRequest,
  ProviderContext,
  ProviderResult,
  ProviderStatus
} from './types'

/**
 * ClaudeCodeProvider — the first REAL coding provider.
 *
 * It performs no work in this layer: it delegates execution to an injected
 * `CodingExecutionBackend` (in the app, the Node main process doing real file
 * generation over IPC) and streams the backend's real phase/progress/log
 * signals back through the `ProviderContext`. It is NOT simulated
 * (`simulated = false`) — its progress and artifacts are real.
 *
 * The name reflects intent (the Developer's execution engine); there is no
 * vendor code here. Point the backend at the actual Claude Code SDK/CLI later
 * and nothing above this class changes.
 */
export class ClaudeCodeProvider implements CodingProvider {
  readonly kind = 'coding' as const
  readonly simulated = false
  readonly id: string
  private _status: ProviderStatus = 'ready'
  private seq = 0

  constructor(
    private readonly backend: CodingExecutionBackend,
    opts: { id?: string } = {}
  ) {
    this.id = opts.id ?? 'claude-code-provider'
  }

  status(): ProviderStatus {
    return this._status
  }

  async execute(
    request: CodingRequest,
    ctx: ProviderContext
  ): Promise<ProviderResult> {
    this._status = 'running'
    this.seq += 1
    const execId = `${this.id}-${this.seq}`
    try {
      const result = await this.backend.run(
        {
          execId,
          taskId: request.taskId,
          projectId: request.projectId,
          projectName: request.projectName,
          title: request.title,
          capability: request.capability
        },
        {
          signal: ctx.signal,
          onPhase: (phase) => ctx.reportPhase(phase),
          onProgress: (percent) => ctx.reportProgress(percent),
          onLog: (message) => ctx.log(message)
        }
      )
      return {
        ok: result.ok,
        summary: result.summary,
        actions: result.actions,
        artifacts: result.artifacts,
        workspace: result.workspace,
        assets: result.assets,
        logs: result.logs
      }
    } finally {
      this._status = 'ready'
    }
  }
}
