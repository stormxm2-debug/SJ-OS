import type {
  JarvisCommandCategory,
  JarvisCommandSession,
  JarvisMode,
  JarvisTimelineStep,
  JarvisTimelineStepStatus
} from './types'

/**
 * Command session builder — the fast-UX layer.
 *
 * The instant the CEO submits a command, Jarvis creates an optimistic command
 * session with an execution timeline (명령 수신 → 의도 분석 → … → 다음 작업 대기). This
 * is purely local + synchronous, so the UI can show "명령 수신 완료" and a live
 * timeline before (and while) any heavier planning runs. No AI, no API.
 */

let seq = 0

function sessionId(): string {
  seq += 1
  return `sess-${Date.now().toString(36)}-${seq}`
}

function stepId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

/** Map the fine-grained Jarvis mode to the coarse fast-UX category. */
export function categoryFor(mode: JarvisMode): JarvisCommandCategory {
  switch (mode) {
    case 'universal-build':
      return 'universal-build-command'
    case 'implementation-request':
      return 'developer-command'
    case 'navigation':
      return 'navigation'
    case 'external-action':
      return 'external-action'
    case 'answer':
    case 'briefing':
      return 'local-command'
    case 'gpt':
      return 'ai-needed'
    default:
      return 'unknown'
  }
}

// Step labels (Korean UI).
const RECEIVE = '명령 수신'
const INTENT = '의도 분석'
const CLASSIFY = '대상 시스템 분류'
const PLAN = '작업 계획 생성'
const PROMPT = '개발 프롬프트 생성'
const SAVE = '프롬프트 센터 저장'
const WAIT = '다음 작업 대기'
const NAV = '화면 이동 준비'
const EXT = '외부 작업 실행'
const FETCH = '데이터 조회'
const RESPOND = '응답 생성'
const AICORE = 'AI 코어 질의'

/** Ordered step labels for a given category's timeline. */
function labelsFor(category: JarvisCommandCategory | null): string[] {
  switch (category) {
    case 'universal-build-command':
    case 'developer-command':
      return [RECEIVE, INTENT, CLASSIFY, PLAN, PROMPT, SAVE, WAIT]
    case 'navigation':
      return [RECEIVE, INTENT, CLASSIFY, NAV, WAIT]
    case 'external-action':
      return [RECEIVE, INTENT, CLASSIFY, EXT, WAIT]
    case 'local-command':
      return [RECEIVE, INTENT, CLASSIFY, FETCH, RESPOND, WAIT]
    case 'ai-needed':
      return [RECEIVE, INTENT, CLASSIFY, AICORE, RESPOND, WAIT]
    default:
      return [RECEIVE, INTENT, CLASSIFY, RESPOND, WAIT]
  }
}

function makeSteps(labels: string[], statusFor: (index: number, label: string) => JarvisTimelineStepStatus): JarvisTimelineStep[] {
  return labels.map((label, index) => ({ id: stepId('step'), label, status: statusFor(index, label) }))
}

/**
 * The optimistic session created on the FIRST emit — command received, intent
 * analysis running, everything else pending. Category is still unknown.
 */
export function startSession(command: string, receivedAt: string): JarvisCommandSession {
  const labels = [RECEIVE, INTENT, CLASSIFY]
  return {
    id: sessionId(),
    command,
    category: null,
    receivedAt,
    status: 'analyzing',
    steps: makeSteps(labels, (index) => (index === 0 ? 'completed' : index === 1 ? 'running' : 'pending'))
  }
}

/**
 * The final session after processing — all steps completed, except the trailing
 * "다음 작업 대기" step which stays pending (a ready-and-waiting indicator).
 * Keeps the same session id so the UI treats it as the same session.
 */
export function finalizeSession(
  base: JarvisCommandSession,
  category: JarvisCommandCategory,
  opts?: { promptPacketId?: string | null }
): JarvisCommandSession {
  const labels = labelsFor(category)
  const steps = makeSteps(labels, (_index, label) => (label === WAIT ? 'pending' : 'completed'))
  return {
    ...base,
    category,
    status: 'completed',
    steps,
    promptPacketId: opts?.promptPacketId ?? null
  }
}

/** A failed session — command received + intent analysed, then classification failed. */
export function failSession(base: JarvisCommandSession): JarvisCommandSession {
  const labels = [RECEIVE, INTENT, CLASSIFY]
  return {
    ...base,
    category: 'unknown',
    status: 'failed',
    steps: makeSteps(labels, (index) => (index < 2 ? 'completed' : 'failed'))
  }
}
