// 다중 저장소 원격 작업 — 순수 로직(electron/node I/O 없음, 단위테스트 대상).
//
// 목적: 기존 SJ-OS 원격 러너(이슈 #76, workspace=app 경로 고정)는 그대로 두고, **명시적 허용 목록에
//   있는 별도 저장소**(1단계: SJ AI MARKETING)만 별도 작업 폴더·상태·브랜치·PR 대상으로 수신한다.
//
// 보안 원칙:
//  - repo / issue / 허용 작성자 / 브랜치 접두사 / PR base 는 **코드 상수(허용 목록)** 에서만 온다.
//    사용자 설정은 작업 폴더·runnerId·폴링 주기만 바꿀 수 있다(임의 저장소 실행 불가).
//  - 작업 폴더는 SJ-OS 원본과 완전히 분리(같거나·안쪽·상위 금지), realpath 일치(심볼릭 링크/정션 금지),
//    git 최상위 = 작업 폴더, origin = 허용 repo 여야 한다. 실행·push 직전에 매번 재검증한다.
//  - 작업 본문은 셸로 실행하지 않는다(러너의 고정 CLI 경로로만 전달). git/gh 는 고정 인자만 사용.
//  - 미커밋 변경·기존 브랜치는 삭제/덮어쓰기하지 않는다(보존 또는 거부).

import type { RemoteDeps, RemoteRunnerConfig, ListResult, RunTaskResult } from './remoteTaskPoll'
import type { ProcessedState } from './remoteTask'
import { classifyGhError } from './remoteTask'

// --- 허용 목록(코드 상수) ----------------------------------------------------
export interface RemoteProjectSpec {
  id: string // 파일명·IPC 키(영숫자-)
  label: string
  repo: string // "owner/name"
  issueNumber: number
  allowedAuthors: readonly string[]
  branchPrefix: string // 작업 브랜치는 반드시 이 접두사
  baseBranch: string // PR base / 작업 기준
}

export const REMOTE_PROJECT_ALLOWLIST: readonly RemoteProjectSpec[] = Object.freeze([
  Object.freeze({
    id: 'marketing',
    label: 'SJ AI MARKETING',
    repo: 'stormxm2-debug/sj-ai-marketing',
    issueNumber: 3,
    allowedAuthors: Object.freeze(['stormxm2-debug']),
    branchPrefix: 'claude/remote-marketing-',
    baseBranch: 'main'
  })
])

export function findProjectSpec(id: string): RemoteProjectSpec | undefined {
  return REMOTE_PROJECT_ALLOWLIST.find((p) => p.id === id)
}

/** 사용자(노트북)별 설정 — 작업 폴더·runnerId·주기만. repo/issue/작성자는 허용 목록이 결정. */
export interface RemoteProjectUserConfig {
  /** 명시적 시작(start)으로만 true 가 된다. set-config 로는 바뀌지 않는다. */
  enabled: boolean
  workspace: string
  runnerId: string
  pollSeconds: number
  /** 마지막으로 모든 연결 검사를 통과한 시각/작업 폴더(realpath). 표시용. */
  verifiedAt?: string
  verifiedWorkspace?: string
}

export const DEFAULT_PROJECT_USER_CONFIG: RemoteProjectUserConfig = {
  enabled: false,
  workspace: '',
  runnerId: '',
  pollSeconds: 60
}

/** 사용자 설정 패치에서 허용 필드만 남긴다(enabled/repo/issue/allowedAuthors 등은 무시). */
export function sanitizeUserPatch(patch: unknown): Partial<RemoteProjectUserConfig> {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
  const out: Partial<RemoteProjectUserConfig> = {}
  if (typeof p.workspace === 'string') out.workspace = p.workspace.trim().slice(0, 400)
  if (typeof p.runnerId === 'string') out.runnerId = p.runnerId.trim().slice(0, 64)
  if (typeof p.pollSeconds === 'number' && Number.isFinite(p.pollSeconds)) out.pollSeconds = Math.min(3600, Math.max(15, Math.round(p.pollSeconds)))
  return out
}

