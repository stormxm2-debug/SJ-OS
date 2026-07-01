import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  CodingExecEvent,
  CodingExecRequest,
  CodingExecResult
} from '@shared/providers'
import type { CompanyStartupSnapshot } from '@shared/startup'

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
