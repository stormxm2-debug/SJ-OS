import type { Capability, KernelTask } from './types'
import { PRIORITY_RANK } from './types'
import { assignWorkerInDepartment, type DepartmentView } from './department'

/**
 * Scheduler — pure orchestration, NO AI.
 *
 * It schedules to DEPARTMENTS first. Given the current tasks and the departments
 * (each with its currently-free workers), it decides, deterministically, which
 * task goes to which department — and lets that department assign one of its
 * workers. It:
 *   - considers only tasks whose dependencies are satisfied (the ready queue),
 *   - prioritises by priority rank, then by submission order (stable FIFO),
 *   - routes each ready task to the department for its capability,
 *   - asks the department to assign a free worker (never assuming just one).
 *
 * It holds no mutable state and mutates nothing — the Kernel owns state and
 * applies these decisions. Adding workers to a department scales it with no
 * change here.
 */

export interface DispatchDecision {
  taskId: string
  departmentId: string
  workerId: string
}

export interface Scheduler {
  plan(
    tasks: readonly KernelTask[],
    departments: readonly DepartmentView[]
  ): DispatchDecision[]
}

export class PriorityScheduler implements Scheduler {
  plan(
    tasks: readonly KernelTask[],
    departments: readonly DepartmentView[]
  ): DispatchDecision[] {
    const completed = new Set(
      tasks.filter((t) => t.state === 'completed').map((t) => t.id)
    )

    const ready = tasks
      .map((task, order) => ({ task, order }))
      .filter(
        ({ task }) =>
          task.state === 'pending' &&
          task.dependsOn.every((dep) => completed.has(dep))
      )
      .sort(byPriorityThenOrder)

    const byCapability = new Map<Capability, DepartmentView>()
    for (const view of departments) byCapability.set(view.department.capability, view)

    const claimed = new Set<string>()
    const decisions: DispatchDecision[] = []

    for (const { task } of ready) {
      const view = byCapability.get(task.capability)
      if (!view) continue
      // The department assigns one of its workers.
      const workerId = assignWorkerInDepartment(
        view.department,
        view.idleWorkerIds,
        claimed
      )
      if (!workerId) continue
      claimed.add(workerId)
      decisions.push({ taskId: task.id, departmentId: view.department.id, workerId })
    }

    return decisions
  }
}

function byPriorityThenOrder(
  a: { task: KernelTask; order: number },
  b: { task: KernelTask; order: number }
): number {
  const byPriority = PRIORITY_RANK[b.task.priority] - PRIORITY_RANK[a.task.priority]
  return byPriority !== 0 ? byPriority : a.order - b.order
}
