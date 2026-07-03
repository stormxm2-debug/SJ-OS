import { useSyncExternalStore } from 'react'
import { developerPromptRepository } from './DeveloperPromptRepository'
import type { DeveloperPromptSnapshot } from './types'

/**
 * Subscribe a React component to the Developer Prompt Center snapshot. The
 * repository replaces the snapshot reference only on change, so it is safe for
 * useSyncExternalStore. Mirrors the other SJ OS use* hooks.
 */
export function useDeveloperPrompt(): DeveloperPromptSnapshot {
  return useSyncExternalStore(
    (onChange) => developerPromptRepository.subscribe(onChange),
    () => developerPromptRepository.getSnapshot()
  )
}
