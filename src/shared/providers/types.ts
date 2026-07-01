import type { AssetManifest, Capability } from '../kernel'

/**
 * Provider layer — domain types.
 *
 * A "provider" is the thing that actually does a worker's job: generate code,
 * run tests, open a PR, drive a browser, run a script. In Sprint 3 every
 * provider is a mock; the point is the SHAPE, so a real provider (Claude Code,
 * OpenAI, GitHub, Playwright, Python) can be dropped in later behind these same
 * interfaces with zero change to the Kernel or the workers above it.
 *
 * Pure, serializable data only — providers may later run out of process.
 */

/** What family a provider belongs to. Extensible; only 'coding' exists today. */
export type ProviderKind = 'coding'

/** Health/availability of a provider. */
export type ProviderStatus = 'ready' | 'running' | 'unavailable'

/** The phase a coding provider reports as it works (maps to ExecutionStatus). */
export type ProviderPhase = 'planning' | 'coding' | 'testing'

/** Risk classification for a proposed action (drives the Approval Policy). */
export type RiskLevel = 'safe' | 'warning' | 'dangerous'

/**
 * A concrete action a provider proposes to take. In Sprint 3 these are only
 * described, never executed for real — no destructive operation is permitted.
 */
export interface ProviderAction {
  id: string
  description: string
  risk: RiskLevel
}

/** The outcome of a provider execution. */
export interface ProviderResult {
  ok: boolean
  summary: string
  /** Actions the provider took or proposes — each risk-classified. */
  actions: ProviderAction[]
  /** Real artifacts produced (e.g. file paths written). Empty for none. */
  artifacts: string[]
  /** The on-disk project workspace, if the provider produced real files. */
  workspace: string
  /** Reusable assets produced by this work, if any. */
  assets: AssetManifest[]
  logs: string[]
}

/** A unit of work handed to a coding provider. */
export interface CodingRequest {
  taskId: string
  projectId: string
  projectName: string
  title: string
  capability: Capability
}

/** Cancellation, progress, phase and logging handed to a provider execution. */
export interface ProviderContext {
  readonly signal: AbortSignal
  reportPhase(phase: ProviderPhase): void
  reportProgress(percent: number): void
  log(message: string): void
}
