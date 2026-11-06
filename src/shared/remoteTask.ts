// 원격 작업 수신 — 순수 로직(부수효과 없음, 단위테스트 대상).
//
// 목적: 공개 GitHub 저장소의 이슈 댓글 중 "엄격한 지시 포맷"만 작업으로 인식하고,
//   작성자·runner·repo·중복을 검증한다. 실제 실행(러너·git·gh)은 main 측 어댑터가 담당한다.
//
// 보안 원칙:
//  - 이슈/댓글 전체를 명령으로 취급하지 않는다. ```sj-run 블록 + 필수 필드가 있을 때만.
//  - 허용 작성자(allowlist) + 지정 runner id 일치 + repo 일치만 실행 대상.
//  - 작업 본문은 셸로 실행하지 않는다(여기서는 파싱만; 실행은 러너의 stdin 고정 경로).
//  - 공개 게시 텍스트에서 토큰·주민번호 등 민감 패턴을 제거한다.

export interface ParsedDirective {
  taskId: string
  runnerId: string
  branch?: string
  title: string
  body: string
}

export interface DirectiveContext {
  commentAuthor: string
  allowedAuthors: string[]
  runnerId: string
  repo: string // "owner/name"
  expectedRepo: string // "owner/name"
}

export type RejectCode =
  | 'no-directive'
  | 'missing-fields'
  | 'runner-mismatch'
  | 'repo-mismatch'
  | 'author-not-allowed'
  | 'bad-task-id'
  | 'bad-branch'
  | 'empty-body'

export interface ValidationResult {
  ok: boolean
  code?: RejectCode
  reason?: string
}

const TASK_ID_RE = /^[A-Za-z0-9._-]{3,64}$/
// 브랜치: 공백·셸 특수문자 금지(러너의 브랜치 안전 규칙과 일치).
const SAFE_BRANCH_RE = /^[A-Za-z0-9._/-]{1,120}$/

export function isSafeBranchName(name: string): boolean {
  return SAFE_BRANCH_RE.test(name) && !name.includes('..') && !name.startsWith('/') && !name.endsWith('/')
}

export function defaultBranchName(taskId: string): string {
  return `claude/remote-${taskId}`.slice(0, 120)
}

/**
 * 댓글 본문에서 sj-run 지시 블록을 파싱한다. 없으면 null.
 * 포맷:
 *   ```sj-run
 *   task: <id>
 *   runner: <runnerId>
 *   title: <짧은 제목>
 *   branch: <선택>
 *   ---
 *   <작업 범위/완료 기준 본문>
 *   ```
 */
export function parseTaskDirective(commentBody: string): ParsedDirective | null {
  if (!commentBody || typeof commentBody !== 'string') return null
  const m = commentBody.match(/```sj-run[ \t]*\r?\n([\s\S]*?)\r?\n```/)
  if (!m) return null
  const inner = m[1]
  const lines = inner.split(/\r?\n/)
  const header: Record<string, string> = {}
  let sepIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^---/.test(lines[i].trim())) {
      sepIndex = i
      break
    }
    const kv = lines[i].match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/)
    if (kv) header[kv[1].toLowerCase()] = kv[2].trim()
  }
  const body = sepIndex >= 0 ? lines.slice(sepIndex + 1).join('\n').trim() : ''
  const taskId = header.task ?? ''
  const runnerId = header.runner ?? ''
  const title = header.title ?? ''
  const branch = header.branch || undefined
  if (!taskId || !runnerId) return null
  return { taskId, runnerId, title, branch, body }
}

/** 지시의 작성자·runner·repo·형식을 검증한다(중복 검사는 상태 기반으로 별도). */
export function validateDirective(d: ParsedDirective | null, ctx: DirectiveContext): ValidationResult {
  if (!d) return { ok: false, code: 'no-directive', reason: 'sj-run 지시 블록 없음' }
  if (!TASK_ID_RE.test(d.taskId)) return { ok: false, code: 'bad-task-id', reason: 'task id 형식 오류(영숫자._- 3~64자)' }
  if (ctx.repo !== ctx.expectedRepo) return { ok: false, code: 'repo-mismatch', reason: `repo 불일치: ${ctx.repo}` }
  if (!ctx.allowedAuthors.map((a) => a.toLowerCase()).includes((ctx.commentAuthor || '').toLowerCase()))
    return { ok: false, code: 'author-not-allowed', reason: `허용되지 않은 작성자: ${ctx.commentAuthor}` }
  if (d.runnerId !== ctx.runnerId) return { ok: false, code: 'runner-mismatch', reason: `이 PC(runner=${ctx.runnerId}) 대상 아님` }
  if (!d.title) return { ok: false, code: 'missing-fields', reason: 'title 필요' }
  if (!d.body || d.body.length < 4) return { ok: false, code: 'empty-body', reason: '작업 본문 비어 있음' }
  if (d.branch && !isSafeBranchName(d.branch)) return { ok: false, code: 'bad-branch', reason: '브랜치명 안전하지 않음' }
  return { ok: true }
}

