import type { WorkerRole } from '../../types'
import type { ActionContext, TaskPlanner } from '../actions'
import type {
  Classification,
  Feature,
  Project,
  Subtask,
  WbsTask,
  WorkBreakdown
} from '../types'
import { delay } from './timing'

/**
 * Mock task planner. Deterministically decomposes a project into an
 * Epic → Features → Tasks → Subtasks work-breakdown structure. A real
 * Claude/OpenAI planner fulfilling this contract would return the same shape.
 */

const FEATURE_AREAS = [
  'Application shell',
  'Navigation & routing',
  'Dashboard',
  'Settings',
  'Theming & status bar'
]

/** Per-feature task templates by role, each with its subtasks. */
const FEATURE_TASKS: { role: WorkerRole; verb: string; subtasks: string[] }[] = [
  {
    role: 'cto',
    verb: 'Design',
    subtasks: ['Define interfaces', 'Outline the data model']
  },
  {
    role: 'backend',
    verb: 'Build API for',
    subtasks: ['Design endpoints', 'Implement handlers']
  },
  {
    role: 'frontend',
    verb: 'Build UI for',
    subtasks: ['Build components', 'Wire to the API']
  },
  {
    role: 'developer',
    verb: 'Implement',
    subtasks: ['Write core logic', 'Add unit tests']
  },
  {
    role: 'qa',
    verb: 'Verify',
    subtasks: ['Author test cases', 'Run the suite']
  }
]

/** Cross-cutting delivery tasks, included only if the role is required. */
const DELIVERY_TASKS: { role: WorkerRole; title: string; subtasks: string[] }[] = [
  { role: 'git', title: 'Commit & open pull request', subtasks: ['Create branch', 'Open PR into main'] },
  { role: 'documentation', title: 'Write documentation', subtasks: ['Update README', 'Write changelog'] },
  { role: 'release', title: 'Publish release', subtasks: ['Tag version', 'Publish release'] }
]

export class MockTaskPlanner implements TaskPlanner {
  async plan(
    project: Project,
    classification: Classification,
    ctx: ActionContext
  ): Promise<WorkBreakdown> {
    ctx.log('Breaking the project into epics, features, tasks and subtasks…')
    await delay(500, ctx.signal)

    const features: Feature[] = []

    // A discovery phase carries the research role.
    if (classification.requiredRoles.includes('research')) {
      features.push({
        id: 'f0',
        title: 'Discovery',
        tasks: [
          makeTask('f0-t1', `Research ${project.name}`, 'research', [
            'Investigate feasibility',
            'Gather references'
          ])
        ]
      })
    }

    for (let i = 0; i < classification.featureCount; i += 1) {
      const fid = `f${i + 1}`
      const title = FEATURE_AREAS[i % FEATURE_AREAS.length]
      const tasks: WbsTask[] = FEATURE_TASKS.filter((t) =>
        classification.requiredRoles.includes(t.role)
      ).map((t, ti) => makeTask(`${fid}-t${ti + 1}`, `${t.verb} ${title.toLowerCase()}`, t.role, t.subtasks))
      features.push({ id: fid, title, tasks })
    }

    // A final delivery feature carries the cross-cutting roles.
    const deliveryTasks: WbsTask[] = DELIVERY_TASKS.filter((t) =>
      classification.requiredRoles.includes(t.role)
    ).map((t, ti) => makeTask(`fd-t${ti + 1}`, t.title, t.role, t.subtasks))
    if (deliveryTasks.length > 0) {
      features.push({ id: 'fd', title: 'Delivery', tasks: deliveryTasks })
    }

    const taskCount = features.reduce((n, f) => n + f.tasks.length, 0)
    const subtaskCount = features.reduce(
      (n, f) => n + f.tasks.reduce((m, t) => m + t.subtasks.length, 0),
      0
    )

    return {
      epic: {
        id: 'e1',
        title: project.name,
        description: project.description,
        features
      },
      featureCount: features.length,
      taskCount,
      subtaskCount
    }
  }
}

function makeTask(
  id: string,
  title: string,
  role: WorkerRole,
  subtaskTitles: string[]
): WbsTask {
  const subtasks: Subtask[] = subtaskTitles.map((st, i) => ({
    id: `${id}-s${i + 1}`,
    title: st
  }))
  return { id, title, role, subtasks }
}
