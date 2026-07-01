import type { WorkerRole } from '../types'
import type {
  Assignment,
  CeoRequest,
  CeoStatusReport,
  Classification,
  Project,
  ProgressSnapshot,
  WorkBreakdown,
  WorkQueue
} from './types'

/**
 * The full observable state of the Chief of Staff, replaced immutably on every
 * change. The UI renders exactly this; nothing else is needed to demonstrate
 * the workflow end to end.
 */

export type CosPhase =
  | 'idle'
  | 'receiving'
  | 'classifying'
  | 'meeting'
  | 'creating_project'
  | 'planning'
  | 'queuing'
  | 'assigning'
  | 'executing'
  | 'reporting'
  | 'done'
  | 'failed'

export type CosLogActor = WorkerRole | 'ceo' | 'chief_of_staff' | 'system'

export interface CosLogEntry {
  id: string
  actor: CosLogActor
  message: string
  at: string
}

export interface ChiefOfStaffState {
  phase: CosPhase
  request: CeoRequest | null
  classification: Classification | null
  project: Project | null
  breakdown: WorkBreakdown | null
  queue: WorkQueue
  assignments: Assignment[]
  progress: ProgressSnapshot | null
  report: CeoStatusReport | null
  log: CosLogEntry[]
}

export function initialChiefOfStaffState(): ChiefOfStaffState {
  return {
    phase: 'idle',
    request: null,
    classification: null,
    project: null,
    breakdown: null,
    queue: { items: [] },
    assignments: [],
    progress: null,
    report: null,
    log: []
  }
}