/** pollOnce 에 넘길 러너 설정 — repo/issue/작성자/브랜치 규칙은 허용 목록에서만 온다. */
export function projectRunnerConfig(spec: RemoteProjectSpec, user: RemoteProjectUserConfig): RemoteRunnerConfig {
  return {
    enabled: user.enabled,
    repo: spec.repo,
    issueNumber: spec.issueNumber,
    allowedAuthors: [...spec.allowedAuthors],
    runnerId: user.runnerId,
    pollSeconds: Math.max(15, user.pollSeconds || 60),
    branchPrefix: spec.branchPrefix,
    requireRepoHeader: true
  }
}

/** 프로젝트별 처리 상태 파일 — SJ-OS 기본(remote-task-state.json)과 분리. */
export function projectStateFileName(spec: RemoteProjectSpec): string {
  return `remote-task-state.${spec.id}.json`
}

// --- 경로/원격 검증 ----------------------------------------------------------
/** 경로 비교용 정규화(구분자 통일·후행 / 제거·Windows 는 소문자). */
export function normPath(p: string, win: boolean): string {
  let s = String(p ?? '').replace(/\\/g, '/')
  while (s.length > 1 && s.endsWith('/') && !/^[A-Za-z]:\/$/.test(s)) s = s.slice(0, -1)
  return win ? s.toLowerCase() : s
}

/** a 가 b 와 같거나 b 안쪽인가. */
export function isSameOrInside(a: string, b: string, win: boolean): boolean {
  const na = normPath(a, win)
  const nb = normPath(b, win)
  if (!na || !nb) return false
  if (na === nb) return true
  const base = nb.endsWith('/') ? nb : nb + '/'
  return na.startsWith(base)
}

/** git remote URL → "owner/name"(github.com 만). 인식 불가면 null. */
export function repoSlugFromRemote(url: string): string | null {
  const u = String(url ?? '').trim()
  const m =
    u.match(/^https:\/\/(?:[^@/]+@)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/) ??
    u.match(/^(?:ssh:\/\/)?git@github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/)
  if (!m) return null
  return `${m[1]}/${m[2]}`
}

/** main 이 실제 파일시스템/git 에서 수집한 사실(검증은 여기서 순수하게). */
export interface WorkspaceFacts {
  input: string // 설정값 그대로
  isAbsolute: boolean
  resolved: string // path.resolve(input)
  exists: boolean
  isDirectory: boolean
  realpath: string // fs.realpathSync.native(resolved) — 실패 시 ''
  hasLinkSegment: boolean // 경로상 어떤 구성요소든 심볼릭 링크/정션이면 true
  gitToplevel: string // realpath(git rev-parse --show-toplevel) — 실패 시 ''
  originUrl: string // git remote get-url origin — 실패 시 ''
  currentBranch: string // git branch --show-current
}

export type WorkspaceRejectCode =
  | 'not-configured'
  | 'not-absolute'
  | 'parent-segment'
  | 'missing'
  | 'not-directory'
  | 'symlink'
  | 'protected-overlap'
  | 'not-git-root'
  | 'origin-mismatch'
  | 'checkout-not-allowed'

export interface WorkspaceCheck {
  ok: boolean
  code?: WorkspaceRejectCode
  reason?: string
  realpath?: string
}

/** 허용 checkout: 기준 브랜치(main) 또는 이 프로젝트 접두사 브랜치만. detached/다른 브랜치 거부. */
export function isCheckoutAllowed(spec: RemoteProjectSpec, branch: string): boolean {
  return branch === spec.baseBranch || (branch.startsWith(spec.branchPrefix) && branch.length > spec.branchPrefix.length)
}

/**
 * 작업 폴더 검증. protectedRoots: SJ-OS 앱 경로·SJ-OS 원본·사용자 홈 등 — 작업 폴더는
 * 이들과 같거나, 안쪽이거나, 상위여서는 안 된다. otherProjectRoots: 다른 프로젝트 작업 폴더.
 */
