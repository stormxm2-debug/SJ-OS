import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { ClaudeExportRequest, ClaudeExportResult } from '@shared/claudeCode'

/**
 * Claude Code prompt export (main process).
 *
 * Writes a prompt to a safe .md file inside the project's `.sj-os/claude-prompts/`
 * folder. SECURITY:
 *  - The write ROOT is main-controlled (app.getAppPath()), never the
 *    renderer-supplied path, so path traversal is impossible.
 *  - Filenames are sanitized and timestamped; a `.env`-style file is refused.
 *  - No shell command is ever run. No secrets are written. This process only
 *    writes the exact prompt text the renderer passed.
 */

const PROMPTS_SUBDIR = join('.sj-os', 'claude-prompts')

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function dateStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** Keep Korean/alphanumerics; collapse everything else to '-'. */
function sanitizeTitle(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return cleaned || 'prompt'
}

export function exportClaudePrompt(request: ClaudeExportRequest): ClaudeExportResult {
  try {
    const promptText = (request?.promptText ?? '').toString()
    if (!promptText.trim()) {
      return { success: false, errorCode: 'EMPTY_PROMPT', errorMessage: '프롬프트 내용이 비어 있습니다.' }
    }

    const root = app.getAppPath()
    const dir = join(root, PROMPTS_SUBDIR)
    mkdirSync(dir, { recursive: true })

    const fileName = `${dateStamp()}-${sanitizeTitle(request?.title ?? 'prompt')}.md`
    const filePath = join(dir, fileName)

    // Defense-in-depth: the resolved path must stay inside the prompts dir.
    if (!resolve(filePath).startsWith(resolve(dir))) {
      return { success: false, errorCode: 'PATH_ESCAPE', errorMessage: '허용되지 않은 경로입니다.' }
    }
    // Never write a .env file.
    if (basename(filePath).toLowerCase().startsWith('.env')) {
      return { success: false, errorCode: 'ENV_BLOCKED', errorMessage: '.env 파일은 저장할 수 없습니다.' }
    }

    writeFileSync(filePath, promptText, { encoding: 'utf8' })
    return { success: true, filePath, fileName }
  } catch (error) {
    return {
      success: false,
      errorCode: 'WRITE_FAILED',
      errorMessage: error instanceof Error ? error.message : '파일 저장에 실패했습니다.'
    }
  }
}
