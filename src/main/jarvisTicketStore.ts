import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  CreateJarvisTicketInput,
  JarvisTicket,
  JarvisTicketReview,
  JarvisTicketStatus,
  TicketRejectSource,
  UpdateJarvisTicketInput
} from '@shared/jarvisTickets'

/**
 * 자비스 작업 티켓 파일 저장소 — Electron MAIN 전용.
 *
 * SECURITY:
 *  - 저장 위치는 항상 <project root>/.sj-os/tickets/<TASK-id>.json — 렌더러가
 *    경로를 지정할 수 없다 (taskId는 정규식 검증, 경로는 여기서만 조립).
 *  - 파일 rw만 한다. 셸 명령 실행 없음. 티켓 실행(개발 잡)은 기존
 *    claudeAutoBuild 러너가 자체 안전장치(작업공간 잠금·위험명령 차단)로 처리.
 *  - 입력 문자열은 길이 제한으로 자른다 (프롬프트 폭주 방지).
 */

const TICKETS_SUBDIR = join('.sj-os', 'tickets')
const TASK_ID_RE = /^TASK-\d{3,6}$/
const MAX_TEXT = 4000
const MAX_LIST_ITEMS = 30
const MAX_HISTORY = 100

function ticketsDir(): string {
  return join(resolve(app.getAppPath()), TICKETS_SUBDIR)
}

function ticketPath(taskId: string): string {
  if (!TASK_ID_RE.test(taskId)) throw new Error(`잘못된 티켓 id: ${taskId}`)
  return join(ticketsDir(), `${taskId}.json`)
}

function clip(v: unknown, max = MAX_TEXT): string {
  return String(v ?? '').slice(0, max)
}

function clipList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => clip(x, 500).trim())
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS)
}

const STATUSES: JarvisTicketStatus[] = ['requested', 'developing', 'reviewing', 'approved', 'rejected', 'done']

function readReview(v: unknown): JarvisTicketReview | undefined {
  if (!v || typeof v !== 'object') return undefined
  const r = v as Partial<JarvisTicketReview>
  if (r.verdict !== 'approved' && r.verdict !== 'rejected') return undefined
  return {
    verdict: r.verdict,
    summary: clip(r.summary, 1000),
    criteria: Array.isArray(r.criteria)
      ? r.criteria
          .filter((c): c is { criterion: string; met: boolean; note?: string } => !!c && typeof c === 'object')
          .map((c) => ({ criterion: clip(c.criterion, 500), met: c.met === true, note: c.note ? clip(c.note, 500) : undefined }))
          .filter((c) => c.criterion)
          .slice(0, MAX_LIST_ITEMS)
      : [],
    reviewedAt: clip(r.reviewedAt, 40)
  }
}

function readTicketFile(path: string): JarvisTicket | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<JarvisTicket>
    if (!raw || typeof raw.taskId !== 'string' || !TASK_ID_RE.test(raw.taskId)) return null
    return {
      taskId: raw.taskId,
      from: 'director',
      to: 'developer',
      title: clip(raw.title, 200),
      objective: clip(raw.objective),
      originalCommand: clip(raw.originalCommand),
      inputFiles: clipList(raw.inputFiles),
      acceptanceCriteria: clipList(raw.acceptanceCriteria),
      status: STATUSES.includes(raw.status as JarvisTicketStatus) ? (raw.status as JarvisTicketStatus) : 'requested',
      jobId: typeof raw.jobId === 'string' ? raw.jobId : undefined,
      review: readReview(raw.review),
      attempts: Number.isFinite(Number(raw.attempts)) && Number(raw.attempts) > 0 ? Math.min(Number(raw.attempts), 99) : undefined,
      rejectSource: (['reviewer', 'human', 'dev-fail'] as TicketRejectSource[]).includes(raw.rejectSource as TicketRejectSource)
        ? (raw.rejectSource as TicketRejectSource)
        : undefined,
      history: Array.isArray(raw.history)
        ? raw.history
            .filter((h): h is { at: string; event: string } => !!h && typeof h.at === 'string' && typeof h.event === 'string')
            .slice(-MAX_HISTORY)
        : [],
      createdAt: clip(raw.createdAt, 40),
      updatedAt: clip(raw.updatedAt, 40)
    }
  } catch {
    return null
  }
}

