import type { CodingProvider } from './adapter'
import type {
  CodingRequest,
  ProviderContext,
  ProviderResult,
  ProviderStatus
} from './types'
import { runSteps } from './timing'

/**
 * A simulated coding provider (EXPLICITLY marked `simulated: true`, per Sprint
 * 4). It reports real phase transitions (planning → coding → testing) and
 * progress, but writes no files and proposes only SAFE actions. It exists as the
 * fallback when no real backend is available; the real path is
 * `ClaudeCodeProvider`.
 */
export class MockCodingProvider implements CodingProvider {
  readonly kind = 'coding' as const
  readonly simulated = true
  readonly id: string
  private _status: ProviderStatus = 'ready'
  private readonly stepMs: number

  constructor(opts: { id?: string; stepMs?: number } = {}) {
    this.id = opts.id ?? 'mock-coding-provider'
    this.stepMs = opts.stepMs ?? 180
  }

  status(): ProviderStatus {
    return this._status
  }

  async execute(
    request: CodingRequest,
    ctx: ProviderContext
  ): Promise<ProviderResult> {
    this._status = 'running'
    try {
      ctx.reportPhase('planning')
      ctx.log(`Planning “${request.title}”…`)
      await runSteps(2, this.stepMs, ctx.signal, (p) => ctx.reportProgress(Math.round(p * 0.3)))

      ctx.reportPhase('coding')
      await runSteps(4, this.stepMs, ctx.signal, (p) =>
        ctx.reportProgress(30 + Math.round(p * 0.5))
      )

      ctx.reportPhase('testing')
      await runSteps(2, this.stepMs, ctx.signal, (p) =>
        ctx.reportProgress(80 + Math.round(p * 0.2))
      )
    } finally {
      this._status = 'ready'
    }

    return {
      ok: true,
      summary: `Simulated implementation of “${request.title}” (no files written).`,
      actions: [
        { id: `${request.taskId}-a1`, description: 'Create source module', risk: 'safe' },
        { id: `${request.taskId}-a2`, description: 'Add unit tests', risk: 'safe' }
      ],
      artifacts: [],
      workspace: '',
      assets: [],
      logs: ['Planned', 'Generated (simulated)', 'Verified (simulated)']
    }
  }
}
