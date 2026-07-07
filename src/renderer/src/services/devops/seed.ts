import type { DeploymentItem, DevOpsSnapshot } from './types'

/**
 * DevOps Center seed. Starts empty — real deployments are created by staff as
 * the product is shipped.
 */

const deployments: DeploymentItem[] = []

export const devopsSeed: DevOpsSnapshot = {
  deployments,
  eventLog: []
}
