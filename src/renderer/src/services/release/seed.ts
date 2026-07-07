import type { ReleaseItem, ReleaseSnapshot } from './types'

/**
 * Release Center seed. Starts empty — real releases are created by staff as the
 * product ships.
 */

const releases: ReleaseItem[] = []

export const releaseSeed: ReleaseSnapshot = {
  releases,
  eventLog: []
}
