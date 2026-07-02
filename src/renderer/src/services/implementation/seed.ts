import type { ImplementationSnapshot } from './types'

/**
 * The Implementation Request queue starts empty — requests are raised live by
 * Jarvis from CEO commands. A single foundation note is appended by the
 * repository on first initialisation (see ImplementationRepository), so the seed
 * itself carries no requests and no fabricated history.
 */
export const implementationSeed: ImplementationSnapshot = {
  requests: [],
  selectedRequestId: null,
  eventLog: []
}
