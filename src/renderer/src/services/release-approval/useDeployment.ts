import { useCallback, useEffect, useState } from 'react'
import type { DeploymentRun } from '@shared/deployment'

/**
 * Renderer hook for the approved deployment runner. Subscribes to deployment run
 * updates streamed from Electron main. The renderer NEVER runs shell — it sends
 * only a release item id. The listener is cleaned up on unmount.
 */

function api(): Window['sj']['deploy'] | undefined {
  return typeof window !== 'undefined' ? window.sj?.deploy : undefined
}

export interface UseDeployment {
  runs: Record<string, DeploymentRun>
  scriptExists: boolean | null
  available: boolean
  preflight: (releaseItemId: string) => Promise<void>
  runApproved: (releaseItemId: string) => Promise<void>
  cancel: (releaseItemId: string) => Promise<void>
}

export function useDeployment(): UseDeployment {
  const [runs, setRuns] = useState<Record<string, DeploymentRun>>({})
  const [scriptExists, setScriptExists] = useState<boolean | null>(null)
  const available = !!api()

  useEffect(() => {
    const bridge = api()
    if (!bridge) return
    let active = true
    void bridge.scriptExists().then((v) => {
      if (active) setScriptExists(v)
    })
    const off = bridge.onRunUpdate(({ run }) => setRuns((p) => ({ ...p, [run.releaseItemId]: run })))
    return () => {
      active = false
      off()
    }
  }, [])

  const preflight = useCallback(async (id: string): Promise<void> => {
    const r = await api()?.preflight(id)
    if (r) setRuns((p) => ({ ...p, [id]: r }))
  }, [])
  const runApproved = useCallback(async (id: string): Promise<void> => {
    const r = await api()?.runApproved(id)
    if (r) setRuns((p) => ({ ...p, [id]: r }))
  }, [])
  const cancel = useCallback(async (id: string): Promise<void> => {
    await api()?.cancel(id)
  }, [])

  return { runs, scriptExists, available, preflight, runApproved, cancel }
}
