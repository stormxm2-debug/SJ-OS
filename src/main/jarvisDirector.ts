import { ipcMain } from 'electron'
import type { DirectorDraft } from '@shared/jarvisTickets'
import { buildDirectorPrompt, parseDirectorOutput } from '@shared/jarvisTickets'
import { runReadOnlyClaude } from './jarvisReviewer'

/**
 * 자비스 디렉터 AI — 대표 명령을 분석해 작업 티켓 초안을 설계한다.
 *
 *  - 리뷰어와 같은 읽기 전용 러너(기본 권한 모드 `claude -p`) 재사용:
 *    Read/Grep으로 코드 구조를 확인하며 설계할 수 있지만 수정은 불가능.
 *  - 결과는 "초안"일 뿐 — 대표가 티켓 보드에서 확인·수정 후 저장하는 것이
 *    티켓 확정(사람 승인)이다. 파싱 실패 시 렌더러가 규칙 기반 초안으로 폴백.
 */

const DIRECTOR_TIMEOUT_MS = 5 * 60 * 1000
const MAX_COMMAND_CHARS = 4000

export interface DirectorRunResult {
  ok: boolean
  draft: DirectorDraft | null
  error?: string
}

let directorBusy = false

export async function runDirectorDraft(command: string): Promise<DirectorRunResult> {
  const text = String(command ?? '').slice(0, MAX_COMMAND_CHARS).trim()
  if (!text) return { ok: false, draft: null, error: '명령이 비어 있습니다.' }
  if (directorBusy) return { ok: false, draft: null, error: '디렉터가 다른 티켓을 설계 중입니다 — 잠시 후 다시 시도하세요.' }
  directorBusy = true
  try {
    const run = await runReadOnlyClaude(buildDirectorPrompt(text), DIRECTOR_TIMEOUT_MS)
    if (run.error && !run.output) return { ok: false, draft: null, error: run.error }
    const draft = parseDirectorOutput(run.output)
    if (!draft) return { ok: false, draft: null, error: run.error ?? '디렉터 출력에서 티켓 JSON을 찾지 못했습니다.' }
    return { ok: true, draft }
  } finally {
    directorBusy = false
  }
}

/** IPC 등록 — main/index.ts에서 1회 호출. */
export function registerJarvisDirectorIpc(): void {
  ipcMain.handle('sj-tickets:director-draft', (_e, command: string) => runDirectorDraft(command))
}
