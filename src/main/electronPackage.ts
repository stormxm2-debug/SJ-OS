import { app } from 'electron'
import { type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  ElectronPackageRun,
  PackagePreflight,
  PackageReadiness,
  PackageScriptName
} from '@shared/electronPackage'
import { PACKAGE_OUTPUT_DIRS, PACKAGE_SCRIPT_PRIORITY } from '@shared/electronPackage'
import { maskSecrets } from '@shared/deployment'
import { spawnTool } from './claudeAutoBuild'

/**
 * Electron installer package center (MAIN only).
 *
 * SAFETY: only ever runs an EXISTING package script (`dist`/`package`/`make`/
 * `electron:build`) plus preflight (`npm run typecheck`/`build`, `git status`). It
 * never invents a script, never installs dependencies, never publishes or uploads.
 * Fixed args arrays (no shell string); log lines are secret-masked. Output folder
 * hints are limited to inside the workspace.
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

let emitRun: (run: ElectronPackageRun) => void = () => {}
export function setPackageEmitter(fn: (run: ElectronPackageRun) => void): void {
  emitRun = fn
}

const runs = new Map<string, ElectronPackageRun>()
const procs = new Map<string, ChildProcess>()

function touch(run: ElectronPackageRun, patch: Partial<ElectronPackageRun>): ElectronPackageRun {
  const next: ElectronPackageRun = { ...run, ...patch }
  runs.set(next.id, next)
  emitRun(next)
  return next
}
function addLog(id: string, line: string): void {
  const run = runs.get(id)
  if (!run) return
  touch(run, { logLines: [...run.logLines, maskSecrets(line)].slice(-300) })
}

function readPkg(): { scripts?: Record<string, string>; name?: string; version?: string; build?: unknown; devDependencies?: Record<string, string> } | null {
  try {
    return JSON.parse(readFileSync(join(mainWorkspace(), 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/** The package script to run, by priority; 'none' if none exist. */
function detectPackageScript(scripts: Record<string, string>): PackageScriptName {
  for (const name of PACKAGE_SCRIPT_PRIORITY) {
    if (typeof scripts[name] === 'string' && scripts[name].trim().length > 0) return name
  }
  return 'none'
}

/** Read-only packaging readiness inspection. */
export function inspectPackageReadiness(): PackageReadiness {
  const pkg = readPkg()
  const scripts = pkg?.scripts ?? {}
  const detected = detectPackageScript(scripts)
  const allScriptText = Object.values(scripts).join(' ').toLowerCase()
  return {
    appName: pkg?.name ?? 'unknown',
    version: pkg?.version ?? '0.0.0',
    hasPackage: typeof scripts.package === 'string',
    hasDist: typeof scripts.dist === 'string',
    hasMake: typeof scripts.make === 'string',
    hasElectronBuild: typeof scripts['electron:build'] === 'string',
    detectedPackageScript: detected,
    packageScriptCommand: detected === 'none' ? undefined : scripts[detected],
    usesElectronBuilder: !!pkg?.devDependencies?.['electron-builder'] || allScriptText.includes('electron-builder'),
    usesElectronForge: !!pkg?.devDependencies?.['@electron-forge/cli'] || allScriptText.includes('electron-forge'),
    buildConfigPresent: !!pkg?.build,
    hasTypecheck: typeof scripts.typecheck === 'string',
    hasBuild: typeof scripts.build === 'string'
  }
}

function baseRun(id: string): ElectronPackageRun {
  const existing = runs.get(id)
  if (existing) return existing
  const r = inspectPackageReadiness()
  return {
    id,
    title: `${r.appName} 설치파일 패키지`,
    version: r.version,
    status: 'not-ready',
    detectedPackageScript: r.detectedPackageScript,
    packageScriptCommand: r.packageScriptCommand,
    outputHints: [],
    logLines: []
  }
}

