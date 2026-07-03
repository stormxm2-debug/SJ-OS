import type { UniversalBuilderSnapshot } from './types'

/**
 * The Universal Builder queue starts empty — projects are raised live by Jarvis
 * from CEO build commands. A single foundation note is appended by the
 * repository on first initialisation (see UniversalBuilderRepository), so the
 * seed itself carries no projects and no fabricated history.
 */
export const universalBuilderSeed: UniversalBuilderSnapshot = {
  projects: [],
  selectedProjectId: null,
  eventLog: []
}
