import { useEffect, useRef } from 'react'
import { getBackendConfig } from './backendConfig'
import { initSupabaseClient, getSupabaseClient } from './supabaseClient'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Realtime sync — subscribe to Postgres change events on the given tables and fire
 * `onChange` when any INSERT/UPDATE/DELETE lands. Callers typically pass their own
 * `load()` so the screen re-fetches instantly when another device writes data.
 *
 * - Active ONLY in Supabase mode (no-op for local-mock).
 * - RLS still applies to realtime: a client is notified only about rows it may SELECT
 *   (owner=all, team-leader=team, fc=own), so no data leaks through the socket.
 * - The `onChange` identity may change every render; we hold it in a ref so the
 *   subscription is created once per table set (pass a STABLE `tables` array — e.g. a
 *   module-level constant — so the channel isn't torn down each render).
 * - MOBILE: phones kill the websocket when the PWA is backgrounded or the screen
 *   locks, and the channel does not always recover on its own. When the app returns
 *   to the foreground (visibilitychange) or the network comes back (online), we
 *   immediately re-fetch AND rebuild the subscription so the screen is never stale.
 */
export function useRealtimeSync(tables: string[], onChange: () => void): void {
  const cb = useRef(onChange)
  cb.current = onChange
  const key = tables.join(',')

  useEffect(() => {
    if (getBackendConfig().mode !== 'supabase') return
    let active = true
    let channel: any = null
    let debounce: number | undefined
    let generation = 0

    const ping = (): void => {
      // Debounce bursts (e.g. multi-row writes) into a single reload.
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => {
        if (active) cb.current()
      }, 250)
    }

    const teardown = (): void => {
      if (channel) {
        try {
          channel.unsubscribe()
        } catch {
          /* ignore */
        }
        channel = null
      }
    }

    const subscribe = async (): Promise<void> => {
      const gen = ++generation
      const client: any = (await initSupabaseClient()) ?? getSupabaseClient()
      if (!client || !active || gen !== generation || typeof client.channel !== 'function') return
      teardown()
      // Unique channel name per (re)subscribe: reusing a closed channel's topic can
      // silently join a dead channel on some supabase-js versions.
      channel = client.channel(`sj-rt-${key}-${gen}`)
      for (const table of key.split(',')) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, ping)
      }
      channel.subscribe((status: string) => {
        // If the socket errors/times out while we are in the foreground, rebuild it.
        if (!active || gen !== generation) return
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          window.setTimeout(() => {
            if (active && gen === generation && document.visibilityState === 'visible') void subscribe()
          }, 3000)
        }
      })
    }

    // Foreground/online resume: re-fetch now (we may have missed events while the
    // socket was dead) and rebuild the subscription.
    const resume = (): void => {
      if (!active) return
      cb.current()
      void subscribe()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') resume()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', resume)

    void subscribe()

    return () => {
      active = false
      generation++
      window.clearTimeout(debounce)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', resume)
      teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
