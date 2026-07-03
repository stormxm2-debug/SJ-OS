import type { DeveloperPromptSnapshot } from './types'

/**
 * The Developer Prompt Center starts empty — packets are registered live by
 * Jarvis from CEO build/developer commands. A single foundation note is appended
 * by the repository on first initialisation (see DeveloperPromptRepository), so
 * the seed itself carries no packets and no fabricated history.
 */
export const developerPromptSeed: DeveloperPromptSnapshot = {
  packets: [],
  selectedPacketId: null,
  eventLog: []
}
