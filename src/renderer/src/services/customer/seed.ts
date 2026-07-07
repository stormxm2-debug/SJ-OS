import type { CustomerRecord, CustomerSnapshot } from './types'

/**
 * Customer pipeline seed. Starts empty — real customers are entered by staff.
 */

const customers: CustomerRecord[] = []

export const customerSeed: CustomerSnapshot = {
  customers,
  selectedCustomerId: null,
  eventLog: []
}
