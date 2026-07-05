import { useCallback, useEffect, useState } from 'react'
import type { ParallelBuildJob } from '@shared/claudeParallel'

/**
 * Renderer hook for the worktree-based parallel builder. Subscribes to parallel
 * job updates streamed from Electron main. The renderer NEVER runs git/Claude —
 * it only sends a source job id. The listener is cleaned up on unmount.
 */

function api(): Window['sj']['claudeParallel'] | undefined {
  return typeof window !== 'undefined' ? window.sj?.claudeParallel : undefined
}

export function isParallelAvailable(): boolean {
  return !!api()
}

export interface UseClaudeParallel {
  parallelJobs: ParallelBuildJob[]
  available: boolean
  prepareWorktree: (sourceJobId: string) => Promise<void>
  runWorktreeJob: (sourceJobId: string) => Promise<void>
}

export function useClaudeParallel(): UseClaudeParallel {
  const [parallelJobs, setParallelJobs] = useState<ParallelBuildJob[]>([])
  const available = isParallelAvailable()

  useEffect(() => {
    const bridge = api()
    if (!bridge) return
    let active = true
    void bridge.listJobs().then((list) => {
      if (active) setParallelJobs(list)
    })
    const off = bridge.onJobUpdate(({ job }) => {
      setParallelJobs((prev) => {
        const idx = prev.findIndex((j) => j.sourceJobId === job.sourceJobId)
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

  const prepareWorktree = useCallback(async (sourceJobId: string): Promise<void> => {
    await api()?.prepareWorktree(sourceJobId)
  }, [])
  const runWorktreeJob = useCallback(async (sourceJobId: string): Promise<void> => {
    await api()?.runWorktreeJob(sourceJobId)
  }, [])

  return { parallelJobs, available, prepareWorktree, runWorktreeJob }
}
