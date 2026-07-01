import type {
  ActionContext,
  StatusReporter,
  StatusReportInput
} from '../actions'
import type { CeoStatusReport } from '../types'
import { delay } from './timing'

/**
 * Mock status reporter. Assembles a CEO status report from the workflow's
 * artifacts. A real reporter fulfilling this contract (Claude/OpenAI) would
 * write the same fields as natural-language prose; the structure is identical.
 */
export class MockStatusReporter implements StatusReporter {
  async report(
    input: StatusReportInput,
    ctx: ActionContext
  ): Promise<CeoStatusReport> {
    ctx.log('Compiling the CEO status report…')
    await delay(400, ctx.signal)

    const { project, classification, breakdown, queue, progress } = input
    const done = queue.items.filter((i) => i.state === 'done')
    const notDone = queue.items.filter((i) => i.state !== 'done')
    const complete = progress.overall >= 100 && notDone.length === 0

    const risks: string[] = []
    if (progress.blocked > 0) risks.push(`${progress.blocked} item(s) blocked — no available worker.`)
    if (progress.failed > 0) risks.push(`${progress.failed} item(s) failed and need attention.`)
    if (classification.priority === 'critical') risks.push('Critical priority — limited time for hardening.')
    if (classification.size === 'L' || classification.size === 'XL') {
      risks.push('Large scope — consider delivering in increments.')
    }

    const nextActions = complete
      ? ['Review the delivered work.', 'Approve the release when ready.']
      : notDone.slice(0, 3).map((i) => `Resolve “${i.title}” (${i.role}).`)

    return {
      projectId: project.id,
      headline: complete
        ? `“${project.name}” is ready for review.`
        : `“${project.name}” is ${progress.overall}% complete.`,
      summary: complete
        ? `The team completed all ${queue.items.length} work items across ${breakdown.featureCount} feature(s).`
        : `${done.length} of ${queue.items.length} work items are done; ${notDone.length} remain.`,
      progress: progress.overall,
      classification: classification.summary,
      completed: done.map((i) => i.title),
      outstanding: notDone.map((i) => `${i.title} — ${i.state}`),
      risks,
      nextActions,
      generatedAt: project.createdAt
    }
  }
}
