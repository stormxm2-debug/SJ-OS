import type { WorkerRole } from '../../types'
import type { ActionContext, RequestClassifier } from '../actions'
import type {
  CeoRequest,
  Classification,
  Priority,
  ProjectSize,
  RequestType
} from '../types'
import { delay } from './timing'

/**
 * Mock request classifier — keyword heuristics only, no AI. It fulfils the same
 * `RequestClassifier` contract a real OpenAI/Claude classifier will implement,
 * so swapping it in requires no change to the Chief of Staff.
 */

const SIZE_FEATURES: Record<ProjectSize, number> = { XS: 1, S: 2, M: 3, L: 4, XL: 5 }

const REQUIRED_ROLES: Record<RequestType, WorkerRole[]> = {
  new_project: ['cto', 'developer', 'qa', 'git', 'documentation', 'release'],
  existing_project: ['cto', 'developer', 'qa', 'git', 'release'],
  bug_fix: ['developer', 'qa', 'git'],
  improvement: ['cto', 'developer', 'qa', 'git', 'documentation'],
  research: ['cto', 'developer', 'documentation']
}

function detectType(text: string): RequestType {
  if (/\b(bug|fix|broken|crash|defect|regression|not working|fails?|error)\b/.test(text)) return 'bug_fix'
  if (/\b(research|investigate|explore|evaluate|compare|spike|feasibility|prototype|proof of concept)\b/.test(text)) return 'research'
  if (/\b(improve|enhance|optimi[sz]e|refactor|upgrade|polish|speed up|clean ?up)\b/.test(text)) return 'improvement'
  if (/\b(existing|update|extend|add to|continue|revise|modify)\b/.test(text)) return 'existing_project'
  return 'new_project'
}

function detectPriority(text: string, type: RequestType): Priority {
  if (/\b(critical|urgent|asap|immediately|emergency|p0|blocker)\b/.test(text)) return 'critical'
  if (/\b(important|high priority|soon|priority)\b/.test(text)) return 'high'
  if (/\b(low priority|minor|whenever|someday|nice to have|eventually)\b/.test(text)) return 'low'
  if (type === 'bug_fix') return 'high'
  return 'medium'
}

function detectSize(text: string, type: RequestType): ProjectSize {
  const words = text.split(/\s+/).filter(Boolean).length
  const big = /\b(engine|platform|system|suite|end[- ]to[- ]end|company[- ]wide|entire|full|complete|multi)\b/.test(text)
  const small = /\b(small|tiny|tweak|minor|copy|text|label|button|typo|wording|colou?r)\b/.test(text)
  if (type === 'bug_fix') return small ? 'XS' : 'S'
  if (type === 'research') return big ? 'L' : 'M'
  if (big) return /\b(engine|platform|suite|entire|company[- ]wide)\b/.test(text) ? 'XL' : 'L'
  if (small) return 'XS'
  if (words > 24) return 'L'
  if (words > 12) return 'M'
  return 'S'
}

export class MockRequestClassifier implements RequestClassifier {
  async classify(request: CeoRequest, ctx: ActionContext): Promise<Classification> {
    ctx.log('Classifying the request and estimating size…')
    await delay(450, ctx.signal)
    const text = request.text.toLowerCase()
    const type = detectType(text)
    const priority = detectPriority(text, type)
    const size = detectSize(text, type)
    const featureCount = SIZE_FEATURES[size]
    const label = type.replace('_', ' ')
    return {
      type,
      priority,
      size,
      featureCount,
      requiredRoles: REQUIRED_ROLES[type],
      summary: `${label} · ${priority} priority · estimated ${size}`,
      rationale: `Matched a ${label} request; sized ${size} from scope keywords and length (${featureCount} feature areas).`
    }
  }
}
