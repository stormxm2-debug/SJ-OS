import { createChiefOfStaff } from '@shared/chief-of-staff'
import { createKernel, defaultModules } from '@shared/kernel'
import { createCompanyWorkers, type CodingExecutionBackend } from '@shared/providers'
import { IpcCodingBackend } from '@renderer/providers/ipcCodingBackend'

/**
 * Composition root for the running company.
 *
 * Every worker is provider-backed. When the main-process coding bridge is
 * available (Electron), the whole roster runs real `ClaudeCodeProvider`s that
 * generate real files over IPC; otherwise it falls back to marked simulations.
 * Swapping the real backend for a Claude Code SDK/CLI backend is a change here
 * only — the Kernel, Chief of Staff and UI are untouched.
 */
function codingBackend(): CodingExecutionBackend | undefined {
  if (typeof window !== 'undefined' && window.sj?.coding) {
    return new IpcCodingBackend(window.sj.coding)
  }
  return undefined
}

export const kernel = createKernel(defaultModules(), createCompanyWorkers(codingBackend()))

export const chiefOfStaff = createChiefOfStaff(kernel)
