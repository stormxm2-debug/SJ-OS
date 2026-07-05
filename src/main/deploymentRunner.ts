import { app } from 'electron'
import { type ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  ApplyDeployScriptResult,
  DeployPreflight,
  DeploymentRun,
  PackageScriptsInfo
} from '@shared/deployment'
import { detectDeployTool, maskSecrets, validateDeployScript } from '@shared/deployment'
import { spawnTool } from './claudeAutoBuild'

/**
 * Approved deployment runner (Electron MAIN only).
 *
 * SAFETY: only ever runs the FIXED command `npm run deploy` (and preflight
 * `npm run typecheck` / `npm run build` / `git status --short`). It refuses unless
 * package.json defines a `deploy` script, the workspace matches, and preflight
 * passes. NO arbitrary command from the renderer, NO shell string, NO force, NO
 * platform/.env/secret changes. Log lines are secret-masked.
 */

const ALLOWED_WORKSPACE_MAIN = 'C:\\Users\\GalaxyBook5\\.vscode\\SJ-OS'

function mainWorkspace(): string {
  return resolve(app.getAppPath())
}
function sameWorkspace(a: string, b: string): boolean {
  const ra = resolve(a)
  const rb = resolve(b)
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb
}
function nowIso(): string {
  return new Date().toISOString()
}

let emitRun: (run: DeploymentRun) => void = () => {}
export function setDeploymentEmitter(fn: (run: DeploymentRun) => void): void {
  emitRun = fn
}

const runs = new Map<string, DeploymentRun>() // keyed by releaseItemId
const procs = new Map<string, ChildProcess>()

function touch(run: DeploymentRun, patch: Partial<DeploymentRun>): DeploymentRun {
  const next: DeploymentRun = { ...run, ...patch }
  runs.set(next.releaseItemId, next)
  emitRun(next)
  return next
}
function addLog(releaseItemId: string, line: string): void {
  const run = runs.get(releaseItemId)
  if (!run) return
  touch(run, { logLines: [...run.logLines, maskSecrets(line)].slice(-200) })
}

function readPackageJson(): { raw: string; pkg: { scripts?: Record<string, string> } } | null {
  try {
    const raw = readFileSync(join(mainWorkspace(), 'package.json'), 'utf8')
    return { raw, pkg: JSON.parse(raw) as { scripts?: Record<string, string> } }
  } catch {
    return null
  }
}

/** Does package.json define a `deploy` script? (read-only; never executes it) */
export function deployScriptExists(): boolean {
  const read = readPackageJson()
  const deploy = read?.pkg.scripts?.deploy
  return typeof deploy === 'string' && deploy.trim().length > 0
}

/** Read-only inspection of package.json's deploy/build/typecheck scripts. */
export function inspectPackageScripts(): PackageScriptsInfo {
  const read = readPackageJson()
  const scripts = read?.pkg.scripts ?? {}
  const deployScript = scripts.deploy
  return {
    deployScript,
    buildScript: scripts.build,
    typecheckScript: scripts.typecheck,
    hasDeploy: typeof deployScript === 'string' && deployScript.trim().length > 0,
    hasBuild: typeof scripts.build === 'string',
    hasTypecheck: typeof scripts.typecheck === 'string',
    detectedTool: detectDeployTool(deployScript)
  }
}

/**
 * Apply a deploy script to package.json AFTER explicit approval. Validates the
 * script (blocks destructive / secret content), writes only `scripts.deploy`, and
 * never runs it. This is the ONLY place the renderer flow can change package.json,
 * and only via this validated main path.
 */
export function applyDeployScript(script: string): ApplyDeployScriptResult {
  const validation = validateDeployScript(script)
  if (!sameWorkspace(mainWorkspace(), ALLOWED_WORKSPACE_MAIN)) {
    return { applied: false, scripts: inspectPackageScripts(), validation, errorMessage: '허용된 작업 폴더가 아닙니다.' }
  }
  if (!validation.safe) {
    return { applied: false, scripts: inspectPackageScripts(), validation, errorMessage: `안전하지 않은 스크립트입니다: ${validation.reasons.join(', ')}` }
  }
  const read = readPackageJson()
  if (!read) {
    return { applied: false, scripts: inspectPackageScripts(), validation, errorMessage: 'package.json을 읽지 못했습니다.' }
  }
  try {
    const pkg = read.pkg
    pkg.scripts = { ...(pkg.scripts ?? {}), deploy: script.trim() }
    // Preserve 2-space JSON formatting + trailing newline (matches repo style).
    writeFileSync(join(mainWorkspace(), 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    return { applied: true, scripts: inspectPackageScripts(), validation }
  } catch (e) {
    return {
      applied: false,
      scripts: inspectPackageScripts(),
      validation,
      errorMessage: e instanceof Error ? e.message : 'package.json 저장 실패'
    }
  }
}

function baseRun(releaseItemId: string): DeploymentRun {
  const existing = runs.get(releaseItemId)
  return (
    existing ?? {
      id: `deploy-${releaseItemId}`,
      releaseItemId,
      title: releaseItemId,
      status: 'not-ready',
      workspacePath: mainWorkspace(),
      deployScriptName: 'deploy',
      logLines: []
    }
  )
}

export function getDeploymentRun(releaseItemId: string): DeploymentRun | null {
  return runs.get(releaseItemId) ?? null
}

// --- fixed helpers ---------------------------------------------------------

function runFixed(command: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolveP) => {
    let out = ''
    let child: ChildProcess
    try {
      child = spawnTool(command, args, { cwd: mainWorkspace(), windowsHide: true })
    } catch {
      resolveP({ code: -1, out: `${command} 실행 실패` })
      return
    }
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', () => resolveP({ code: -1, out: `${command} 실행 실패` }))
    child.on('close', (code) => resolveP({ code: code ?? -1, out }))
  })
}

