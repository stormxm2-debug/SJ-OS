import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  CodingExecEvent,
  CodingExecRequest,
  CodingExecResult
} from '@shared/providers'
import type { CompanyStartupSnapshot } from '@shared/startup'
import type {
  AiGatewayStatus,
  AiTranscribeRequest,
  AiTranscribeResult
} from '@shared/aiGateway'
import type {
  ClaudeExportRequest,
  ClaudeExportResult,
  ClaudeRunRequest,
  ClaudeRunResult
} from '@shared/claudeCode'
import type {
  AutoBuildJobUpdate,
  ClaudeAutoBuildJob,
  ClaudeBuildCompletionReport,
  ClaudeJobCommitState,
  ClaudeRunnerDiagnostics,
  ClaudeSmokeTestResult,
  CreateAutoBuildJobRequest,
  QueueState
} from '@shared/claudeAutoBuild'
import type {
  ParallelBuildJob,
  ParallelJobUpdate,
  ReviewDecision,
  WorktreeCommitResult,
  WorktreeMergeResult,
  WorktreeReview
} from '@shared/claudeParallel'
import type {
  ApplyDeployScriptResult,
  DeploymentRun,
  DeploymentRunUpdate,
  PackageScriptsInfo
} from '@shared/deployment'
import type {
  ElectronPackageRun,
  PackageReadiness,
  PackageRunUpdate
} from '@shared/electronPackage'

/**
 * Secure bridge between the renderer (UI) and the main process (backend).
 *
 * The renderer never gets direct Node, network, or filesystem access — only
 * this typed, explicit surface. It exposes app metadata plus the `coding`
 * channel the Developer worker's provider uses to run real file generation in
 * the main process and receive streamed progress.
 */