function writeTicketFile(ticket: JarvisTicket): void {
  mkdirSync(ticketsDir(), { recursive: true })
  writeFileSync(ticketPath(ticket.taskId), JSON.stringify(ticket, null, 2), 'utf8')
}

export function listTickets(): JarvisTicket[] {
  const dir = ticketsDir()
  if (!existsSync(dir)) return []
  const items: JarvisTicket[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const t = readTicketFile(join(dir, name))
    if (t) items.push(t)
  }
  // 최신 티켓이 앞으로 (TASK 번호 내림차순)
  return items.sort((a, b) => b.taskId.localeCompare(a.taskId))
}

function nextTaskId(existing: JarvisTicket[]): string {
  let max = 0
  for (const t of existing) {
    const n = Number(t.taskId.replace('TASK-', ''))
    if (Number.isFinite(n) && n > max) max = n
  }
  return `TASK-${String(max + 1).padStart(3, '0')}`
}

export function createTicket(input: CreateJarvisTicketInput): JarvisTicket {
  const now = new Date().toISOString()
  const ticket: JarvisTicket = {
    taskId: nextTaskId(listTickets()),
    from: 'director',
    to: 'developer',
    title: clip(input.title, 200).trim() || '제목 없는 작업',
    objective: clip(input.objective).trim(),
    originalCommand: clip(input.originalCommand).trim(),
    inputFiles: clipList(input.inputFiles),
    acceptanceCriteria: clipList(input.acceptanceCriteria),
    status: 'requested',
    history: [{ at: now, event: '티켓 생성 (디렉터)' }],
    createdAt: now,
    updatedAt: now
  }
  writeTicketFile(ticket)
  return ticket
}

export function updateTicket(taskId: string, patch: UpdateJarvisTicketInput): JarvisTicket | null {
  const path = ticketPath(taskId)
  if (!existsSync(path)) return null
  const cur = readTicketFile(path)
  if (!cur) return null
  const now = new Date().toISOString()
  const status = patch.status && STATUSES.includes(patch.status) ? patch.status : cur.status
  const next: JarvisTicket = {
    ...cur,
    status,
    jobId: patch.jobId !== undefined ? clip(patch.jobId, 100) : cur.jobId,
    review: patch.review !== undefined ? readReview(patch.review) : cur.review,
    attempts:
      patch.attempts !== undefined && Number.isFinite(patch.attempts) && patch.attempts > 0
        ? Math.min(Math.floor(patch.attempts), 99)
        : cur.attempts,
    // 개발로 돌아가면 반려 주체 표시는 지운다 (새 사이클 시작)
    rejectSource:
      status === 'developing'
        ? undefined
        : patch.rejectSource !== undefined
          ? patch.rejectSource
          : cur.rejectSource,
    history: [...cur.history, { at: now, event: clip(patch.event, 300) || '변경' }].slice(-MAX_HISTORY),
    updatedAt: now
  }
  writeTicketFile(next)
  return next
}

export function deleteTicket(taskId: string): boolean {
  const path = ticketPath(taskId)
  if (!existsSync(path)) return false
  unlinkSync(path)
  return true
}

/** IPC 등록 — main/index.ts에서 1회 호출. */
export function registerJarvisTicketIpc(): void {
  ipcMain.handle('sj-tickets:list', () => listTickets())
  ipcMain.handle('sj-tickets:create', (_e, input: CreateJarvisTicketInput) => createTicket(input))
  ipcMain.handle('sj-tickets:update', (_e, taskId: string, patch: UpdateJarvisTicketInput) =>
    updateTicket(taskId, patch)
  )
  ipcMain.handle('sj-tickets:delete', (_e, taskId: string) => deleteTicket(taskId))
}