export function validateProjectWorkspace(
  spec: RemoteProjectSpec,
  f: WorkspaceFacts,
  protectedRoots: string[],
  win: boolean,
  otherProjectRoots: string[] = []
): WorkspaceCheck {
  if (!f.input || !f.input.trim()) return { ok: false, code: 'not-configured', reason: '작업 폴더 미설정' }
  if (!f.isAbsolute) return { ok: false, code: 'not-absolute', reason: '작업 폴더는 절대 경로여야 합니다' }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(f.input)) return { ok: false, code: 'parent-segment', reason: '경로에 .. 사용 금지' }
  if (!f.exists) return { ok: false, code: 'missing', reason: '작업 폴더가 없습니다(먼저 clone 필요)' }
  if (!f.isDirectory) return { ok: false, code: 'not-directory', reason: '작업 폴더가 디렉터리가 아닙니다' }
  if (f.hasLinkSegment || !f.realpath || normPath(f.realpath, win) !== normPath(f.resolved, win))
    return { ok: false, code: 'symlink', reason: '심볼릭 링크/정션 또는 경로 바꿔치기 감지(realpath 불일치)' }
  for (const root of [...protectedRoots, ...otherProjectRoots].filter(Boolean)) {
    if (isSameOrInside(f.realpath, root, win) || isSameOrInside(root, f.realpath, win))
      return { ok: false, code: 'protected-overlap', reason: 'SJ-OS 원본/다른 프로젝트/상위 폴더와 겹치는 경로는 사용할 수 없습니다' }
  }
  if (!f.gitToplevel || normPath(f.gitToplevel, win) !== normPath(f.realpath, win))
    return { ok: false, code: 'not-git-root', reason: '작업 폴더가 git 저장소 최상위(clone 루트)가 아닙니다' }
  const slug = repoSlugFromRemote(f.originUrl)
  if (!slug || slug.toLowerCase() !== spec.repo.toLowerCase())
    return { ok: false, code: 'origin-mismatch', reason: `origin 이 ${spec.repo} 가 아닙니다` }
  if (!isCheckoutAllowed(spec, f.currentBranch))
    return { ok: false, code: 'checkout-not-allowed', reason: `허용되지 않은 checkout(${f.currentBranch || 'detached'}) — ${spec.baseBranch} 또는 ${spec.branchPrefix}* 만` }
  return { ok: true, realpath: f.realpath }
}

// --- 연결 상태(미연결/준비됨) -------------------------------------------------
export type ConnectionState = 'not-configured' | 'unverified' | 'blocked' | 'offline' | 'auth-expired' | 'ready'

export interface ReadinessInput {
  user: RemoteProjectUserConfig
  workspace?: WorkspaceCheck
  ghAuth?: { ok: boolean; errorKind?: 'offline' | 'auth-expired' | 'other' }
  repoAccess?: { ok: boolean; errorKind?: 'offline' | 'auth-expired' | 'other' }
  claude?: { ok: boolean }
}
export interface Readiness {
  state: ConnectionState
  label: string
  problems: string[]
}

/** 모든 검사를 통과해야만 'ready'. 하나라도 없거나 실패면 미연결(미완료)로 표시한다. */
export function evaluateReadiness(r: ReadinessInput): Readiness {
  const problems: string[] = []
  if (!r.user.workspace) problems.push('작업 폴더 미설정')
  if (!r.user.runnerId) problems.push('runner id 미설정')
  if (problems.length) return { state: 'not-configured', label: '미연결 · 설정 필요', problems }
  if (!r.workspace || !r.ghAuth || !r.repoAccess || !r.claude) return { state: 'unverified', label: '미연결 · 연결 검사 전', problems: ['연결 검사를 실행하지 않음'] }
  if (!r.workspace.ok) problems.push(`작업 폴더: ${r.workspace.reason ?? r.workspace.code}`)
  const net = [r.ghAuth, r.repoAccess].find((x) => !x.ok && x.errorKind === 'offline')
  const auth = [r.ghAuth, r.repoAccess].find((x) => !x.ok && x.errorKind === 'auth-expired')
  if (!r.ghAuth.ok) problems.push('gh 로그인 확인 실패')
  if (!r.repoAccess.ok) problems.push('비공개 저장소 접근 확인 실패')
  if (!r.claude.ok) problems.push('Claude Code CLI 확인 실패')
  if (net) return { state: 'offline', label: '미연결 · 오프라인', problems }
  if (auth) return { state: 'auth-expired', label: '미연결 · gh 로그인 필요', problems }
  if (problems.length) return { state: 'blocked', label: '미연결 · 검사 실패', problems }
  return { state: 'ready', label: '연결 검사 통과', problems: [] }
}

