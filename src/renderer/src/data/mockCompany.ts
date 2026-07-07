import type {
  Worker,
  Project,
  Task,
  Notification,
  ActivityEvent
} from '@shared/types'

/**
 * Company state seed. Starts EMPTY — the AI-company / dashboard views begin clean.
 * A later milestone replaces these exports with live orchestrator state delivered
 * over IPC; the dashboard components and the `useCompanyState` hook stay unchanged.
 */

export const workers: Worker[] = []

export const projects: Project[] = []

export const tasks: Task[] = []

export const notifications: Notification[] = []

export const activity: ActivityEvent[] = []
