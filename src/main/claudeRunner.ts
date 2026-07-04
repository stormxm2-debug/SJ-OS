import { app, shell } from 'electron'
import { join, resolve } from 'node:path'
import type { ClaudeRunRequest, ClaudeRunResult } from '@shared/claudeCode'
import { scanPromptText } from '@shared/claudeCode'

/**
 * Claude Code runner (main process) — approval-gated, validated, and currently
 * NOT enabled to execute.
 *
 * SECURITY / DESIGN:
 *  - The renderer never runs shell commands. Only the main process could, and it
 *    would only do so behind ALL of these gates.
 *  - This module validates every request (approved flag, allowed workspace,
 *    prompt file inside the prompts folder, no dangerous commands). When every
 *    gate passes it still returns `disabled` — actual `child_process` execution
 *    is intentionally deferred to a later, explicitly-approved sprint.
 *  - No arbitrary command from the renderer is ever executed; a future runner
 *    would build a FIXED `npx @anthropic-ai/claude-code` command in main only.
 */

/** Actual Claude Code execution is intentionally OFF for now. */
const RUNNER_ENABLED = false

const PROMPTS_SUBDIR = join('.sj-os', 'claude-prompts')

function promptsDir(): string {
  return resolve(join(app.getAppPath(), PROMPTS_SUBDIR))
}

/** Validate an approved-run request and (safely) refuse to execute for now. */
export function runApprovedJob(request: ClaudeRunRequest): ClaudeRunResult {
  const blockReasons: string[] = []

  if (!request?.approved) blockReasons.push('승인되지 않은 작업입니다.')

  const allowedRoot = resolve(app.getAppPath())
  if (!request?.workspacePath || resolve(request.workspacePath) !== allowedRoot) {
    blockReasons.push('허용된 작업 폴더가 아닙니다.')
  }

  const filePath = request?.promptFilePath ? resolve(request.promptFilePath) : ''
  if (!filePath || !filePath.startsWith(promptsDir())) {
    blockReasons.push('프롬프트 파일이 허용된 폴더(.sj-os/claude-prompts) 안에 있지 않습니다.')
  }

  const scan = scanPromptText(request?.promptText ?? '')
  if (scan.containsDangerousCommand) {
    blockReasons.push(`위험 명령 감지: ${scan.matchedDangerous.join(', ')}`)
  }

  if (blockReasons.length > 0) {
    return {
      started: false,
      blocked: true,
      disabled: false,
      blockReasons,
      message: '위험 명령 또는 민감 정보가 포함되어 실행이 차단되었습니다.'
    }
  }

  if (!RUNNER_ENABLED) {
    return {
      started: false,
      blocked: false,
      disabled: true,
      blockReasons: [],
      message:
        '자동 실행은 다음 안정화 단계에서 활성화됩니다. 지금은 승인 · 명령 생성 · 복사까지 지원합니다.'
    }
  }

  // Future: build a FIXED npx @anthropic-ai/claude-code command in main and
  // child_process.spawn it here, streaming stdout/stderr back to the renderer.
  return {
    started: false,
    blocked: false,
    disabled: true,
    blockReasons: [],
    message: '자동 실행 준비 중입니다.'
  }
}

/** Open the prompts folder in the OS file explorer. Safe (no shell command). */
export async function openPromptsFolder(): Promise<{ ok: boolean; error?: string }> {
  try {
    const dir = promptsDir()
    const error = await shell.openPath(dir)
    return error ? { ok: false, error } : { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'failed to open folder' }
  }
}
