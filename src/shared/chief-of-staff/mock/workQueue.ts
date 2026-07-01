import type { ActionContext, WorkQueueBuilder } from '../actions'
import type { WorkBreakdown, WorkItem, WorkQueue } from '../types'
import { delay } from './timing'

/**
 * Mock work-queue builder. Flattens the WBS into an ordered list of executable
 * work items and wires up dependencies so the Chief of Staff can dispatch them
 * safely in sequence:
 *   - within a feature, each task depends on the previous one (design → build → verify);
 *   - the Delivery feature depends on every preceding feature-task being done.
 *
 * A real scheduler fulfilling this contract could topologically sort a richer
 * dependency graph; the output shape is identical.
 */
export class MockWorkQueueBuilder implements WorkQueueBuilder {
  async build(breakdown: WorkBreakdown, ctx: ActionContext): Promise<WorkQueue> {
    ctx.log('Sequencing tasks into a work queue…')
    await delay(350, ctx.signal)

    const items: WorkItem[] = []
    const featureLeafIds: string[] = []

    for (const feature of breakdown.epic.features) {
      const isDelivery = feature.id === 'fd'
      let prevInFeature: string | null = null

      for (const task of feature.tasks) {
        const dependsOn: string[] = []
        if (prevInFeature) dependsOn.push(prevInFeature)
        // Delivery work waits for all feature work to complete.
        if (isDelivery) dependsOn.push(...featureLeafIds)

        items.push({
          id: task.id,
          title: task.title,
          role: task.role,
          featureId: feature.id,
          taskId: task.id,
          dependsOn: unique(dependsOn),
          state: 'queued',
          progress: 0,
          assignedWorkerId: null,
          note: null
        })
        prevInFeature = task.id
        if (!isDelivery) featureLeafIds.push(task.id)
      }
    }

    return { items }
  }
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)]
}
