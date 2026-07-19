import { app, ipcMain } from 'electron'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { JarvisReviewEvidence, JarvisTicket } from '@shared/jarvisTickets'
import { buildReviewerPromptFromTicket, parseReviewOutput } from '@shared/jarvisTickets'
import { getAutoBuildJob, spawnTool } from './claudeAutoBuild'
import { listTickets, updateTicket } from './jarvisTicketStore'

/**
 * 자비스 리뷰어 AI — 생성자(개발자 잡)와 분리된 독립 검증자. Electron MAIN 전용.
 *
 * SECURITY / 격리:
 *  - 리뷰어는 `claude -p`를 **기본 권한 모드**로 실행한다. 헤드리스에는 승인자가
 *    없으므로 Read/Grep 같은 읽기 도구만 동작하고 Edit/Write/Bash는 실행될 수
 *    없다 — 검증자가 코드를 고치는 것이 구조적으로 불가능하다.
 *  - 증거(git diff·status)는 여기서 고정 명령으로만 수집한다. 렌더러 입력이
 *    명령에 섞이지 않는다 (taskId만 받고, 검증은 ticketStore가 한다).
 *  - 타임아웃(8분) 초과 시 프로세스 트리만 종료. 동시 리뷰 1건 (busy 락).
 */

const REVIEW_TIMEOUT_MS = 8 * 60 * 1000
const MAX_DIFF_CHARS = 50_000
const MAX_OUTPUT_CHARS = 200_000

function allowedRoot(): string {
  return resolve(app.getAppPath())
}

/** 고정 git 명령으로 증거 수집 (읽기 전용). */
function gitRead(args: string[]): string {
  try {
    const res = spawnSync('git', args, {
      cwd: allowedRoot(),
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024
    })
    return (res.stdout ?? '').trim()
  } catch {
    return ''
  }
}

function collectEvidence(ticket: JarvisTicket): JarvisReviewEvidence {
  const job = ticket.jobId ? getAutoBuildJob(ticket.jobId) : null
  const diffFull = gitRead(['diff', 'HEAD'])
  const diffTruncated = diffFull.length > MAX_DIFF_CHARS
  return {
    typecheck: job?.verification.typecheckStatus ?? 'unknown',
    build: job?.verification.buildStatus ?? 'unknown',
    gitStatusShort: gitRead(['status', '--short']).slice(0, 4000),
    diffStat: gitRead(['diff', 'HEAD', '--stat']).slice(0, 4000),
    diff: diffTruncated ? diffFull.slice(0, MAX_DIFF_CHARS) : diffFull,
    diffTruncated
  }
}

/**
 * 읽기 전용 Claude 실행 — 기본 권한 모드(-p만, bypassPermissions 없음).
 * 리뷰어·디렉터가 공용으로 사용: Read/Grep만 동작, 수정·Bash는 구조적 불가.
 */
export function runReadOnlyClaude(
  prompt: string,
  timeoutMs: number = REVIEW_TIMEOUT_MS
): Promise<{ output: string; error?: string; timedOut: boolean }> {
  return new Promise((resolveP) => {
    let out = ''
    let err = ''
    let done = false
    let timedOut = false
    let child: ReturnType<typeof spawnTool>
    try {
      child = spawnTool('claude', ['-p'], { cwd: allowedRoot(), windowsHide: true })
    } catch {
      resolveP({ output: '', error: 'claude 실행 파일을 시작하지 못했습니다 (러너 진단 확인).', timedOut: false })
      return
    }
    const finish = (res: { output: string; error?: string; timedOut: boolean }): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolveP(res)
    }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (process.platform === 'win32' && child.pid) {
          // Windows: cmd 래퍼 아래 실제 프로세스까지 트리 전체 종료 (우리가 띄운 것만).
          spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true })
        } else {
          child.kill()
        }
      } catch {
        /* already gone */
      }
    }, timeoutMs)
    try {
      child.stdin?.write(prompt)
      child.stdin?.end()
    } catch {
      /* stdin may be closed on immediate failure */
    }
    child.stdout?.on('data', (d: Buffer) => {
      if (out.length < MAX_OUTPUT_CHARS) out += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      if (err.length < 8000) err += d.toString()
    })
    child.on('error', (e) => finish({ output: out, error: e.message, timedOut }))
    child.on('close', (code) =>
      finish({
        output: out,
        error: timedOut
          ? `실행 시간(${Math.round(timeoutMs / 60000)}분)이 초과되었습니다.`
          : code !== 0
            ? `리뷰어 종료 코드 ${code}${err ? ` — ${err.slice(0, 300)}` : ''}`
            : undefined,
        timedOut
      })
    )
  })
}

export interface ReviewRunResult {
  ok: boolean
  ticket: JarvisTicket | null
  error?: string
}

let reviewBusy = false

export async function runTicketReview(taskId: string): Promise<ReviewRunResult> {
  if (reviewBusy) return { ok: false, ticket: null, error: '다른 티켓을 검토 중입니다 — 잠시 후 다시 시도하세요.' }
  const ticket = listTickets().find((t) => t.taskId === taskId)
  if (!ticket) return { ok: false, ticket: null, error: '티켓을 찾을 수 없습니다.' }
  reviewBusy = true
  try {
    const evidence = collectEvidence(ticket)
    const prompt = buildReviewerPromptFromTicket(ticket, evidence)
    const run = await runReadOnlyClaude(prompt)
    if (run.error && !run.output) {
      const t = updateTicket(taskId, { event: `리뷰어 실행 실패: ${run.error}` })
      return { ok: false, ticket: t, error: run.error }
    }
    const review = parseReviewOutput(run.output)
    if (!review) {
      const msg = run.error ?? '리뷰어 출력에서 판정 JSON을 찾지 못했습니다.'
      const t = updateTicket(taskId, { event: `리뷰어 판정 실패: ${msg.slice(0, 200)}` })
      return { ok: false, ticket: t, error: msg }
    }
    const metCount = review.criteria.filter((c) => c.met).length
    const t = updateTicket(taskId, {
      status: review.verdict,
      review,
      ...(review.verdict === 'rejected' ? { rejectSource: 'reviewer' as const } : {}),
      event: `리뷰어 AI 판정: ${review.verdict === 'approved' ? '승인' : '반려'} (기준 ${metCount}/${review.criteria.length} 충족)`
    })
    return { ok: true, ticket: t }
  } finally {
    reviewBusy = false
  }
}

/** IPC 등록 — main/index.ts에서 1회 호출. */
export function registerJarvisReviewerIpc(): void {
  ipcMain.handle('sj-tickets:review-run', (_e, taskId: string) => runTicketReview(String(taskId ?? '')))
}
