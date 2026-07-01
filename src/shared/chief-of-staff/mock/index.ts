import type { ChiefOfStaffBackends } from '../ChiefOfStaff'
import { MockRequestClassifier } from './classifier'
import { MockTaskPlanner } from './taskPlanner'
import { MockWorkQueueBuilder } from './workQueue'
import { MockStatusReporter } from './statusReporter'

/**
 * Assemble the Chief of Staff's PLANNING backends (all mock).
 *
 * Since Sprint 2 the Chief of Staff only plans; assignment, dispatch and
 * tracking belong to the Company Kernel. Replace any entry with a real
 * implementation of the same interface (e.g. an OpenAI/Claude classifier) and
 * nothing in the Chief of Staff or the Kernel changes.
 */
export function createMockBackends(): ChiefOfStaffBackends {
  return {
    classifier: new MockRequestClassifier(),
    taskPlanner: new MockTaskPlanner(),
    queueBuilder: new MockWorkQueueBuilder(),
    statusReporter: new MockStatusReporter()
  }
}

export {
  MockRequestClassifier,
  MockTaskPlanner,
  MockWorkQueueBuilder,
  MockStatusReporter
}