// --- 처리 상태(중복·재시작 처리) -------------------------------------------
export type TaskStatus = 'claimed' | 'running' | 'succeeded' | 'failed' | 'rejected'
export interface ProcessedEntry {
  taskId: string
  status: TaskStatus
  updatedAt: string
  branch?: string
  prUrl?: string
  reason?: string
}
export type ProcessedState = Record<string, ProcessedEntry>

/** 이미 '선점/실행/완료'된 작업인가(중복 실행 방지). 실패/거부는 재시도 가능으로 둔다. */
export function isAlreadyHandled(state: ProcessedState, taskId: string): boolean {
  const e = state[taskId]
  if (!e) return false
  return e.status === 'claimed' || e.status === 'running' || e.status === 'succeeded'
}

export function withProcessed(state: ProcessedState, entry: ProcessedEntry): ProcessedState {
  return { ...state, [entry.taskId]: entry }
}

// --- gh/네트워크 오류 분류(오프라인·로그인만료·기타) -------------------------
export type RunnerErrorKind = 'offline' | 'auth-expired' | 'other'

export function classifyGhError(message: string, exitCode?: number): RunnerErrorKind {
  const m = (message || '').toLowerCase()
  if (/could not resolve host|network is unreachable|connection refused|timed out|temporary failure in name resolution|dial tcp|no such host|enotfound|eai_again/.test(m))
    return 'offline'
  if (/gh auth login|authentication|not logged|bad credentials|401|403 .*token|requires authentication|token expired|please run: gh auth/.test(m))
    return 'auth-expired'
  if (exitCode === undefined) return 'other'
  return 'other'
}

// --- 공개 게시 리댁션(민감정보 비게시) --------------------------------------
const SECRET_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI-style keys
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g, // JWT
  /bearer\s+[A-Za-z0-9._-]{12,}/gi,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /\b\d{6}-\d{7}\b/g, // 주민등록번호
  /\b\d{13}\b/g, // 13자리(주민번호 가능) — 보수적으로 마스킹
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
]

/** 공개 이슈/PR 게시 전 민감 패턴 제거 + 길이 제한. */
export function redactForPublic(text: string, maxLen = 4000): string {
  let out = String(text ?? '')
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]')
  if (out.length > maxLen) out = out.slice(0, maxLen) + `\n…(${out.length - maxLen}자 생략)`
  return out
}

// --- 결과 댓글 구성(일관된 task↔branch↔PR 링크) -----------------------------
export interface TaskResult {
  taskId: string
  runnerId: string
  branch: string
  prUrl?: string
  checks: { typecheck?: string; test?: string; build?: string }
  changedFiles: string[]
  incomplete?: string
  note?: string
  ok: boolean
}

export function buildResultComment(r: TaskResult): string {
  const files = r.changedFiles.slice(0, 40).map((f) => `- \`${f}\``).join('\n')
  const more = r.changedFiles.length > 40 ? `\n…외 ${r.changedFiles.length - 40}개` : ''
  const c = r.checks
  return [
    `## ${r.ok ? '✅' : '⚠️'} 원격 작업 결과 · \`${r.taskId}\``,
    '',
    `- runner: \`${r.runnerId}\``,
    `- branch: \`${r.branch}\``,
    r.prUrl ? `- 검토용 PR: ${r.prUrl}` : '- 검토용 PR: (생성 안 됨)',
    '',
    '### 검사',
    `- typecheck: ${c.typecheck ?? '-'}`,
    `- test: ${c.test ?? '-'}`,
    `- build: ${c.build ?? '-'}`,
    '',
    '### 변경 파일',
    files || '(없음)',
    more,
    r.incomplete ? `\n### 미완료\n${redactForPublic(r.incomplete, 1500)}` : '',
    r.note ? `\n> ${redactForPublic(r.note, 800)}` : '',
    '',
    '_자격정보·고객정보·전체 실행 로그는 게시하지 않습니다._'
  ]
    .filter((s) => s !== '')
    .join('\n')
}