async function computePreflight(releaseItemId: string): Promise<DeployPreflight> {
  addLog(releaseItemId, '$ npm run typecheck')
  const tc = await runFixed('npm', ['run', 'typecheck'])
  addLog(releaseItemId, `typecheck exit ${tc.code}`)
  addLog(releaseItemId, '$ npm run build')
  const bd = await runFixed('npm', ['run', 'build'])
  addLog(releaseItemId, `build exit ${bd.code}`)
  const gs = await runFixed('git', ['status', '--short'])
  return {
    typecheckStatus: tc.code === 0 ? 'passed' : 'failed',
    buildStatus: bd.code === 0 ? 'passed' : 'failed',
    gitStatusShort: gs.out.trim().slice(0, 2000),
    packageDeployScriptExists: deployScriptExists()
  }
}

/** Run preflight only (no deploy). */
export async function runDeployPreflight(releaseItemId: string): Promise<DeploymentRun> {
  let run = touch(baseRun(releaseItemId), {
    status: 'preflight-running',
    logLines: [...(runs.get(releaseItemId)?.logLines ?? []), '배포 전 검사 시작…']
  })
  const preflight = await computePreflight(releaseItemId)
  const passed =
    preflight.typecheckStatus === 'passed' &&
    preflight.buildStatus === 'passed' &&
    preflight.packageDeployScriptExists
  run = touch(runs.get(releaseItemId)!, {
    status: passed ? 'preflight-passed' : 'preflight-failed',
    preflight,
    errorMessage: preflight.packageDeployScriptExists
      ? undefined
      : 'package.json에 deploy 스크립트가 없어 자동 배포를 실행할 수 없습니다.'
  })
  return run
}

/** Run the APPROVED deployment: preflight → `npm run deploy` (fixed). */
export async function runApprovedDeployment(releaseItemId: string): Promise<DeploymentRun> {
  // Workspace gate.
  if (!sameWorkspace(mainWorkspace(), ALLOWED_WORKSPACE_MAIN)) {
    return touch(baseRun(releaseItemId), { status: 'blocked', errorMessage: '허용된 작업 폴더가 아닙니다.' })
  }
  // Deploy-script gate (never invent one).
  if (!deployScriptExists()) {
    return touch(baseRun(releaseItemId), {
      status: 'blocked',
      errorMessage: 'package.json에 deploy 스크립트가 없어 자동 배포를 실행할 수 없습니다.'
    })
  }
  // Preflight gate.
  const pre = await runDeployPreflight(releaseItemId)
  if (pre.status !== 'preflight-passed') {
    return touch(runs.get(releaseItemId)!, {
      status: 'preflight-failed',
      errorMessage: '배포 전 검사(typecheck/build)에 실패했습니다.'
    })
  }

  // Spawn the fixed deploy script. No shell string, no renderer input.
  const run = touch(runs.get(releaseItemId)!, {
    status: 'deploying',
    startedAt: nowIso(),
    logLines: [...runs.get(releaseItemId)!.logLines, '$ npm run deploy']
  })
  let child: ChildProcess
  try {
    child = spawnTool('npm', ['run', 'deploy'], { cwd: mainWorkspace(), windowsHide: true })
  } catch {
    return touch(runs.get(releaseItemId)!, { status: 'failed', finishedAt: nowIso(), errorMessage: 'deploy 실행에 실패했습니다.' })
  }
  procs.set(releaseItemId, child)
  child.stdout?.on('data', (d: Buffer) =>
    d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => addLog(releaseItemId, l))
  )
  child.stderr?.on('data', (d: Buffer) =>
    d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => addLog(releaseItemId, l))
  )
  child.on('error', (e) => addLog(releaseItemId, `배포 오류: ${maskSecrets(e.message)}`))
  child.on('close', (code) => {
    procs.delete(releaseItemId)
    const cur = runs.get(releaseItemId)
    if (!cur || cur.status === 'cancelled') return
    touch(cur, {
      status: code === 0 ? 'deployed' : 'failed',
      exitCode: code ?? -1,
      finishedAt: nowIso(),
      logLines: [...cur.logLines, code === 0 ? '배포가 완료되었습니다.' : '배포가 실패했습니다. 로그를 확인해주세요.']
    })
  })
  return run
}

/** Cancel a running deployment (only the process this app started). */
export function cancelDeployment(releaseItemId: string): DeploymentRun | null {
  const proc = procs.get(releaseItemId)
  if (proc) {
    try {
      proc.kill()
    } catch {
      /* already gone */
    }
    procs.delete(releaseItemId)
  }
  const run = runs.get(releaseItemId)
  if (!run) return null
  return touch(run, { status: 'cancelled', finishedAt: nowIso(), logLines: [...run.logLines, '배포를 중지했습니다.'] })
}
