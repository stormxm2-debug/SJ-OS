import { universalBuilderRepository } from '@renderer/services/universal-builder/UniversalBuilderRepository'
import type { UniversalBuildProject } from '@renderer/services/universal-builder/types'

/**
 * Bridges a Jarvis universal-build classification into a planned
 * UniversalBuildProject. All planning (app-type detection, module/screen/data
 * model generation, AI-tool orchestration, developer-prompt generation) and all
 * routing (PM Planner / Approval Center / Development OS) live in
 * universalBuilderRepository.submitBuildCommand — which never edits files, runs
 * git, or calls an external API. This bridge just forwards the raw command.
 */
export default class UniversalBuildIntake {
  /** Create + plan + route a universal build project from a CEO command. */
  intake(raw: string): UniversalBuildProject | null {
    const result = universalBuilderRepository.submitBuildCommand({
      originalCommand: raw,
      requestedBy: 'CEO (Jarvis)'
    })
    return result.success && result.data ? result.data : null
  }
}
