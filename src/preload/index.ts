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
  ClaudeRunnerDiagnostics,
  ClaudeSmokeTestResult,
  CreateAutoBuildJobRequest,
  QueueState
} from '@shared/claudeAutoBuild'

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
    onQueueState: (callback: (state: QueueState) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: QueueState): void => callback(payload)
      ipcRenderer.on('sj-claude-build:queue-state', handler)
      return () => ipcRenderer.removeListener('sj-claude-build:queue-state', handler)
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