const api = {
  app: {
    getInfo: (): Promise<{ name: string; version: string }> =>
      ipcRenderer.invoke('app:getInfo')
  },
  coding: {
    execute: (request: CodingExecRequest): Promise<CodingExecResult> =>
      ipcRenderer.invoke('coding:execute', request),
    onEvent: (callback: (event: CodingExecEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: CodingExecEvent): void =>
        callback(payload)
      ipcRenderer.on('coding:event', handler)
      return () => {
        ipcRenderer.removeListener('coding:event', handler)
      }
    }
  },
  external: {
    /**
     * Open an APPROVED external link by key (e.g. 'youtube'). The main process
     * validates the key against its whitelist — raw URLs are never accepted.
     */
    open: (key: string): Promise<{ ok: boolean; key?: string; url?: string; error?: string }> =>
      ipcRenderer.invoke('external:open', key)
  },
  ai: {
    /**
     * Electron Main AI Gateway status (Jarvis desktop mode). Returns only
     * sanitized readiness flags — never the OpenAI API key. This is the default
     * local AI transport: no separate proxy server, no localhost:8787.
     */
    getStatus: (): Promise<AiGatewayStatus> => ipcRenderer.invoke('sj-ai:status'),
    /**
     * Transcribe recorded audio via the main process (OpenAI). Audio bytes are
     * sent over IPC, transcribed in main, and only the transcript text comes
     * back. The API key never crosses this bridge in either direction.
     */
    transcribeAudio: (request: AiTranscribeRequest): Promise<AiTranscribeResult> =>
      ipcRenderer.invoke('sj-ai:transcribe', request)
  },
  claude: {
    /**
     * Export a Claude Code prompt to a safe .md file inside the project's
     * `.sj-os/claude-prompts/` folder. The main process controls the write path
     * (never renderer-supplied), refuses to write .env/secrets, and never runs
     * any shell command. Returns the written file path only.
     */
    exportPrompt: (request: ClaudeExportRequest): Promise<ClaudeExportResult> =>
      ipcRenderer.invoke('sj-claude:export-prompt', request),
    /**
     * Run an APPROVED Claude Code job. The main process validates approval,
     * workspace, prompt-file location, and dangerous commands. Actual execution
     * is currently disabled (returns a disabled result) — no shell command runs.
     */
    runApprovedJob: (request: ClaudeRunRequest): Promise<ClaudeRunResult> =>
      ipcRenderer.invoke('sj-claude:run-approved', request),
    /** Open the exported-prompts folder in the OS file explorer. */
    openPromptsFolder: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('sj-claude:open-prompts-folder')
  },
  claudeBuild: {
    /**
     * Jarvis → Claude Code Auto Builder. The renderer sends a validated prompt +
     * job id only — never a shell command. The main process spawns Claude Code,
     * streams logs, and runs fixed verification commands.
     */
    createJob: (request: CreateAutoBuildJobRequest): Promise<ClaudeAutoBuildJob> =>
      ipcRenderer.invoke('sj-claude-build:create', request),
    runJob: (id: string): Promise<ClaudeAutoBuildJob | null> =>
      ipcRenderer.invoke('sj-claude-build:run', id),
    cancelJob: (id: string): Promise<ClaudeAutoBuildJob | null> =>
      ipcRenderer.invoke('sj-claude-build:cancel', id),
    getJob: (id: string): Promise<ClaudeAutoBuildJob | null> =>
      ipcRenderer.invoke('sj-claude-build:get', id),
    listJobs: (): Promise<ClaudeAutoBuildJob[]> => ipcRenderer.invoke('sj-claude-build:list'),
    /** Run fixed environment checks (node/npm/npx/claude) — main process only. */
    checkRunnerEnvironment: (): Promise<ClaudeRunnerDiagnostics> =>
      ipcRenderer.invoke('sj-claude-build:check-env'),
    /** Harmless smoke test (fixed prompt, no file changes). */
    smokeTest: (): Promise<ClaudeSmokeTestResult> => ipcRenderer.invoke('sj-claude-build:smoke-test'),
    onJobUpdate: (callback: (update: AutoBuildJobUpdate) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: AutoBuildJobUpdate): void => callback(payload)
      ipcRenderer.on('sj-claude-build:job-update', handler)
      return () => ipcRenderer.removeListener('sj-claude-build:job-update', handler)
    },
    // --- queue (single writer; main serializes) ---
    getQueueState: (): Promise<QueueState> => ipcRenderer.invoke('sj-claude-build:queue-state'),
    setQueueAutoRun: (on: boolean): Promise<QueueState> =>
      ipcRenderer.invoke('sj-claude-build:queue-auto-run', on),
    pauseQueue: (): Promise<QueueState> => ipcRenderer.invoke('sj-claude-build:queue-pause'),
    resumeQueue: (): Promise<QueueState> => ipcRenderer.invoke('sj-claude-build:queue-resume'),
    runNextQueued: (): Promise<ClaudeAutoBuildJob | null> =>
      ipcRenderer.invoke('sj-claude-build:queue-next'),
    cancelQueuedJob: (id: string): Promise<ClaudeAutoBuildJob | null> =>
      ipcRenderer.invoke('sj-claude-build:queue-cancel', id),
    /** Approve a generated auto-repair job so it can be run (never auto-runs). */
    approveRepairJob: (id: string): Promise<ClaudeAutoBuildJob | null> =>
      ipcRenderer.invoke('sj-claude-build:approve-repair', id),
    /** Read-only commit/push state (changed files + eligibility) for a job. */
    loadJobCommitState: (id: string): Promise<ClaudeJobCommitState> =>
      ipcRenderer.invoke('sj-claude-build:commit-state', id),
    /** Commit the job's changes (explicit; safe staging; no `git add .`). */
    commitApprovedJob: (id: string): Promise<ClaudeJobCommitState> =>
      ipcRenderer.invoke('sj-claude-build:commit', id),
    /** Push the committed job to origin/<currentBranch> (explicit; never force). */
    pushApprovedCommit: (id: string): Promise<ClaudeJobCommitState> =>
      ipcRenderer.invoke('sj-claude-build:push', id),
    /** Generate a human-readable completion report (read-only git inspection). */
    generateCompletionReport: (id: string): Promise<ClaudeBuildCompletionReport | null> =>
      ipcRenderer.invoke('sj-claude-build:completion-report', id),
    onQueueState: (callback: (state: QueueState) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: QueueState): void => callback(payload)
      ipcRenderer.on('sj-claude-build:queue-state', handler)
      return () => ipcRenderer.removeListener('sj-claude-build:queue-state', handler)
    }
  },
  claudeParallel: {
    /**
     * Worktree-based parallel builder (foundation). The renderer sends only a
     * source job id; the main process prepares an isolated git worktree/branch
     * and runs Claude Code inside it. No auto-merge, no shell from the renderer.
     */
    prepareWorktree: (sourceJobId: string): Promise<ParallelBuildJob | null> =>
      ipcRenderer.invoke('sj-claude-parallel:prepare', sourceJobId),
    runWorktreeJob: (sourceJobId: string): Promise<ParallelBuildJob | null> =>
      ipcRenderer.invoke('sj-claude-parallel:run', sourceJobId),
    getJob: (sourceJobId: string): Promise<ParallelBuildJob | null> =>
      ipcRenderer.invoke('sj-claude-parallel:get', sourceJobId),
    listJobs: (): Promise<ParallelBuildJob[]> => ipcRenderer.invoke('sj-claude-parallel:list'),
    /** Read-only worktree change review (fixed git inspection; NO merge). */
    loadWorktreeReview: (sourceJobId: string): Promise<WorktreeReview> =>
      ipcRenderer.invoke('sj-claude-parallel:review', sourceJobId),
    markReviewDecision: (
      sourceJobId: string,
      decision: ReviewDecision,
      notes?: string
    ): Promise<ParallelBuildJob | null> =>
      ipcRenderer.invoke('sj-claude-parallel:review-decision', { sourceJobId, decision, notes }),
    /** Commit a worktree's changes on its branch (explicit; safe staging; no push). */
    commitWorktreeJob: (sourceJobId: string): Promise<WorktreeCommitResult> =>
      ipcRenderer.invoke('sj-claude-parallel:commit', sourceJobId),
    /** Merge an APPROVED worktree into main (explicit; validated; no push). */
    mergeApprovedWorktree: (sourceJobId: string): Promise<WorktreeMergeResult> =>
      ipcRenderer.invoke('sj-claude-parallel:merge', sourceJobId),
    onJobUpdate: (callback: (update: ParallelJobUpdate) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: ParallelJobUpdate): void => callback(payload)
      ipcRenderer.on('sj-claude-parallel:job-update', handler)
      return () => ipcRenderer.removeListener('sj-claude-parallel:job-update', handler)
    }
  },
  deploy: {
    /**
     * Approved deployment runner. The renderer sends only a release item id; the
     * main process runs preflight + the fixed `npm run deploy` (if package.json
     * defines it). No arbitrary command, no shell, no auto-deploy.
     */
    scriptExists: (): Promise<boolean> => ipcRenderer.invoke('sj-deploy:script-exists'),
    preflight: (releaseItemId: string): Promise<DeploymentRun> =>
      ipcRenderer.invoke('sj-deploy:preflight', releaseItemId),
    runApproved: (releaseItemId: string): Promise<DeploymentRun> =>
      ipcRenderer.invoke('sj-deploy:run', releaseItemId),
    cancel: (releaseItemId: string): Promise<DeploymentRun | null> =>
      ipcRenderer.invoke('sj-deploy:cancel', releaseItemId),
    get: (releaseItemId: string): Promise<DeploymentRun | null> =>
      ipcRenderer.invoke('sj-deploy:get', releaseItemId),
    onRunUpdate: (callback: (update: DeploymentRunUpdate) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: DeploymentRunUpdate): void => callback(payload)
      ipcRenderer.on('sj-deploy:run-update', handler)
      return () => ipcRenderer.removeListener('sj-deploy:run-update', handler)
    },
    /** Read-only inspection of package.json deploy/build/typecheck scripts. */
    inspectPackageScripts: (): Promise<PackageScriptsInfo> =>
      ipcRenderer.invoke('sj-deploy:inspect-scripts'),
    /** Apply a validated deploy script to package.json (approved write; never runs it). */
    applyDeployScript: (script: string): Promise<ApplyDeployScriptResult> =>
      ipcRenderer.invoke('sj-deploy:apply-script', script)
  },
  electronPackage: {
    /**
     * Electron installer package center. The renderer sends only a run id; main
     * inspects package.json and runs an EXISTING package script (dist/package/
     * make/electron:build) after approval + preflight. No publish, no upload, no
     * dependency install, no shell from the renderer.
     */
    inspectReadiness: (): Promise<PackageReadiness> => ipcRenderer.invoke('sj-package:inspect'),
    preflight: (id: string): Promise<ElectronPackageRun> => ipcRenderer.invoke('sj-package:preflight', id),
    runApproved: (id: string): Promise<ElectronPackageRun> => ipcRenderer.invoke('sj-package:run', id),
    cancel: (id: string): Promise<ElectronPackageRun | null> => ipcRenderer.invoke('sj-package:cancel', id),
    get: (id: string): Promise<ElectronPackageRun | null> => ipcRenderer.invoke('sj-package:get', id),
    onRunUpdate: (callback: (update: PackageRunUpdate) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: PackageRunUpdate): void => callback(payload)
      ipcRenderer.on('sj-package:run-update', handler)
      return () => ipcRenderer.removeListener('sj-package:run-update', handler)
    }
  },
  companyStartup: {
    start: (): Promise<CompanyStartupSnapshot> =>
      ipcRenderer.invoke('company:start'),
    onStateChange: (callback: (snapshot: CompanyStartupSnapshot) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: CompanyStartupSnapshot): void =>
        callback(payload)
      ipcRenderer.on('company:startup:state', handler)
      return () => {
        ipcRenderer.removeListener('company:startup:state', handler)
      }
    }
  }
}

// Context isolation is always enabled (see main process webPreferences),
// so the bridge is the only channel exposed to the renderer.
contextBridge.exposeInMainWorld('sj', api)

export type SjApi = typeof api
