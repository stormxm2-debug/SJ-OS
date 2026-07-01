import { useSyncExternalStore } from 'react'
import type { BacklogItem } from '@renderer/data/productBacklog'
import { backlogStore } from './backlogStore'

/** Subscribe a component to the live Product Backlog. */
export function useBacklog(): BacklogItem[] {
  return useSyncExternalStore(backlogStore.subscribe, backlogStore.getSnapshot, backlogStore.getSnapshot)
}
