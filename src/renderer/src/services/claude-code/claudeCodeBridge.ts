import type { ClaudeExportRequest, ClaudeExportResult } from '@shared/claudeCode'
import { scanPromptText } from '@shared/claudeCode'
import type { ClaudeCodeSafetyChecks } from './types'

/**
 * Renderer client for the Claude Code Bridge. It NEVER executes shell commands —
 * it only copies prompts to the clipboard and asks the Electron main process to
 * write a prompt to a safe .md file. Actual Claude Code execution is deferred.
 */

/** The single allowed workspace for Claude Code prompt export. */
export const ALLOWED_WORKSPACE = 'C:\\Users\\GalaxyBook5\\.vscode\\SJ-OS'

function bridge(): Window['sj']['claude'] | undefined {
  if (typeof window === 'undefined') return undefined
  return window.sj?.claude
}

/** True when running inside the Electron desktop app (file export available). */
export function isClaudeBridgeAvailable(): boolean {
  return !!bridge()
}

/** Compute the safety assessment for a prompt + workspace. */
export function computeSafetyChecks(promptText: string, workspacePath: string): ClaudeCodeSafetyChecks {
  const scan = scanPromptText(promptText)
  const workspaceAllowed = workspacePath === ALLOWED_WORKSPACE
  return {
    workspaceAllowed,
    containsEnvWarning: scan.containsEnvWarning,
    containsDangerousCommand: scan.containsDangerousCommand,
    requiresApproval: scan.containsDangerousCommand || !workspaceAllowed
  }
}

/** Ask the main process to write the prompt to a safe .md file. Never throws. */
export async function exportClaudePrompt(request: ClaudeExportRequest): Promise<ClaudeExportResult> {
  const api = bridge()
  if (!api) {
    return {
      success: false,
      errorCode: 'BRIDGE_UNAVAILABLE',
      errorMessage: '파일 저장은 데스크톱 앱에서만 가능합니다.'
    }
  }
  try {
    return await api.exportPrompt(request)
  } catch {
    return { success: false, errorCode: 'IPC_FAILED', errorMessage: '파일 저장 호출에 실패했습니다.' }
  }
}

/** Copy prompt text to the clipboard (guarded). Returns true on success. */
export async function copyPromptToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }
  return false
}
