import type { Capability, KernelWorkerRecord } from './types'

/**
 * Departments.
 *
 * The company is organised into departments, one per capability. The Kernel
 * schedules work to a DEPARTMENT (by capability); the department then assigns
 * that work to one of ITS workers. Today each department has a single worker,
 * but the model never assumes it: a department owns a list of worker ids and
 * picks an available one, so adding more workers to a department scales it
 * horizontally with no change to the Kernel or the scheduler.
 */

export interface Department {
  id: string
  name: string
  capability: Capability
  workerIds: string[]
}

/** A department plus which of its workers are currently free — fed to the scheduler. */
export interface DepartmentView {
  department: Department
  idleWorkerIds: string[]
}

const DEPARTMENT_NAME: Record<Capability, string> = {
  cto: 'Architecture Department',
  research: 'Research Department',
  frontend: 'Frontend Department',
  backend: 'Backend Department',
  developer: 'Developer Department',
  qa: 'QA Department',
  git: 'Git Department',
  documentation: 'Documentation Department',
  release: 'Release Department'
}

export function departmentIdFor(capability: Capability): string {
  return `dept-${capability}`
}

/** Group a worker roster into departments by capability. */
export function buildDepartments(workers: KernelWorkerRecord[]): Department[] {
  const byId = new Map<string, Department>()
  for (const worker of workers) {
    const capability = worker.capabilities[0]
    if (!capability) continue
    let dept = byId.get(worker.departmentId)
    if (!dept) {
      dept = {
        id: worker.departmentId,
        name: DEPARTMENT_NAME[capability] ?? `${capability} Department`,
        capability,
        workerIds: []
      }
      byId.set(worker.departmentId, dept)
    }
    dept.workerIds.push(worker.id)
  }
  return [...byId.values()]
}

/**
 * A department's assignment policy: pick the first free worker it owns that has
 * not already been claimed in this scheduling pass. Simple round-robin-friendly
 * default; swap for load- or cost-aware policies without touching the Kernel.
 */
export function assignWorkerInDepartment(
  department: Department,
  idleWorkerIds: readonly string[],
  claimed: ReadonlySet<string>
): string | null {
  for (const workerId of department.workerIds) {
    if (idleWorkerIds.includes(workerId) && !claimed.has(workerId)) return workerId
  }
  return null
}
