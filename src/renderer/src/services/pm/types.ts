/**
 * PM Planner — planning types.
 *
 * SJ OS turns high-level backlog items into a structured plan of Epics,
 * Features and Tasks. These types are the shape of that plan, persisted
 * locally alongside the Development OS memory (no external API, no database).
 *
 * The plan is a four-level hierarchy:
 *   backlogItem → epic → feature → task
 * Every level shares a common planning shape (priority, status, owner,
 * dependencies, acceptance criteria, estimated complexity, timestamps).
 */

export type PmPriority = 'P0' | 'P1' | 'P2' | 'P3'

export type PmStatus = 'planned' | 'in_progress' | 'blocked' | 'completed'

export type PmComplexity = 'S' | 'M' | 'L' | 'XL'

/** The kind of node in the plan hierarchy. */
export type PmNodeKind = 'backlogItem' | 'epic' | 'feature' | 'task'

/** Fields shared by every planning node. */
export interface PmNodeBase {
  id: string
  kind: PmNodeKind
  title: string
  priority: PmPriority
  status: PmStatus
  /** DevOS worker id that owns this node (see DevOS seed: cto/pm/architect/…). */
  ownerWorkerId: string
  /** Ids of other planning nodes this one depends on. */
  dependencies: string[]
  acceptanceCriteria: string[]
  estimatedComplexity: PmComplexity
  createdAt: string
  updatedAt: string
}

/** A high-level backlog item, the root of a plan tree. */
export interface PmBacklogItem extends PmNodeBase {
  kind: 'backlogItem'
  description: string
}

/** An epic that realises part of a backlog item. */
export interface PmEpic extends PmNodeBase {
  kind: 'epic'
  backlogItemId: string
}

/** A feature that belongs to an epic. */
export interface PmFeature extends PmNodeBase {
  kind: 'feature'
  epicId: string
}

/** A concrete, assignable task that belongs to a feature. */
export interface PmTask extends PmNodeBase {
  kind: 'task'
  featureId: string
  /** Populated only when status is 'blocked'. */
  blocker: string | null
}

/** Kinds of events recorded in the persisted PM Planner event log. */
export type PmLogType =
  | 'plan-generated'
  | 'task-completed'
  | 'task-assigned'
  | 'blocker-added'
  | 'blocker-cleared'
  | 'feature-promoted'
  | 'reset'

/** A single, human-readable entry in the persisted PM Planner event log. */
export interface PmLogEntry {
  id: string
  type: PmLogType
  message: string
  createdAt: string
}

/** The full persisted PM Planner snapshot. */
export interface PmSnapshot {
  backlogItems: PmBacklogItem[]
  epics: PmEpic[]
  features: PmFeature[]
  tasks: PmTask[]
  /** Newest-first log of meaningful planning changes. */
  eventLog: PmLogEntry[]
}
