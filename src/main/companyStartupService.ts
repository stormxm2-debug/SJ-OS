import { app, BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  createInitialStartupState,
  type CompanyStartupSnapshot,
  type CompanyStartupStep,
  type CompanyStartupBacklogSnapshot,
  buildExecutiveBriefing,
  isNodeVersionSupported
} from '@shared/startup'
import { STARTUP_BACKLOG, STARTUP_RELEASES } from '@shared/companyStartupBacklog'

export class CompanyStartupService {
  private readonly rootDir: string
  private readonly listeners = new Set<(snapshot: CompanyStartupSnapshot) => void>()
  private snapshot: CompanyStartupSnapshot = createInitialStartupState()
  private rendererReady = false
  private rendererReadyResolver: (() => void) | null = null
  private startupPromise: Promise<CompanyStartupSnapshot> | null = null

  constructor(rootDir = app.getAppPath()) {
    this.rootDir = rootDir
  }

  public subscribe(listener: (snapshot: CompanyStartupSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public getSnapshot(): CompanyStartupSnapshot {
    return this.cloneSnapshot(this.snapshot)
  }

  public start(): Promise<CompanyStartupSnapshot> {
    if (this.startupPromise) return this.startupPromise

    this.startupPromise = this.runPipeline()
    return this.startupPromise
  }

  public notifyRendererReady(): void {
    this.rendererReady = true
    this.rendererReadyResolver?.()
    this.rendererReadyResolver = null
    this.publish()
  }

  private async runPipeline(): Promise<CompanyStartupSnapshot> {
    this.rendererReady = false
    this.rendererReadyResolver = null
    this.snapshot = createInitialStartupState()
    this.snapshot.isRunning = true
    this.snapshot.status = 'running'
    this.snapshot.startedAt = Date.now()
    this.snapshot.companyStatus = 'Starting'
    this.snapshot.activeStep = 'initializing_repository'
    this.publish()

    try {
      await this.runStep('initializing_repository', 'Initializing Repository...', async () => {
        await this.ensureGitRepository()
      })

      await this.runStep('checking_node', 'Checking Node.js...', async () => {
        const version = process.version
        const supported = version.startsWith('v') ? version : `v${version}`
        if (!version) {
          throw new Error('Unable to determine Node.js version.')
        }
        if (!isNodeVersionSupported(supported)) {
          throw new Error(`Unsupported Node.js version ${supported}. Please use Node.js 18.17+ or newer.`)
        }
        this.snapshot.companyStatus = 'Checking dependencies'
      })

      await this.runStep('checking_dependencies', 'Checking Dependencies...', async () => {
        const needsInstall = await this.shouldInstallDependencies()
        if (needsInstall) {
          await this.runCommand('npm', ['install'], this.rootDir, 'Installing dependencies...')
          await this.persistLockfileHash()
          return 'completed' as const
        }
        this.setStepStatus('checking_dependencies', 'skipped', 'Dependencies already satisfied.')
        return 'skipped' as const
      })

      await this.runStep('typechecking', 'Typechecking...', async () => {
        await this.runCommand('npm', ['run', 'typecheck'], this.rootDir, 'Typecheck failed.')
      })

      await this.runStep('building', 'Building...', async () => {
        await this.runCommand('npm', ['run', 'build'], this.rootDir, 'Build failed.')
      })

      await this.runStep('launching_electron', 'Launching Electron...', async () => {
        this.snapshot.companyStatus = 'Launching'
        BrowserWindow.getAllWindows().forEach((window) => window.show())
      })

      await this.runStep('connecting_workers', 'Connecting AI Workers...', async () => {
        await this.delay(600)
      })

      await this.runStep('reading_backlog', 'Reading Product Backlog...', async () => {
        const backlog = this.deriveBacklogSnapshot()
        this.snapshot.currentRelease = backlog.currentRelease
        this.snapshot.currentSprint = backlog.currentSprint
        this.snapshot.nextPriority = backlog.nextPriority
        this.snapshot.activeWorkers = backlog.activeWorkers
        this.snapshot.todaysObjectives = backlog.todaysObjectives
      })

      await this.runStep('generating_briefing', 'Generating Executive Briefing...', async () => {
        const briefing = buildExecutiveBriefing(this.deriveBacklogSnapshot(), this.snapshot.activeWorkers)
        this.snapshot.todaysObjectives = briefing.objectives
        this.snapshot.nextPriority = briefing.headline
      })

      await this.waitForRendererReady()
      this.snapshot.companyStatus = 'Ready'
      this.snapshot.status = 'ready'
      this.snapshot.durationMs = Date.now() - this.snapshot.startedAt!
      this.snapshot.completedAt = Date.now()
      this.setStepStatus('company_ready', 'completed', 'Company is ready for the CEO.')
      this.snapshot.activeStep = 'company_ready'
      this.publish()
      return this.cloneSnapshot(this.snapshot)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown startup error.'
      this.snapshot.status = 'failed'
      this.snapshot.error = message
      this.snapshot.companyStatus = 'Needs attention'
      this.snapshot.durationMs = Date.now() - this.snapshot.startedAt!
      this.snapshot.completedAt = Date.now()
      this.publish()
      return this.cloneSnapshot(this.snapshot)
    } finally {
      this.startupPromise = null
    }
  }

  private async ensureGitRepository(): Promise<void> {
    const status = await this.runCommand('git', ['status', '--short'], this.rootDir, 'Repository check failed.')
    const remoteStatus = await this.runCommand('git', ['remote'], this.rootDir, 'Repository remote check failed.')
    if (!remoteStatus.stdout.trim()) {
      this.setStepStatus('initializing_repository', 'completed', 'Repository is local-only; no remote configured.')
      return
    }

    await this.runCommand('git', ['fetch', '--all', '--prune'], this.rootDir, 'Failed to fetch remote updates.')
    const aheadBehind = await this.runCommand(
      'git',
      ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
      this.rootDir,
      'Unable to compare local and remote commits.'
    )
    const [behind] = aheadBehind.stdout.trim().split(/\s+/).map((value) => Number(value))
    if (behind > 0) {
      await this.runCommand('git', ['pull', '--ff-only'], this.rootDir, 'Automatic git pull failed.')
      this.setStepStatus('initializing_repository', 'completed', 'Pulled the latest repository changes.')
      return
    }

    this.setStepStatus('initializing_repository', 'completed', 'Repository already matches the remote.')
  }

  private async shouldInstallDependencies(): Promise<boolean> {
    const packageLockPath = join(this.rootDir, 'package-lock.json')
    const nodeModulesPath = join(this.rootDir, 'node_modules')
    const statePath = join(this.rootDir, '.sj-startup-state.json')

    const currentHash = await this.getFileHash(packageLockPath)
    let previousHash: string | null = null

    try {
      const state = await fs.readFile(statePath, 'utf8')
      previousHash = JSON.parse(state).packageLockHash ?? null
    } catch {
      previousHash = null
    }

    const nodeModulesPresent = await this.exists(nodeModulesPath)
    return !nodeModulesPresent || previousHash !== currentHash || currentHash.length === 0
  }

  private async persistLockfileHash(): Promise<void> {
    const packageLockPath = join(this.rootDir, 'package-lock.json')
    const statePath = join(this.rootDir, '.sj-startup-state.json')
    const hash = await this.getFileHash(packageLockPath)
    await fs.writeFile(statePath, JSON.stringify({ packageLockHash: hash }, null, 2))
  }

  private async getFileHash(filePath: string): Promise<string> {
    try {
      const data = await fs.readFile(filePath)
      return Buffer.from(data).toString('base64')
    } catch {
      return ''
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path)
      return true
    } catch {
      return false
    }
  }

  private async waitForRendererReady(): Promise<void> {
    if (this.rendererReady) return
    await new Promise<void>((resolve) => {
      this.rendererReadyResolver = resolve
      setTimeout(() => {
        if (this.rendererReadyResolver === resolve) {
          this.rendererReadyResolver = null
          resolve()
        }
      }, 5000)
    })
  }

  private async runStep(stepId: string, label: string, action: () => Promise<CompanyStartupStep['status'] | void>): Promise<void> {
    this.setStepStatus(stepId, 'running', label)
    this.snapshot.activeStep = stepId
    this.publish()

    try {
      const status = await action()
      if (status) {
        this.setStepStatus(stepId, status, label)
      } else {
        this.setStepStatus(stepId, 'completed', label)
      }
      this.publish()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown startup error.'
      this.setStepStatus(stepId, 'failed', message)
      this.publish()
      throw error
    }
  }

  private setStepStatus(stepId: string, status: CompanyStartupStep['status'], detail?: string): void {
    this.snapshot.steps = this.snapshot.steps.map((step) =>
      step.id === stepId ? { ...step, status, detail } : step
    )
    this.publish()
  }

  private publish(): void {
    const snapshot = this.cloneSnapshot(this.snapshot)
    this.listeners.forEach((listener) => listener(snapshot))
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('company:startup:state', snapshot)
    })
  }

  private cloneSnapshot(snapshot: CompanyStartupSnapshot): CompanyStartupSnapshot {
    return {
      ...snapshot,
      steps: snapshot.steps.map((step) => ({ ...step }))
    }
  }

  private deriveBacklogSnapshot(): CompanyStartupBacklogSnapshot {
    const planned = [...STARTUP_BACKLOG].filter((item) => item.status !== 'completed').sort((left, right) => {
      const priorityOrder = { P0: 0, P1: 1, P2: 2 } as const
      return priorityOrder[left.priority] - priorityOrder[right.priority]
    })

    const nextPriority = planned.find((item) => item.priority === 'P0')?.title ?? STARTUP_BACKLOG[0]?.title ?? 'Customer Journey'
    const release = STARTUP_RELEASES.find((entry) => entry.id === STARTUP_BACKLOG.find((item) => item.title === nextPriority)?.releaseId)?.name ?? STARTUP_RELEASES[0]?.name ?? 'Release 1'
    const objectives = planned.slice(0, 3).map((item) => item.title)

    return {
      currentRelease: release,
      currentSprint: 'Sprint 1',
      nextPriority,
      activeWorkers: Math.max(4, Math.min(8, planned.length + 2)),
      todaysObjectives: objectives.length > 0 ? objectives : ['Review priorities', 'Keep the company healthy']
    }
  }

  private async runCommand(command: string, args: string[], cwd: string, errorMessage: string): Promise<{ stdout: string; stderr: string }> {
    const executable = process.platform === 'win32' ? `${command}.cmd` : command
    return new Promise((resolve, reject) => {
      execFile(executable, args, { cwd, shell: false }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${errorMessage}\n${stderr || error.message}`))
          return
        }
        resolve({ stdout, stderr })
      })
    })
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
}
