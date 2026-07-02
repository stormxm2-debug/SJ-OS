export type JarvisStatus = 'idle' | 'thinking' | 'running' | 'completed' | 'error'

/** The high-level mode Jarvis resolves a command into. */
export type JarvisMode =
  | 'answer'
  | 'implementation-request'
  | 'navigation'
  | 'briefing'
  | 'external-action'
  | 'gpt'
  | 'unknown'

/** Where a Jarvis answer came from. */
export type JarvisSource = 'local' | 'gpt' | 'fallback'

export interface ParsedCommand {
  raw: string
  normalized: string
  intent: string
  confidence: number
}

/** Result of classifying a raw command into a mode + fine-grained intent. */
export interface JarvisClassification {
  mode: JarvisMode
  intent: string
  confidence: number
  /** Inferred SJ OS workspace the command concerns (implementation/nav). */
  targetWorkspace: string
  /** Navigation target view name, when the command implies navigation. */
  navigationTarget: string | null
  /** Approved external-link key, when the command is an external action. */
  externalKey: string | null
  /** GPT sub-mode, when the command is routed to the GPT brain (mode 'gpt'). */
  gptMode?: string
}

export interface ToolCall {
  id: string
  name: string
  status: 'pending' | 'done' | 'error'
  detail: string
}

export interface ConversationEntry {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolCalls?: ToolCall[]
}

/** A compact metric card shown alongside an answer. */
export interface AnswerCard {
  label: string
  value: string
  tone?: string
}

/** Structured result for Answer Mode. */
export interface JarvisAnswerResult {
  commandUnderstood: string
  sourceWorkspace: string
  summary: string
  cards: AnswerCard[]
  recommendedNextAction: string
  navigationTarget: string | null
  suggestedCommands: string[]
}

/** Structured result for Implementation Mode. */
export interface JarvisImplementationResult {
  requestId: string
  title: string
  interpretedGoal: string
  targetWorkspace: string
  priority: string
  approvalRequired: boolean
  riskLevel: string
  nextAction: string
  status: string
  routeTarget: string
  pmPlanId: string | null
  routingLog: string[]
  suggestedCommands: string[]
}

/** Structured result for External Action Mode (opening an approved link). */
export interface JarvisExternalResult {
  commandUnderstood: string
  target: string
  action: string
  url: string | null
  ok: boolean
  error?: string
}

/** Structured result for GPT Brain Mode (proxy-backed). */
export interface JarvisGptResult {
  source: 'gpt' | 'fallback' | 'disabled' | 'error'
  mode: string
  model?: string
  /** True when the GPT brain/proxy is disabled — show setup guidance. */
  disabled?: boolean
  error?: string
  /** True when a retry is safe. */
  canRetry?: boolean
}

export interface JarvisExecutionResult {
  mode: JarvisMode
  intent: string
  response: string
  toolCalls: ToolCall[]
  status: JarvisStatus
  error?: string
  answer?: JarvisAnswerResult
  implementation?: JarvisImplementationResult
  external?: JarvisExternalResult
  gpt?: JarvisGptResult
  source?: JarvisSource
  navigationTarget?: string | null
  suggestedCommands?: string[]
}

export interface JarvisState {
  isOpen: boolean
  input: string
  status: JarvisStatus
  mode: JarvisMode
  response: string
  toolCalls: ToolCall[]
  history: ConversationEntry[]
  recentCommands: string[]
  lastError?: string
  answer?: JarvisAnswerResult
  implementation?: JarvisImplementationResult
  external?: JarvisExternalResult
  gpt?: JarvisGptResult
  source?: JarvisSource
  navigationTarget?: string | null
  suggestedCommands: string[]
}
