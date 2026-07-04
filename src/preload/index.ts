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
import type { ClaudeExportRequest, ClaudeExportResult } from '@shared/claudeCode'

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
      ipcRenderer.invoke('sj-claude:export-prompt', request)
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
