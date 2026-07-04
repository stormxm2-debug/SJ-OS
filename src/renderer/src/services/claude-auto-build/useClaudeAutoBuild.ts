import { useCallback, useEffect, useState } from 'react'
import type {
  ClaudeAutoBuildJob,
  ClaudeAutoBuildSource,
  ClaudeRunnerDiagnostics,
  ClaudeSmokeTestResult
} from '@shared/claudeAutoBuild'
import { ALLOWED_WORKSPACE } from '@renderer/services/claude-code/claudeCodeBridge'
import { deriveTitle, generateAutoBuildPrompt } from './promptGenerator'
import {
  getRunnerDiagnostics,
  refreshRunnerDiagnostics,
  runSmokeTest,
  subscribeDiagnostics
} from './runnerDiagnostics'

/**
 * Renderer hook for the Jarvis → Claude Code Auto Builder. It subscribes to job
 * updates streamed from the Electron main process and exposes safe actions. The
 * renderer NEVER executes shell commands — it only sends a validated prompt + job
 * id over IPC. The update listener is added once and cleaned up on unmount (never
 * a permanent global listener).
 */

function api(): Window['sj']['claudeBuild'] | undefined {
  return typeof window !== 'undefined' ? window.sj?.claudeBuild : undefined
}

export function isAutoBuildAvailable(): boolean {
  return !!api()
}

export interface UseClaudeAutoBuild {
  jobs: ClaudeAutoBuildJob[]
  available: boolean
  diagnostics: ClaudeRunnerDiagnostics | null
  checking: boolean
  envReady: boolean
  createFromCommand: (command: string, source?: ClaudeAutoBuildSource) => Promise<ClaudeAutoBuildJob | null>
  runJob: (id: string) => Promise<void>
  cancelJob: (id: string) => Promise<void>
  checkEnvironment: () => Promise<void>
  smokeTest: () => Promise<ClaudeSmokeTestResult | null>
}

export function useClaudeAutoBuild(): UseClaudeAutoBuild {
  const [jobs, setJobs] = useState<ClaudeAutoBuildJob[]>([])
  const [diagnostics, setDiagnostics] = useState<ClaudeRunnerDiagnostics | null>(getRunnerDiagnostics())
  const [checking, setChecking] = useState(false)
  const available = isAutoBuildAvailable()

  // Mirror the shared diagnostics store.
  useEffect(() => subscribeDiagnostics(() => setDiagnostics(getRunnerDiagnostics())), [])

  useEffect(() => {
    const bridge = api()
    if (!bridge) return
    let active = true
    void bridge.listJobs().then((list) => {
      if (active) setJobs(list)
    })
    const off = bridge.onJobUpdate(({ job }) => {
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === job.id)
        if (idx === -1) return [job, ...prev]
        const next = prev.slice()
        next[idx] = job
        return next
      })
    })
    return () => {
      active = false
      off()
    }
  }, [])

  const createFromCommand = useCallback(
    async (command: string, source: ClaudeAutoBuildSource = 'jarvis'): Promise<ClaudeAutoBuildJob | null> => {
      const bridge = api()
      if (!bridge) return null
      return bridge.createJob({
        title: deriveTitle(command),
        source,
        originalUserCommand: command,
        generatedPrompt: generateAutoBuildPrompt(command),
        workspacePath: ALLOWED_WORKSPACE
      })
    },
    []
  )

  const runJob = useCallback(async (id: string): Promise<void> => {
    await api()?.runJob(id)
  }, [])

  const cancelJob = useCallback(async (id: string): Promise<void> => {
    await api()?.cancelJob(id)
  }, [])

  const checkEnvironment = useCallback(async (): Promise<void> => {
    setChecking(true)
    try {
      await refreshRunnerDiagnostics()
    } finally {
      setChecking(false)
    }
  }, [])

  const smokeTest = useCallback((): Promise<ClaudeSmokeTestResult | null> => runSmokeTest(), [])

  return {
    jobs,
    available,
    diagnostics,
    checking,
    envReady: diagnostics?.canRun === true,
    createFromCommand,
    runJob,
    cancelJob,
    checkEnvironment,
    smokeTest
  }
}
