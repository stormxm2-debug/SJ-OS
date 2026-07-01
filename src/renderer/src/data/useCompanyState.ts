import type {
  Worker,
  Project,
  Task,
  Notification,
  ActivityEvent
} from '@shared/types'
import * as mock from './mockCompany'

export interface CompanyState {
  workers: Worker[]
  projects: Project[]
  tasks: Task[]
  notifications: Notification[]
  activity: ActivityEvent[]
}

/**
 * The single source the CEO Dashboard reads from.
 *
 * Milestone 2: returns static mock data. A later milestone swaps the body for
 * live orchestrator state over IPC (e.g. `window.sj.company.getState()`),
 * keeping this signature so no dashboard component needs to change.
 */
export function useCompanyState(): CompanyState {
  return {
    workers: mock.workers,
    projects: mock.projects,
    tasks: mock.tasks,
    notifications: mock.notifications,
    activity: mock.activity
  }
}
