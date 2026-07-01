/**
 * Provider abstraction contract.
 *
 * No concrete providers and no vendor names live here — only the shape every
 * model provider must satisfy. Workers depend on this interface, never on a
 * specific vendor, so the AI behind any worker can be swapped via configuration.
 * Concrete adapters and a registry implementation arrive in a later milestone.
 */
export interface ModelProvider {
  readonly id: string
  readonly label: string
  readonly capabilities: readonly string[]
}

export interface ProviderRegistry {
  register(provider: ModelProvider): void
  resolve(id: string): ModelProvider | undefined
  list(): readonly ModelProvider[]
}
