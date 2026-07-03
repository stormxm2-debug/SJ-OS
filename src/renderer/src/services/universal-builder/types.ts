/**
 * Universal App Builder domain — turns a CEO "build me a system" command into a
 * structured, local build project.
 *
 * SJ OS is no longer an insurance-only system. When the CEO tells Jarvis
 * "쇼핑몰 시스템 만들어" / "학원 관리 프로그램 만들어" / "병원 예약 시스템 만들어",
 * Jarvis does NOT edit source files or call any external API. Instead it creates
 * a UniversalBuildProject: a locally-planned app-building project with a feature
 * plan, screen list, data models, an AI-tool orchestration plan and a Claude
 * Code-ready developer prompt. The project is routed through the existing
 * development operating system (PM Planner / Approval Center / Development OS /
 * Autopilot) exactly like an Implementation Request.
 *
 * This is a self-contained renderer-side service in the same repository + state
 * + event-bus + persistence style as the other SJ OS modules. All data is local
 * (localStorage) — no external API, no database, no git, no file edits, no keys.
 */

/** The kind of business system a build command targets. */
export type UniversalAppType =
  | 'ecommerce'
  | 'crm'
  | 'education'
  | 'hospital-reservation'
  | 'real-estate'
  | 'insurance'
  | 'marketing-automation'
  | 'content-production'
  | 'internal-dashboard'
  | 'custom'

/** Lifecycle of a universal build project. */
export type UniversalBuildStatus =
  | 'captured'
  | 'interpreted'
  | 'planned'
  | 'needs-approval'
  | 'approved'
  | 'prompt-generated'
  | 'sent-to-claude'
  | 'in-development'
  | 'completed'
  | 'blocked'
  | 'rejected'

/** How risky building the system is — drives approval routing. */
export type UniversalRiskLevel = 'low' | 'medium' | 'high' | 'critical'

// --- AI Tool Connector Registry -------------------------------------------

/** The external AI tools SJ OS can plan to orchestrate. */
export type AiToolId =
  | 'openai'
  | 'gemini'
  | 'claude-code'
  | 'canva'
  | 'gamma'
  | 'kling'
  | 'notion'
  | 'suno'

/** Broad capability category of an AI tool. */
export type AiToolCategory =
  | 'llm'
  | 'code'
  | 'design'
  | 'document'
  | 'video'
  | 'knowledge'
  | 'audio'

/** How ready a tool connector is inside SJ OS. */
export type AiToolStatus = 'not-configured' | 'planned' | 'ready' | 'blocked' | 'legacy'

/** Whether the tool exposes an official API we can rely on. */
export type AiToolApiStatus = 'official' | 'unofficial' | 'uncertain' | 'manual'

/** Per-tool risk rating for activation. */
export type AiToolRiskLevel = 'low' | 'medium' | 'high'

/** A single external AI tool connector definition (planned adapter, not active). */
export interface AiToolConnector {
  id: AiToolId
  name: string
  category: AiToolCategory
  status: AiToolStatus
  officialApiStatus: AiToolApiStatus
  purpose: string
  requiredCredentials: string[]
  supportedActions: string[]
  riskLevel: AiToolRiskLevel
  notes: string
}

/** One tool assigned to a project by the orchestration planner. */
export interface AiToolAssignment {
  toolId: AiToolId
  toolName: string
  /** What this tool is responsible for in this specific project. */
  role: string
  status: AiToolStatus
  officialApiStatus: AiToolApiStatus
}

// --- Sprint plan ----------------------------------------------------------

/** A single planned delivery sprint for a build project. */
export interface SprintPlanEntry {
  id: string
  name: string
  goal: string
  deliverables: string[]
}

// --- Project --------------------------------------------------------------

/** A structured, locally-planned app-building project raised by Jarvis. */
export interface UniversalBuildProject {
  id: string
  /** The exact command the CEO typed. */
  originalCommand: string
  projectName: string
  appType: UniversalAppType
  industry: string
  targetUsers: string
  /** Jarvis's local interpretation of the goal (no AI call). */
  interpretedGoal: string
  requiredModules: string[]
  suggestedScreens: string[]
  suggestedDataModels: string[]
  /** External systems/tools the project will likely need to integrate. */
  suggestedIntegrations: string[]
  aiToolPlan: AiToolAssignment[]
  sprintPlan: SprintPlanEntry[]
  riskLevel: UniversalRiskLevel
  approvalRequired: boolean
  status: UniversalBuildStatus
  createdAt: string
  updatedAt: string
  /** Claude Code-ready developer prompt generated for this project. */
  generatedDeveloperPrompt: string
  /** Assumptions surfaced for custom/unknown commands (empty otherwise). */
  assumptions: string[]
  requestedBy: string
  /** PM Planner backlog item id created for this project (null until planned). */
  pmPlanId: string | null
  /** Approval Center item id, once an approval was raised (null otherwise). */
  approvalId: string | null
  /** Human-readable trail of the planning/routing decisions taken. */
  routingLog: string[]
}

/** Kinds of events recorded in the persisted Universal Builder event log. */
export type UniversalBuildLogType =
  | 'captured'
  | 'interpreted'
  | 'planned'
  | 'approval-requested'
  | 'prompt-generated'
  | 'approved'
  | 'rejected'
  | 'status-changed'
  | 'foundation'
  | 'reset'

/** A single, human-readable entry in the persisted Universal Builder log. */
export interface UniversalBuildLogEntry {
  id: string
  type: UniversalBuildLogType
  message: string
  createdAt: string
}

/** The full persisted Universal Builder snapshot. */
export interface UniversalBuilderSnapshot {
  projects: UniversalBuildProject[]
  /** Id of the project currently open in the detail panel (null = none). */
  selectedProjectId: string | null
  /** Newest-first log of meaningful Universal Builder changes. */
  eventLog: UniversalBuildLogEntry[]
}

/** Organization-wide universal-build rollup. */
export interface UniversalBuilderSummary {
  total: number
  captured: number
  planned: number
  needsApproval: number
  approved: number
  promptGenerated: number
  inDevelopment: number
  completed: number
  rejected: number
  /** Projects still awaiting work (captured/interpreted/planned/needs-approval). */
  pending: number
}

/** Fields a caller (Jarvis) supplies to raise a new universal build project. */
export interface NewUniversalBuildInput {
  originalCommand: string
  requestedBy?: string
}