/** 렌더러 표시용 프로젝트 상태(비밀 없음). */
export interface RemoteProjectStatus {
  id: string
  label: string
  repo: string
  issueNumber: number
  branchPrefix: string
  workspace: string
  runnerId: string
  pollSeconds: number
  enabled: boolean
  active: boolean
  connection: string // 미연결/연결 검사 통과 등(사람이 읽는 라벨)
  connectionState: string
  problems: string[]
  verifiedAt?: string
  lastActions: string[]
}

// --- 러너 간 실행 잠금(동시 실행/동시 쓰기 경합 방지) ---------------------------
export interface RunLock {
  tryAcquire(owner: string): boolean
  release(owner: string): void
  holder(): string | null
}
/** 프로세스 내 단일 잠금 — SJ-OS 러너와 프로젝트 러너가 같은 시점에 하나만 폴링/실행한다. */
export function createRunLock(): RunLock {
  let owner: string | null = null
  return {
    tryAcquire(o) {
      if (owner !== null) return false
      owner = o
      return true
    },
    release(o) {
      if (owner === o) owner = null
    },
    holder: () => owner
  }
}

// --- 프로젝트 러너 deps(고정 CLI, exec 주입 → mock CLI 로 테스트) ---------------
export interface ExecResult {
  code: number
  out: string
  err: string
}
export type ExecFn = (tool: 'git' | 'gh', args: string[], cwd: string) => Promise<ExecResult>
export interface ProjectJobResult {
  status: string // 실행기 최종 상태(succeeded/failed/timed-out/needs-review/blocked/...)
  typecheck?: string
  build?: string
  errorSummary?: string
}
export interface ProjectDepsInput {
  spec: RemoteProjectSpec
  workspace: string // 검증된 realpath
  exec: ExecFn
  /** 실행 직전·push 직전 재검증(경로 바꿔치기/origin 변경 방지). */
  verifyWorkspace(): Promise<WorkspaceCheck>
  /** 기존 실행기(고정 Claude CLI 경로)로 1건 실행. 본문은 stdin 으로만 전달된다. */
  runJob(input: { title: string; prompt: string; workspace: string }): Promise<ProjectJobResult>
  saveState(state: ProcessedState): void
  now(): string
}

/** 실행기에 넘기는 고정 안전 머리말 + 작업 본문(본문은 셸로 실행되지 않음). */
export function buildProjectPrompt(spec: RemoteProjectSpec, workspace: string, body: string): string {
  return [
    `# 원격 작업 (${spec.label} · ${spec.repo})`,
    '',
    `작업 폴더: ${workspace}`,
    '',
    '규칙(반드시 지킬 것):',
    '- 이 작업 폴더 안의 파일만 수정한다. 다른 저장소·상위 폴더·SJ-OS 폴더는 건드리지 않는다.',
    '- 커밋·푸시·PR 생성·병합은 하지 않는다(러너가 검토용 PR 만 만든다).',
    '- 배포, 운영 DB/고객 계정 조작, 비밀키·고객 자료 출력/커밋을 하지 않는다.',
    '- 미커밋 변경을 삭제하거나 브랜치를 리셋하지 않는다.',
    '',
    '## 작업 내용',
    body
  ].join('\n')
}

function porcelainFiles(out: string): string[] {
  return out
    .split(/\r?\n/)
    .map((l) => l.slice(3).trim())
    .filter(Boolean)
    .map((f) => (f.includes(' -> ') ? f.split(' -> ').pop()!.trim() : f))
    .map((f) => f.replace(/^"|"$/g, ''))
}

