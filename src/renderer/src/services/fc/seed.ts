import type { FcMember, FcSnapshot } from './types'

/**
 * Field organization (FC OS) seed. Starts empty — the real roster (CEO, branch
 * managers, team leaders and FCs) is entered by staff.
 */

const members: FcMember[] = []

export const fcSeed: FcSnapshot = {
  members,
  eventLog: []
}
