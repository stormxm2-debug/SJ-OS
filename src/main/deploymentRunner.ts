import { app } from 'electron'
import { type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { DeployPreflight, DeploymentRun } from '@shared/deployment'
import { maskSecrets } from '@shared/deployment'
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

/** Does package.json define a `deploy` script? (read-only; never executes it) */
export function deployScriptExists(): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(mainWorkspace(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    return typeof pkg.scripts?.deploy === 'string' && pkg.scripts.deploy.trim().length > 0
  } catch {
    return false
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