/** 커밋 금지 경로(비밀/환경 파일). 하나라도 있으면 커밋하지 않고 실패 처리. */
export function isBlockedCommitPath(p: string): boolean {
  const n = p.replace(/\\/g, '/').toLowerCase()
  const base = n.split('/').pop() ?? n
  if (base === '.env.example') return false
  return base === '.env' || base.startsWith('.env.') || /\.(pem|key|p12|pfx)$/.test(base) || base === 'id_rsa' || base.includes('credentials')
}

/**
 * 프로젝트 러너 deps — 모든 git/gh 호출은 검증된 작업 폴더(cwd)와 허용 목록 repo(--repo)로 고정.
 * pollOnce(기존 오케스트레이터)를 그대로 재사용한다.
 */
export function makeProjectDeps(input: ProjectDepsInput): RemoteDeps {
  const { spec, workspace, exec } = input
  const git = (args: string[]): Promise<ExecResult> => exec('git', args, workspace)
  const gh = (args: string[]): Promise<ExecResult> => exec('gh', args, workspace)
  const fail = (reason: string, changedFiles: string[] = [], checks: RunTaskResult['checks'] = {}): RunTaskResult => ({ ok: false, changedFiles, checks, reason })

  return {
    now: input.now,
    saveState: (s) => input.saveState(s),
    async listIssueComments(): Promise<ListResult> {
      // 지정 이슈의 댓글만 읽는다(PR 본문/다른 이슈는 읽지 않음). 댓글 1건 = JSON 1줄.
      const r = await gh(['api', `repos/${spec.repo}/issues/${spec.issueNumber}/comments`, '--paginate', '--jq', '.[] | {author: .user.login, body: .body} | @json'])
      if (r.code !== 0) return { ok: false, comments: [], errorKind: classifyGhError(r.err || r.out, r.code), error: 'gh api 실패' }
      try {
        const comments = r.out
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l) as { author?: string; body?: string })
          .map((x) => ({ author: String(x.author ?? ''), body: String(x.body ?? '') }))
        return { ok: true, comments }
      } catch {
        return { ok: false, comments: [], errorKind: 'other', error: 'gh 응답 파싱 실패' }
      }
    },
    async runTaskOnBranch({ title, body, branch }): Promise<RunTaskResult> {
      if (!branch.startsWith(spec.branchPrefix)) return fail('허용되지 않은 브랜치 접두사')
      const v = await input.verifyWorkspace()
      if (!v.ok) return fail(`작업 폴더 검증 실패: ${v.reason ?? v.code}`)

      const dirty = await git(['status', '--porcelain'])
      if (dirty.code !== 0) return fail('git status 실패')
      if (dirty.out.trim()) {
        const cur = (await git(['branch', '--show-current'])).out.trim()
        if (!cur.startsWith(spec.branchPrefix)) {
          return fail('작업 폴더에 미커밋 변경이 있어 보존을 위해 실행하지 않았습니다(수동 커밋 또는 stash 후 재시도).')
        }
        // 이전 원격작업 잔여물 — 삭제하지 않고 복구 가능한 named stash 로 보존(확인 실패 시 중단).
        const label = `sj-remote-autostash:${spec.id}:${branch}:${input.now()}`
        const before = (await git(['stash', 'list'])).out
        const st = await git(['stash', 'push', '--include-untracked', '-m', label])
        const listed = (await git(['stash', 'list'])).out
        const preserved = st.code === 0 && /saved working directory/i.test(`${st.out}\n${st.err}`) && listed.includes(label) && listed.length > before.length
        if (!preserved) return fail('미커밋 변경 보존(stash) 확인 실패 — 삭제하지 않고 작업을 중단했습니다.')
      }

      // 기존 브랜치는 덮어쓰지 않는다(checkout -B 리셋으로 커밋 유실 방지).
      const exists = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
      if (exists.code === 0) return fail(`브랜치가 이미 있습니다(덮어쓰지 않음): ${branch}`)
      const fetch = await git(['fetch', 'origin', spec.baseBranch])
      if (fetch.code !== 0) return fail(`git fetch 실패(${classifyGhError(fetch.err, fetch.code)})`)
      const co = await git(['checkout', '-b', branch, `origin/${spec.baseBranch}`])
      if (co.code !== 0) return fail(`브랜치 생성 실패: ${branch}`)

      const job = await input.runJob({ title: `[remote:${spec.id}] ${title}`, prompt: buildProjectPrompt(spec, workspace, body), workspace })
      const checks = { typecheck: job.typecheck, build: job.build, test: undefined as string | undefined }
      const changedFiles = porcelainFiles((await git(['status', '--porcelain'])).out)
      if (job.status !== 'succeeded') {
        const reason = job.status === 'timed-out' ? '실행 시간 초과(약 15분) — 미커밋 변경은 작업 폴더에 남아 있습니다.' : job.errorSummary ?? `러너 작업이 성공하지 못했습니다(status=${job.status}).`
        return fail(reason, changedFiles, checks)
      }
      if (!changedFiles.length) return fail('변경된 파일이 없습니다(작업이 파일을 만들지 못함).', changedFiles, checks)
      const blocked = changedFiles.filter(isBlockedCommitPath)
      if (blocked.length) return fail(`비밀/환경 파일 변경 감지 — 커밋하지 않음: ${blocked.join(', ')}`, changedFiles, checks)

      const cur = (await git(['branch', '--show-current'])).out.trim()
      if (cur !== branch) return fail(`작업 중 브랜치가 바뀌었습니다(${cur}) — 커밋하지 않음`, changedFiles, checks)
      const add = await git(['add', '--', ...changedFiles])
      if (add.code !== 0) return fail('git add 실패', changedFiles, checks)
      const commit = await git(['-c', 'user.name=SJ Remote Runner', '-c', 'user.email=remote-runner@users.noreply.github.com', 'commit', '-m', `[remote-task:${spec.id}] ${title}`])
      if (commit.code !== 0) return fail('커밋 실패', changedFiles, checks)
      return { ok: true, changedFiles, checks }
    },
    async pushBranch(branch): Promise<{ ok: boolean; error?: string }> {
      if (!branch.startsWith(spec.branchPrefix)) return { ok: false, error: '허용되지 않은 브랜치' }
      const v = await input.verifyWorkspace()
      if (!v.ok) return { ok: false, error: `작업 폴더 재검증 실패: ${v.code}` }
      const cur = (await git(['branch', '--show-current'])).out.trim()
      if (cur !== branch) return { ok: false, error: '현재 브랜치 불일치' }
      // force 없음. origin 은 위 재검증으로 허용 repo 임이 확인됨.
      const r = await git(['push', '-u', 'origin', branch])
      if (r.code !== 0) return { ok: false, error: classifyGhError(r.err, r.code) }
      return { ok: true }
    },
    async createReviewPr({ branch, title, taskId }): Promise<{ ok: boolean; url?: string; error?: string }> {
      if (!branch.startsWith(spec.branchPrefix)) return { ok: false, error: '허용되지 않은 브랜치' }
      const r = await gh([
        'pr', 'create', '--repo', spec.repo, '--base', spec.baseBranch, '--head', branch,
        '--title', `[remote-task ${taskId}] ${title}`,
        '--body', `원격 작업 \`${taskId}\` 결과. 검토용(자동 병합 안 함). 이슈 #${spec.issueNumber} 참조.`
      ])
      if (r.code !== 0) return { ok: false, error: classifyGhError(r.err, r.code) }
      return { ok: true, url: (r.out.match(/https?:\/\/\S+/) ?? [])[0] }
    },
    async postComment(body): Promise<{ ok: boolean; error?: string }> {
      // 결과는 해당 프로젝트 저장소의 지정 이슈에만 남긴다(공개 SJ-OS 이슈로 복사하지 않음).
      const r = await gh(['issue', 'comment', String(spec.issueNumber), '--repo', spec.repo, '--body', body])
      if (r.code !== 0) return { ok: false, error: classifyGhError(r.err, r.code) }
      return { ok: true }
    }
  }
}
