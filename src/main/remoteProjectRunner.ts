// 다중 저장소 원격 작업 러너 (main 전용) — 1단계: SJ AI MARKETING.
//
// 기존 SJ-OS 러너(remoteTaskRunner, 이슈 #76, workspace=app 경로)는 변경·비활성화하지 않는다.
// 이 모듈은 허용 목록(REMOTE_PROJECT_ALLOWLIST)의 프로젝트만, 별도 작업 폴더·별도 상태 파일·
// 별도 브랜치 접두사·해당 저장소 PR/이슈로 처리한다.
//
// 활성화 정책: 앱 설정 저장만으로는 시작되지 않는다. 노트북에서 '연결 검사'(작업 폴더·gh 로그인·
// 비공개 저장소 접근·Claude CLI)를 통과한 뒤 **명시적 시작** 으로만 enabled=true 가 된다.
// 앱 재시작 시에도 enabled 인 프로젝트는 연결 검사를 다시 통과해야만 수신을 재개한다.

import { app, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path'
import {
  spawnTool,
  createRemoteProjectAutoBuildJob,
  runAutoBuildJob,
  cancelAutoBuildJob,
  isAutoBuildBusy,
  registerRemoteProjectWorkspace,
  unregisterRemoteProjectWorkspace
} from './claudeAutoBuild'
import { createStateStore, remoteRunLock, waitForJob } from './remoteTaskRunner'
import { classifyGhError, markInterruptedAsFailed } from '../shared/remoteTask'
import { pollOnce } from '../shared/remoteTaskPoll'
import {
  REMOTE_PROJECT_ALLOWLIST,
  DEFAULT_PROJECT_USER_CONFIG,
  findProjectSpec,
  sanitizeUserPatch,
  projectRunnerConfig,
  projectStateFileName,
  validateProjectWorkspace,
  evaluateReadiness,
  makeProjectDeps,
  type ExecFn,
  type ExecResult,
  type Readiness,
  type RemoteProjectSpec,
  type RemoteProjectStatus,
  type RemoteProjectUserConfig,
  type WorkspaceCheck,
  type WorkspaceFacts
} from '../shared/remoteProjects'

const isWin = process.platform === 'win32'
// SJ-OS 원본 경로(claudeAutoBuild 의 ALLOWED_WORKSPACE_MAIN 과 동일) — 프로젝트 작업 폴더와 겹치면 거부.
const SJ_OS_MAIN_WORKSPACE = 'C:\\Users\\GalaxyBook5\\.vscode\\SJ-OS'

// --- 고정 CLI 실행(셸 문자열 없음) ------------------------------------------------
const exec: ExecFn = (tool, args, cwd) =>
  new Promise<ExecResult>((done) => {
    const child = tool === 'gh' ? spawnTool('gh', args, { cwd, windowsHide: true }) : spawn('git', args, { cwd, windowsHide: true })
    let out = ''
    let err = ''
    child.stdout?.on('data', (d) => (out += String(d)))
    child.stderr?.on('data', (d) => (err += String(d)))
    child.on('error', (e) => done({ code: -1, out, err: err + String(e) }))
    child.on('close', (code) => done({ code: code ?? -1, out, err }))
  })

function runTool(tool: string, args: string[], cwd: string, timeoutMs = 20000): Promise<ExecResult> {
  return new Promise((done) => {
    let out = ''
    let err = ''
    let child: ReturnType<typeof spawnTool>
    try {
      child = spawnTool(tool, args, { cwd, windowsHide: true })
    } catch (e) {
      done({ code: -1, out, err: String(e) })
      return
    }
    const t = setTimeout(() => child.kill(), timeoutMs)
    child.stdout?.on('data', (d) => (out += String(d)))
    child.stderr?.on('data', (d) => (err += String(d)))
    child.on('error', (e) => done({ code: -1, out, err: err + String(e) }))
    child.on('close', (code) => {
      clearTimeout(t)
      done({ code: code ?? -1, out, err })
    })
  })
}

function safeRealpath(p: string): string {
  try {
    return realpathSync.native(p)
  } catch {
    return ''
  }
}

/** 경로의 모든 구성요소(루트 제외)에 심볼릭 링크/정션이 있는지. */
function hasLinkSegment(p: string): boolean {
  const root = parse(p).root
  let cur = p
  while (cur && cur !== root && cur !== dirname(cur)) {
    try {
      if (lstatSync(cur).isSymbolicLink()) return true
    } catch {
      return true
    }
    cur = dirname(cur)
  }
  return false
}

async function collectFacts(input: string): Promise<WorkspaceFacts> {
  const resolved = input ? resolve(input) : ''
  const exists = !!resolved && existsSync(resolved)
  let isDirectory = false
  try {
    isDirectory = exists && statSync(resolved).isDirectory()
  } catch {
    isDirectory = false
  }
  const realpath = exists ? safeRealpath(resolved) : ''
  const facts: WorkspaceFacts = {
    input,
    isAbsolute: !!input && isAbsolute(input),
    resolved,
    exists,
    isDirectory,
    realpath,
    hasLinkSegment: exists ? hasLinkSegment(resolved) : false,
    gitToplevel: '',
    originUrl: '',
    currentBranch: ''
  }
  if (!isDirectory || !realpath) return facts
  const top = await exec('git', ['rev-parse', '--show-toplevel'], realpath)
  if (top.code === 0) facts.gitToplevel = safeRealpath(top.out.trim().replace(/\//g, sep))
  const origin = await exec('git', ['remote', 'get-url', 'origin'], realpath)
  if (origin.code === 0) facts.originUrl = origin.out.trim()
  const br = await exec('git', ['branch', '--show-current'], realpath)
  if (br.code === 0) facts.currentBranch = br.out.trim()
  return facts
}

// 작업 폴더가 이들과 같거나·안쪽이거나·상위면 거부. (홈/드라이브 루트처럼 상위 폴더를 지정하면
// SJ-OS 경로를 포함하므로 '상위' 규칙으로 거부된다.)
function protectedRoots(): string[] {
  const roots = [resolve(app.getAppPath()), SJ_OS_MAIN_WORKSPACE, app.getPath('userData')]
  return [...new Set(roots.flatMap((r) => [r, safeRealpath(r)]).filter(Boolean))]
}

// --- 설정(작업 폴더·runnerId·주기·enabled 만; 비밀 없음) ---------------------------
type ProjectsConfigFile = Record<string, RemoteProjectUserConfig>
function configPath(): string {
  return join(app.getPath('userData'), 'remote-projects-config.json')
}
function loadAll(): ProjectsConfigFile {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as ProjectsConfigFile
  } catch {
    return {}
  }
}
export function loadProjectConfig(id: string): RemoteProjectUserConfig {
  const raw = loadAll()[id]
  return { ...DEFAULT_PROJECT_USER_CONFIG, ...(raw ?? {}) }
}
function saveProjectConfig(id: string, next: RemoteProjectUserConfig): RemoteProjectUserConfig {
  const all = loadAll()
  all[id] = next
  try {
    const tmp = `${configPath()}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(all, null, 2), 'utf8')
    renameSync(tmp, configPath())
  } catch {
    /* ignore */
  }
  return next
}

// --- 연결 검사 ----------------------------------------------------------------
function otherProjectRoots(id: string): string[] {
  return REMOTE_PROJECT_ALLOWLIST.filter((p) => p.id !== id)
    .map((p) => loadProjectConfig(p.id).workspace)
    .filter(Boolean)
    .map((w) => resolve(w))
}

async function checkWorkspace(spec: RemoteProjectSpec, user: RemoteProjectUserConfig): Promise<WorkspaceCheck> {
  const facts = await collectFacts(user.workspace)
  return validateProjectWorkspace(spec, facts, protectedRoots(), isWin, otherProjectRoots(spec.id))
}

interface ProjectRuntime {
  timer: ReturnType<typeof setInterval> | null
  ticking: boolean
  lastActions: string[]
  readiness: Readiness | null
  registeredWorkspace: string | null
}
const runtimes = new Map<string, ProjectRuntime>()
function rt(id: string): ProjectRuntime {
  let r = runtimes.get(id)
  if (!r) {
    r = { timer: null, ticking: false, lastActions: [], readiness: null, registeredWorkspace: null }
    runtimes.set(id, r)
  }
  return r
}

export async function verifyProject(id: string): Promise<{ readiness: Readiness; workspace?: WorkspaceCheck }> {
  const spec = findProjectSpec(id)
  if (!spec) return { readiness: { state: 'blocked', label: '허용되지 않은 프로젝트', problems: ['allowlist 에 없음'] } }
  const user = loadProjectConfig(id)
  const pre = evaluateReadiness({ user })
  if (pre.state === 'not-configured') {
    rt(id).readiness = pre
    return { readiness: pre }
  }
  const workspace = await checkWorkspace(spec, user)
  const cwd = workspace.ok && workspace.realpath ? workspace.realpath : app.getPath('userData')
  const auth = await runTool('gh', ['auth', 'status'], cwd)
  const ghAuth = { ok: auth.code === 0, errorKind: auth.code === 0 ? undefined : classifyGhError(`${auth.err}\n${auth.out}`, auth.code) }
  const access = await runTool('gh', ['api', `repos/${spec.repo}`, '--jq', '.full_name'], cwd)
  const accessOk = access.code === 0 && access.out.trim().toLowerCase() === spec.repo.toLowerCase()
  const repoAccess = { ok: accessOk, errorKind: accessOk ? undefined : classifyGhError(`${access.err}\n${access.out}`, access.code) }
  const cl = await runTool('claude', ['--version'], cwd)
  const readiness = evaluateReadiness({ user, workspace, ghAuth, repoAccess, claude: { ok: cl.code === 0 } })
  rt(id).readiness = readiness
  if (readiness.state === 'ready' && workspace.realpath) {
    saveProjectConfig(id, { ...loadProjectConfig(id), verifiedAt: new Date().toISOString(), verifiedWorkspace: workspace.realpath })
  }
  return { readiness, workspace }
}

// --- 실행 ---------------------------------------------------------------------
function stopTimer(id: string): void {
  const r = rt(id)
  if (r.timer) {
    clearInterval(r.timer)
    r.timer = null
  }
  if (r.registeredWorkspace) {
    unregisterRemoteProjectWorkspace(r.registeredWorkspace)
    r.registeredWorkspace = null
  }
}

async function runJob(input: { title: string; prompt: string; workspace: string }): Promise<{ status: string; typecheck?: string; build?: string; errorSummary?: string }> {
  const job = createRemoteProjectAutoBuildJob(input)
  if (job.status === 'blocked') return { status: 'blocked', errorSummary: job.safetyResult?.blockedReason ?? '차단됨' }
  const started = runAutoBuildJob(job.id)
  if (!started || started.status !== 'running') {
    // 다른 작업이 실행 중 등으로 즉시 시작 못 함 — 대기열에 남기지 않고 취소(나중에 엉뚱한 시점 실행 방지).
    cancelAutoBuildJob(job.id)
    return { status: started?.status ?? 'failed', errorSummary: '실행기가 사용 중이거나 시작하지 못했습니다.' }
  }
  const done = await waitForJob(job.id)
  return {
    status: done?.status ?? 'unknown',
    typecheck: done?.verification.typecheckStatus,
    build: done?.verification.buildStatus,
    errorSummary: done?.errorSummary
  }
}

/** 명시적 시작: 연결 검사 통과 + runnerId 필요. 통과 시에만 enabled=true 영속화. */
export async function startProject(id: string): Promise<RemoteProjectStatus> {
  const spec = findProjectSpec(id)
  if (!spec) return projectStatus(id)
  stopTimer(id)
  const { readiness, workspace } = await verifyProject(id)
  if (readiness.state !== 'ready' || !workspace?.realpath) {
    rt(id).lastActions = [`not-started: ${readiness.label}`]
    return projectStatus(id)
  }
  const user = saveProjectConfig(id, { ...loadProjectConfig(id), enabled: true })
  const ws = workspace.realpath
  const r = rt(id)
  registerRemoteProjectWorkspace(ws)
  r.registeredWorkspace = ws

  const dataDir = app.getPath('userData')
  const store = createStateStore(dataDir, projectStateFileName(spec))
  if (!r.ticking) {
    const { state: swept, changed } = markInterruptedAsFailed(store.load())
    if (changed.length) store.save(swept)
  }
  const config = projectRunnerConfig(spec, user)
  const deps = makeProjectDeps({
    spec,
    workspace: ws,
    exec,
    verifyWorkspace: async () => {
      const v = await checkWorkspace(spec, loadProjectConfig(id))
      // 시작 시 검증된 경로에서 바뀌었으면(설정 변경·바꿔치기) 거부.
      if (v.ok && v.realpath !== ws) return { ok: false, code: 'symlink', reason: '시작 후 작업 폴더가 바뀌었습니다(재시작 필요)' }
      return v
    },
    runJob,
    saveState: (s) => store.save(s),
    now: () => new Date().toISOString()
  })

  const tick = async (): Promise<void> => {
    if (r.ticking) return
    if (isAutoBuildBusy()) {
      r.lastActions = ['busy:auto-build']
      return
    }
    if (!remoteRunLock.tryAcquire(spec.id)) {
      r.lastActions = [`busy:${remoteRunLock.holder() ?? 'other'}`]
      return
    }
    r.ticking = true
    try {
      const outcome = await pollOnce(config, store.load(), deps)
      store.save(outcome.state)
      r.lastActions = outcome.actions
    } catch (e) {
      r.lastActions = [`tick-error: ${e instanceof Error ? e.message : String(e)}`]
    } finally {
      r.ticking = false
      remoteRunLock.release(spec.id)
    }
  }
  void tick()
  r.timer = setInterval(() => void tick(), config.pollSeconds * 1000)
  r.lastActions = ['started']
  return projectStatus(id)
}

export function stopProject(id: string): RemoteProjectStatus {
  stopTimer(id)
  if (findProjectSpec(id)) saveProjectConfig(id, { ...loadProjectConfig(id), enabled: false })
  rt(id).lastActions = ['stopped']
  return projectStatus(id)
}

export function projectStatus(id: string): RemoteProjectStatus {
  const spec = findProjectSpec(id)
  const user = loadProjectConfig(id)
  const r = rt(id)
  const readiness = r.readiness ?? evaluateReadiness({ user })
  const active = r.timer !== null
  return {
    id,
    label: spec?.label ?? id,
    repo: spec?.repo ?? '',
    issueNumber: spec?.issueNumber ?? 0,
    branchPrefix: spec?.branchPrefix ?? '',
    workspace: user.workspace,
    runnerId: user.runnerId,
    pollSeconds: user.pollSeconds,
    enabled: user.enabled,
    active,
    // 수신 중이 아니면 검사 통과여도 '미연결'(종단간 1건 확인 전엔 완료로 보지 않음).
    connection: active ? '수신 중(종단간 1건 확인 전까지 미검증)' : readiness.state === 'ready' ? '미연결 · 검사 통과(시작 전)' : readiness.label,
    connectionState: active ? 'active' : readiness.state,
    problems: readiness.problems,
    verifiedAt: user.verifiedAt,
    lastActions: r.lastActions
  }
}

/** 앱 시작: enabled 인 프로젝트만 연결 검사를 다시 통과하면 재개(실패 시 enabled 유지·미연결 표시). */
export function autostartRemoteProjects(): void {
  for (const spec of REMOTE_PROJECT_ALLOWLIST) {
    const user = loadProjectConfig(spec.id)
    if (user.enabled && user.runnerId && user.workspace) void startProject(spec.id).catch(() => undefined)
  }
}

export function registerRemoteProjectIpc(): void {
  ipcMain.handle('remote-project:list', () => REMOTE_PROJECT_ALLOWLIST.map((p) => projectStatus(p.id)))
  ipcMain.handle('remote-project:set-config', (_e, id: string, patch: unknown) => {
    if (!findProjectSpec(id)) return null
    // 작업 폴더·runnerId·주기만. enabled/repo/issue/작성자는 여기서 바꿀 수 없다.
    // 설정이 바뀌면 수신을 멈추고 재검사·명시적 시작을 요구한다.
    const p = sanitizeUserPatch(patch)
    const cur = loadProjectConfig(id)
    const changed = (p.workspace !== undefined && p.workspace !== cur.workspace) || (p.runnerId !== undefined && p.runnerId !== cur.runnerId)
    const next: RemoteProjectUserConfig = { ...cur, ...p }
    if (changed) {
      stopTimer(id)
      next.enabled = false
      next.verifiedAt = undefined
      next.verifiedWorkspace = undefined
      rt(id).readiness = null
    }
    saveProjectConfig(id, next)
    return projectStatus(id)
  })
  ipcMain.handle('remote-project:verify', async (_e, id: string) => {
    await verifyProject(id)
    return projectStatus(id)
  })
  ipcMain.handle('remote-project:start', (_e, id: string) => startProject(id))
  ipcMain.handle('remote-project:stop', (_e, id: string) => stopProject(id))
}
