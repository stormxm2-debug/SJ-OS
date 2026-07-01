import type {
  CodingRequest,
  ProviderContext,
  ProviderKind,
  ProviderResult,
  ProviderStatus
} from './types'

/**
 * Provider adapter interfaces — the replaceable seam under every worker.
 *
 * `ProviderAdapter` is the base every provider shares (identity + health).
 * `CodingProvider` is the first specialised adapter: it executes a coding task
 * and returns a risk-classified result. A real `ClaudeCodeProvider` (or an
 * OpenAI-backed one) implements THIS interface and nothing else needs to move.
 *
 * No provider names a vendor or an external API here — that arrives later,
 * strictly behind these interfaces.
 */
export interface ProviderAdapter {
  readonly id: string
  readonly kind: ProviderKind
  /** True when this provider is a simulation (marked explicitly, per Sprint 4). */
  readonly simulated: boolean
  status(): ProviderStatus
}

export interface CodingProvider extends ProviderAdapter {
  readonly kind: 'coding'
  execute(request: CodingRequest, ctx: ProviderContext): Promise<ProviderResult>
}
