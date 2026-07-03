/**
 * Developer Prompt Center domain — the safe bridge between a CEO development
 * command and real Claude Code work.
 *
 * When Jarvis handles a build command ("쇼핑몰 시스템 만들어") or a developer
 * command ("FC OS에 팀별 필터 만들어"), it does NOT edit source files. Instead it
 * turns the command into a structured Claude Code prompt and records it here as a
 * DeveloperPromptPacket. The CEO copies the prompt into Claude Code, and the
 * packet's status is tracked back inside SJ OS (생성됨 → 복사됨 → Claude 전달됨 →
 * 개발 중 → 완료). No API key, no external API, no file edits, no git — local-first
 * (localStorage) in the same repository + state + event-bus + persistence style as
 * the other SJ OS modules.
 */

/** Where a prompt packet originated. */
export type DeveloperPromptSourceType =
  | 'developer-command'
  | 'universal-build-project'
  | 'implementation-request'

/** Lifecycle of a developer prompt packet. */
export type DeveloperPromptStatus =
  | 'draft'
  | 'generated'
  | 'copied'
  | 'sent-to-claude'
  | 'in-development'
  | 'verified'
  | 'completed'
  | 'blocked'
  | 'rejected'

/** Priority ladder, shared across SJ OS. */
export type DeveloperPromptPriority = 'P0' | 'P1' | 'P2' | 'P3'

/** How risky the change is. */
export type DeveloperPromptRiskLevel = 'low' | 'medium' | 'high' | 'critical'

/** A single structured Claude Code prompt packet tracked by SJ OS. */
export interface DeveloperPromptPacket {
  id: string
  sourceType: DeveloperPromptSourceType
  /** Id of the source record (implementation request / universal build project). */
  sourceId: string
  title: string
  /** Human-readable Korean label of the target workspace / app type. */
  targetWorkspace: string
  interpretedGoal: string
  /** The full Claude Code-ready prompt the CEO pastes. */
  promptText: string
  status: DeveloperPromptStatus
  priority: DeveloperPromptPriority
  riskLevel: DeveloperPromptRiskLevel
  approvalRequired: boolean
  /** When the prompt was last copied to the clipboard (null until copied). */
  copiedAt: string | null
  /** When the CEO marked the prompt as pasted into Claude Code (null until sent). */
  sentToClaudeAt: string | null
  /** When the work was marked complete (null until completed). */
  completedAt: string | null
  createdAt: string
  updatedAt: string
  /** Suggested verification steps to run after Claude Code finishes. */
  verificationChecklist: string[]
  /** Suggested commit message for the change. */
  commitMessage: string
  /** Free-form CEO notes. */
  notes: string
}

/** Kinds of events recorded in the persisted Developer Prompt event log. */
export type DeveloperPromptLogType =
  | 'generated'
  | 'copied'
  | 'sent-to-claude'
  | 'status-changed'
  | 'completed'
  | 'blocked'
  | 'rejected'
  | 'foundation'
  | 'reset'

/** A single, human-readable entry in the persisted Developer Prompt event log. */
export interface DeveloperPromptLogEntry {
  id: string
  type: DeveloperPromptLogType
  message: string
  createdAt: string
}

/** The full persisted Developer Prompt Center snapshot. */
export interface DeveloperPromptSnapshot {
  packets: DeveloperPromptPacket[]
  /** Id of the packet currently open in the detail panel (null = none). */
  selectedPacketId: string | null
  /** Newest-first log of meaningful Developer Prompt changes. */
  eventLog: DeveloperPromptLogEntry[]
}

/** Organization-wide developer-prompt rollup (for Autopilot / PM / CTO / DevOS). */
export interface DeveloperPromptSummary {
  total: number
  /** draft + generated — not yet copied. */
  pending: number
  /** copied — waiting to be pasted into Claude Code. */
  waitingForClaude: number
  /** sent-to-claude + in-development. */
  inDevelopment: number
  /** verified + completed. */
  completed: number
  /** blocked + rejected. */
  blocked: number
  /** High/critical risk packets not yet completed. */
  highRisk: number
}

/** Fields a caller (Jarvis) supplies to register a new prompt packet. */
export interface NewDeveloperPromptInput {
  sourceType: DeveloperPromptSourceType
  sourceId: string
  title: string
  targetWorkspace: string
  interpretedGoal: string
  promptText: string
  priority: DeveloperPromptPriority
  riskLevel: DeveloperPromptRiskLevel
  approvalRequired: boolean
  commitMessage: string
  verificationChecklist?: string[]
}