export function getPackageRun(id: string): ElectronPackageRun | null {
  return runs.get(id) ?? null
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

function existingOutputDirs(): string[] {
  return PACKAGE_OUTPUT_DIRS.filter((d) => existsSync(join(mainWorkspace(), d)))
}

async function computePreflight(id: string): Promise<PackagePreflight> {
  const readiness = inspectPackageReadiness()
  addLog(id, '$ npm run typecheck')
  const tc = await runFixed('npm', ['run', 'typecheck'])
  addLog(id, `typecheck exit ${tc.code}`)
  addLog(id, '$ npm run build')
  const bd = await runFixed('npm', ['run', 'build'])
  addLog(id, `build exit ${bd.code}`)
  const gs = await runFixed('git', ['status', '--short'])
  return {
    typecheckStatus: tc.code === 0 ? 'passed' : 'failed',
    buildStatus: bd.code === 0 ? 'passed' : 'failed',
    gitStatusShort: gs.out.trim().slice(0, 2000),
    packageScriptExists: readiness.detectedPackageScript !== 'none',
    packageJsonVersion: readiness.version
  }
}

/** Run preflight only (no packaging). */
export async function runPackagePreflight(id: string): Promise<ElectronPackageRun> {
  touch(baseRun(id), { status: 'preflight-running', logLines: [...(runs.get(id)?.logLines ?? []), '배포 전 검사 시작…'] })
  const preflight = await computePreflight(id)
  const passed =
    preflight.typecheckStatus === 'passed' && preflight.buildStatus === 'passed' && preflight.packageScriptExists
  return touch(runs.get(id)!, {
    status: passed ? 'preflight-passed' : 'blocked',
    preflight,
    errorMessage: preflight.packageScriptExists
      ? undefined
      : 'package.json에 설치파일 빌드 스크립트가 없습니다. 패키징 설정이 필요합니다.'
  })
}

/** Run the approved package build using the EXISTING detected script. */
export async function runApprovedPackageBuild(id: string): Promise<ElectronPackageRun> {
  if (!sameWorkspace(mainWorkspace(), ALLOWED_WORKSPACE_MAIN)) {
    return touch(baseRun(id), { status: 'blocked', errorMessage: '허용된 작업 폴더가 아닙니다.' })
  }
  const readiness = inspectPackageReadiness()
  if (readiness.detectedPackageScript === 'none') {
    return touch(baseRun(id), {
      status: 'blocked',
      errorMessage: 'package.json에 설치파일 빌드 스크립트가 없습니다. 패키징 설정이 필요합니다.'
    })
  }
  const pre = await runPackagePreflight(id)
  if (pre.status !== 'preflight-passed') {
    return touch(runs.get(id)!, { status: 'blocked', errorMessage: '배포 전 검사(typecheck/build)에 실패했습니다.' })
  }

  const scriptName = readiness.detectedPackageScript
  touch(runs.get(id)!, {
    status: 'packaging',
    startedAt: nowIso(),
    detectedPackageScript: scriptName,
    packageScriptCommand: readiness.packageScriptCommand,
    logLines: [...runs.get(id)!.logLines, `$ npm run ${scriptName}`]
  })

  let child: ChildProcess
  try {
    // Fixed command: `npm run <existing script>`. No shell string, no renderer input.
    child = spawnTool('npm', ['run', scriptName], { cwd: mainWorkspace(), windowsHide: true })
  } catch {
    return touch(runs.get(id)!, { status: 'failed', finishedAt: nowIso(), errorMessage: '패키지 빌드 실행에 실패했습니다.' })
  }
  procs.set(id, child)
  child.stdout?.on('data', (d: Buffer) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => addLog(id, l)))
  child.stderr?.on('data', (d: Buffer) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => addLog(id, l)))
  child.on('error', (e) => addLog(id, `패키지 빌드 오류: ${maskSecrets(e.message)}`))
  child.on('close', (code) => {
    procs.delete(id)
    const cur = runs.get(id)
    if (!cur || cur.status === 'cancelled') return
    touch(cur, {
      status: code === 0 ? 'packaged' : 'failed',
      exitCode: code ?? -1,
      finishedAt: nowIso(),
      outputHints: code === 0 ? existingOutputDirs() : cur.outputHints,
      logLines: [
        ...cur.logLines,
        code === 0 ? '설치파일 빌드 완료. 설치파일이 생성된 폴더를 확인하세요.' : '패키지 빌드가 실패했습니다. 로그를 확인해주세요.'
      ]
    })
  })
  return runs.get(id)!
}

/** Cancel a running package build (only this app's process). */
export function cancelPackageBuild(id: string): ElectronPackageRun | null {
  const proc = procs.get(id)
  if (proc) {
    try {
      proc.kill()
    } catch {
      /* already gone */
    }
    procs.delete(id)
  }
  const run = runs.get(id)
  if (!run) return null
  return touch(run, { status: 'cancelled', finishedAt: nowIso(), logLines: [...run.logLines, '패키지 빌드를 중지했습니다.'] })
}
