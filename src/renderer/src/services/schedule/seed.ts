import type { ScheduleItem, ScheduleSnapshot } from './types'

/**
 * Shared schedule / calendar seed. Starts empty — real schedule items are
 * entered by staff.
 */

const items: ScheduleItem[] = []

export const scheduleSeed: ScheduleSnapshot = {
  items,
  selectedScheduleId: null,
  eventLog: []
}
