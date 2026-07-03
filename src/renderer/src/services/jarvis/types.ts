import type { AiToolAssignment, SprintPlanEntry } from '@renderer/services/universal-builder/types'

export type JarvisStatus = 'idle' | 'thinking' | 'running' | 'completed' | 'error'

/** The high-level mode Jarvis resolves a command into. */
export type JarvisMode =
  | 'answer'
  | 'implementation-request'
  | 'universal-build'
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
  /** Claude Code-ready developer prompt generated for this request. */
  generatedDeveloperPrompt: string
  /** Developer Prompt Center packet id tracking this prompt (null if none). */
  promptPacketId: string | null
  suggestedCommands: string[]
}

/** Structured result for Universal App Builder Mode. */
export interface JarvisUniversalBuildResult {
  projectId: string
  projectName: string
  appType: string
  industry: string
  targetUsers: string
  interpretedGoal: string
  requiredModules: string[]
  suggestedScreens: string[]
  suggestedDataModels: string[]
  suggestedIntegrations: string[]
  aiToolPlan: AiToolAssignment[]
  sprintPlan: SprintPlanEntry[]
  riskLevel: string
  approvalRequired: boolean
  status: string
  assumptions: string[]
  pmPlanId: string | null
  routingLog: string[]
  nextAction: string
  /** Claude Code-ready developer prompt (paste to start development). */
  generatedDeveloperPrompt: string
  /** Developer Prompt Center packet id tracking this prompt (null if none). */
  promptPacketId: string | null
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
  source: 'gpt' | 'openai' | 'fallback' | 'disabled' | 'error' | 'backend'
  mode: string
  model?: string
  /** True when the GPT brain/proxy is disabled — show setup guidance. */
  disabled?: boolean
  error?: string
  /** True when a retry is safe. */
  canRetry?: boolean
}

/**
 * Fast-UX command category — the fast local classification bucket surfaced to
 * the UI (a coarser view of JarvisMode). Drives the optimistic command session +
 * AI Core visual before any heavy processing runs.
 */
export type JarvisCommandCategory =
  | 'local-command'
  | 'navigation'
  | 'external-action'
  | 'developer-command'
  | 'universal-build-command'
  | 'unknown'
  | 'ai-needed'

/** Status of a single step in the command execution timeline. */
export type JarvisTimelineStepStatus = 'pending' | 'running' | 'completed' | 'failed'

/** One step in the command execution timeline (명령 수신 → 다음 작업 대기 …). */
export interface JarvisTimelineStep {
  id: string
  label: string
  status: JarvisTimelineStepStatus
}

/** Lifecycle of an optimistic command session. */
export type JarvisSessionStatus = 'analyzing' | 'processing' | 'completed' | 'failed'

/**
 * An optimistic command session created the instant the CEO submits a command.
 * It shows "명령 수신 완료" + the original command + a live execution timeline
 * before (and while) heavy processing runs, so Jarvis feels instant.
 */
export interface JarvisCommandSession {
  id: string
  command: string
  /** Fast local classification bucket (null while still analyzing). */
  category: JarvisCommandCategory | null
  receivedAt: string
  status: JarvisSessionStatus
  steps: JarvisTimelineStep[]
  /** Developer Prompt Center packet id, when a prompt was generated. */
  promptPacketId?: string | null
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
  universalBuild?: JarvisUniversalBuildResult
  external?: JarvisExternalResult
  gpt?: JarvisGptResult
  source?: JarvisSource
  navigationTarget?: string | null
  suggestedCommands?: string[]
  session?: JarvisCommandSession
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
  universalBuild?: JarvisUniversalBuildResult
  external?: JarvisExternalResult
  gpt?: JarvisGptResult
  source?: JarvisSource
  navigationTarget?: string | null
  suggestedCommands: string[]
  /** The current optimistic command session + execution timeline (fast UX). */
  session?: JarvisCommandSession
  /**
   * A command text queued to prefill the Jarvis input (e.g. from a dashboard
   * suggestion). The panel copies it into its input, focuses, then clears it via
   * consumePendingDraft(). It is NOT auto-executed.
   */
  pendingDraft?: string | null
}
