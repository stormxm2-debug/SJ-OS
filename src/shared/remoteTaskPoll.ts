// 원격 작업 오케스트레이터 — 순수(electron/node I/O 없음, deps 주입, 단위테스트 대상).
// 실제 I/O(gh/git/러너/영속화)는 main 측 remoteTaskRunner 가 deps 로 주입한다.

import {
  parseTaskDirective,
  validateDirective,
  isAlreadyHandled,
  withProcessed,
  buildResultComment,
  defaultBranchName,
  isSafeBranchName,
  type ProcessedState,
  type ProcessedEntry,
  type TaskResult
} from './remoteTask'

export interface RemoteRunnerConfig {
  enabled: boolean
  repo: string // "owner/name"
  issueNumber: number
  allowedAuthors: string[]
  runnerId: string
  pollSeconds: number
  /**
   * 선택(다중 저장소 러너용): 작업 브랜치 접두사. 지정하면 지시의 branch 가 이 접두사로 시작할
   * 때만 사용하고, 아니면 `<접두사><task>` 로 강제한다. 미지정(SJ-OS 기본)은 기존 동작 그대로.
   */
  branchPrefix?: string
  /** 선택(다중 저장소 러너용): true 면 지시에 `repo: owner/name` 헤더가 반드시 있어야 한다. */
  requireRepoHeader?: boolean
}

export const DEFAULT_REMOTE_CONFIG: RemoteRunnerConfig = {
  enabled: false,
  repo: 'stormxm2-debug/SJ-OS',
  issueNumber: 76,
  allowedAuthors: ['stormxm2-debug'],
  runnerId: '',
  pollSeconds: 60
}

export interface IssueComment {
  author: string
  body: string
}
export interface ListResult {
  ok: boolean
  comments: IssueComment[]
  errorKind?: 'offline' | 'auth-expired' | 'other'
  error?: string
}
export interface RunTaskResult {
  ok: boolean
  changedFiles: string[]
  checks: { typecheck?: string; test?: string; build?: string }
  reason?: string
  incomplete?: string
}
export interface RemoteDeps {
  listIssueComments(): Promise<ListResult>
  runTaskOnBranch(input: { taskId: string; title: string; body: string; branch: string }): Promise<RunTaskResult>
  pushBranch(branch: string): Promise<{ ok: boolean; error?: string }>
  createReviewPr(input: { branch: string; title: string; taskId: string }): Promise<{ ok: boolean; url?: string; error?: string }>
  postComment(body: string): Promise<{ ok: boolean; error?: string }>
  saveState(state: ProcessedState): Promise<void> | void
  now(): string
}
export interface PollOutcome {
  state: ProcessedState
  actions: string[]
}

export interface RemoteRunnerStatus {
  enabled: boolean
  active: boolean
  runnerId: string
  issueNumber: number
  lastActions: string[]
}

/**
 * 한 번의 폴링 주기: 댓글을 읽어 유효한 신규 작업을 1건 처리한다.
 * - 네트워크/인증 실패는 성공으로 처리하지 않는다(상태 변경 없이 사유만 기록).
 * - 중복(이미 선점/실행/완료)은 재실행하지 않는다.
 * - 허용되지 않은 작성자/runner/형식은 실행하지 않는다.
 * - 한 주기에 1건만 처리(워크스페이스 경합 방지).
 */
export async function pollOnce(config: RemoteRunnerConfig, state: ProcessedState, deps: RemoteDeps): Promise<PollOutcome> {
  const actions: string[] = []
  let cur: ProcessedState = state

  const list = await deps.listIssueComments()
  if (!list.ok) {
    actions.push(`list-failed:${list.errorKind ?? 'other'}`)
    return { state: cur, actions }
  }

  for (const c of list.comments) {
    const d = parseTaskDirective(c.body)
    const v = validateDirective(d, {
      commentAuthor: c.author,
      allowedAuthors: config.allowedAuthors,
      runnerId: config.runnerId,
      repo: config.repo,
      expectedRepo: config.repo,
      requireRepo: config.requireRepoHeader === true
    })
    if (!v.ok) {
      if (d && d.taskId && v.code !== 'no-directive' && !cur[d.taskId]) {
        const e: ProcessedEntry = { taskId: d.taskId, status: 'rejected', updatedAt: deps.now(), reason: v.reason }
        cur = withProcessed(cur, e)
        await deps.saveState(cur)
        actions.push(`reject:${d.taskId}:${v.code}`)
      }
      continue
    }
    const task = d!
    if (isAlreadyHandled(cur, task.taskId)) {
      // 완료·실패·거부·진행중 — 자동 재실행하지 않음(명시적 재개/새 작업 정책).
      actions.push(`skip-dup:${task.taskId}`)
      continue
    }

    const prefix = config.branchPrefix
    const branch = prefix
      ? task.branch && isSafeBranchName(task.branch) && task.branch.startsWith(prefix)
        ? task.branch
        : `${prefix}${task.taskId}`.slice(0, 120)
      : task.branch && isSafeBranchName(task.branch)
        ? task.branch
        : defaultBranchName(task.taskId)
    // 선점(claim) 먼저 영속화 — 크래시/재시작 시 중복 실행 방지.
    cur = withProcessed(cur, { taskId: task.taskId, status: 'claimed', updatedAt: deps.now(), branch })
    await deps.saveState(cur)
    actions.push(`claim:${task.taskId}`)

    cur = withProcessed(cur, { taskId: task.taskId, status: 'running', updatedAt: deps.now(), branch })
    await deps.saveState(cur)
    const run = await deps.runTaskOnBranch({ taskId: task.taskId, title: task.title, body: task.body, branch })

    let prUrl: string | undefined
    let note: string | undefined
    if (run.ok) {
      const push = await deps.pushBranch(branch)
      if (push.ok) {
        const pr = await deps.createReviewPr({ branch, title: task.title, taskId: task.taskId })
        if (pr.ok) prUrl = pr.url
        else note = `PR 생성 실패: ${pr.error ?? ''}`
      } else {
        note = `push 실패: ${push.error ?? ''}`
      }
    } else {
      note = `작업 실행 실패: ${run.reason ?? ''}`
    }

    const result: TaskResult = {
      taskId: task.taskId,
      runnerId: config.runnerId,
      branch,
      prUrl,
      checks: run.checks,
      changedFiles: run.changedFiles,
      incomplete: run.incomplete,
      note,
      ok: run.ok && !!prUrl
    }
    await deps.postComment(buildResultComment(result))

    cur = withProcessed(cur, {
      taskId: task.taskId,
      status: result.ok ? 'succeeded' : 'failed',
      updatedAt: deps.now(),
      branch,
      prUrl,
      reason: result.ok ? undefined : note
    })
    await deps.saveState(cur)
    actions.push(`${result.ok ? 'done' : 'fail'}:${task.taskId}`)
    break // 한 주기 1건만.
  }

  return { state: cur, actions }
}
