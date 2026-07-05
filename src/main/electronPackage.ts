import { app } from 'electron'
import { type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  ElectronPackageRun,
  ElectronPackagingConfig,
  PackagePreflight,
  PackageReadiness,
  PackageScriptName,
  PackagingTool
} from '@shared/electronPackage'
import { PACKAGE_OUTPUT_DIRS, PACKAGE_SCRIPT_PRIORITY } from '@shared/electronPackage'
import { maskSecrets, validateDeployScript } from '@shared/deployment'
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

// --- packaging configuration center ----------------------------------------

const CONFIG_ID = 'sj-packaging-config'

function detectPackagingTool(pkg: {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}): PackagingTool {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  const scriptText = Object.values(pkg.scripts ?? {}).join(' ').toLowerCase()
  const hasBuilder = !!deps['electron-builder'] || scriptText.includes('electron-builder')
  const hasForge =
    !!deps['@electron-forge/cli'] ||
    !!deps['@electron-forge/maker-squirrel'] ||
    !!deps['@electron-forge/maker-zip'] ||
    scriptText.includes('electron-forge')
  if (hasBuilder) return 'electron-builder'
  if (hasForge) return 'electron-forge'
  return 'none'
}

/**
 * Read-only inspection that builds a packaging-config proposal from package.json.
 * Proposes packaging scripts ONLY for a tool that is already installed; never
 * proposes a dependency install and never modifies package.json here.
 */
export function inspectPackagingConfig(): ElectronPackagingConfig {
  const pkg = (readPkg() ?? {}) as {
    name?: string
    version?: string
    productName?: string
    scripts?: Record<string, string>
    build?: unknown
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const scripts = pkg.scripts ?? {}
  const tool = detectPackagingTool(pkg)
  const hasPackageScript = typeof scripts.package === 'string'
  const hasDistScript = typeof scripts.dist === 'string'
  const hasMakeScript = typeof scripts.make === 'string'
  const hasElectronBuildScript = typeof scripts['electron:build'] === 'string'

  const proposedScripts: ElectronPackagingConfig['proposedScripts'] = {}
  const proposedMetadata: ElectronPackagingConfig['proposedMetadata'] = {}
  const manualSetupInstructions: string[] = []
  const riskNotes: string[] = []
  let status: ElectronPackagingConfig['status']

  if (tool === 'electron-builder') {
    if (!hasDistScript) proposedScripts.dist = 'electron-builder'
    // Only propose metadata when a build config is absent (never overwrite).
    if (!pkg.build) {
      proposedMetadata.productName = 'SJ OS'
      proposedMetadata.appId = 'com.sjinvest.sjos'
      proposedMetadata.directories = { output: 'release' }
      riskNotes.push('기존 build 설정이 없어 기본 메타데이터를 제안합니다. 적용 전 확인하세요.')
    } else {
      riskNotes.push('기존 build 설정이 있어 메타데이터는 덮어쓰지 않습니다.')
    }
    status = Object.keys(proposedScripts).length > 0 || Object.keys(proposedMetadata).length > 0 ? 'proposal-ready' : 'ready'
  } else if (tool === 'electron-forge') {
    if (!hasMakeScript) proposedScripts.make = 'electron-forge make'
    if (!hasPackageScript) proposedScripts.package = 'electron-forge package'
    status = Object.keys(proposedScripts).length > 0 ? 'proposal-ready' : 'ready'
  } else {
    status = 'missing-tool'
    manualSetupInstructions.push(
      'electron-builder 설치 (권장, 간단한 Windows 설치파일): npm install -D electron-builder',
      '설치 후 이 화면에서 다시 “패키징 설정 확인”을 눌러 제안을 받으세요.'
    )
    riskNotes.push('패키징 도구가 없어 package.json을 수정하지 않습니다. 설치는 대표님이 직접 진행하세요.')
  }

  return {
    id: CONFIG_ID,
    status,
    appName: pkg.name ?? 'unknown',
    version: pkg.version ?? '0.0.0',
    detectedTool: tool,
    hasPackageScript,
    hasDistScript,
    hasMakeScript,
    hasElectronBuildScript,
    proposedScripts,
    proposedMetadata,
    manualSetupInstructions,
    riskNotes,
    updatedAt: nowIso()
  }
}

/**
 * Apply the approved packaging config to package.json. Writes ONLY the proposed
 * scripts/metadata that are missing (never overwrites existing keys or build
 * config), and only when the detected tool still exists. Validated + safe.
 */
export function applyApprovedPackagingConfig(): ElectronPackagingConfig {
  const config = inspectPackagingConfig()
  if (!sameWorkspace(mainWorkspace(), ALLOWED_WORKSPACE_MAIN)) {
    return { ...config, status: 'blocked', errorMessage: '허용된 작업 폴더가 아닙니다.' }
  }
  if (config.detectedTool === 'none' || config.detectedTool === 'unknown') {
    return {
      ...config,
      status: 'missing-tool',
      errorMessage: '패키징 도구가 없습니다. electron-builder 또는 electron-forge 설치가 필요합니다.'
    }
  }
  // Validate every proposed script string.
  for (const s of Object.values(config.proposedScripts)) {
    if (typeof s === 'string') {
      const v = validateDeployScript(s)
      if (!v.safe) return { ...config, status: 'blocked', errorMessage: `안전하지 않은 스크립트: ${v.reasons.join(', ')}` }
    }
  }
  const read = readPkg()
  if (!read) return { ...config, status: 'failed', errorMessage: 'package.json을 읽지 못했습니다.' }

  try {
    const pkg = read as {
      scripts?: Record<string, string>
      productName?: string
      build?: { appId?: string; productName?: string; directories?: { output?: string } }
    }
    const scripts = { ...(pkg.scripts ?? {}) }
    // Add only MISSING scripts (never overwrite existing).
    if (config.proposedScripts.dist && !scripts.dist) scripts.dist = config.proposedScripts.dist
    if (config.proposedScripts.package && !scripts.package) scripts.package = config.proposedScripts.package
    if (config.proposedScripts.make && !scripts.make) scripts.make = config.proposedScripts.make
    if (config.proposedScripts.electronBuild && !scripts['electron:build']) scripts['electron:build'] = config.proposedScripts.electronBuild
    pkg.scripts = scripts

    // Add metadata only if absent (never overwrite existing build config).
    if (config.proposedMetadata.productName && !pkg.productName) pkg.productName = config.proposedMetadata.productName
    if (Object.keys(config.proposedMetadata).length > 0 && !pkg.build) {
      pkg.build = {
        appId: config.proposedMetadata.appId,
        productName: config.proposedMetadata.productName,
        directories: config.proposedMetadata.directories
      }
    }

    writeFileSync(join(mainWorkspace(), 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    const applied = inspectPackagingConfig()
    return { ...applied, status: 'applied', appliedAt: nowIso() }
  } catch (e) {
    return { ...config, status: 'failed', errorMessage: e instanceof Error ? e.message : 'package.json 저장 실패' }
  }
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
