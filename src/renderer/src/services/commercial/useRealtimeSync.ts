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

    const ping = (): void => {
      // Debounce bursts (e.g. multi-row writes) into a single reload.
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => {
        if (active) cb.current()
      }, 250)
    }

    void (async () => {
      const client: any = (await initSupabaseClient()) ?? getSupabaseClient()
      if (!client || !active || typeof client.channel !== 'function') return
      channel = client.channel(`sj-rt-${key}`)
      for (const table of key.split(',')) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, ping)
      }
      channel.subscribe()
    })()

    // 폴링 백업: 실시간 소켓이 백신/네트워크에 막혀도 데이터가 따라오도록
    // 45초 주기 + 창으로 돌아올 때(focus/visible) 즉시 재조회한다.
    const poll = window.setInterval(ping, 45000)
    const onFocus = (): void => ping()
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') ping()
    }
    // pageshow(persisted)=모바일 bfcache 복원(뒤로가기/앱 재진입 — visibilitychange가 안 오는
    // iOS/인앱브라우저 케이스), online=네트워크 복구. 둘 다 즉시 재조회.
    const onPageShow = (): void => ping()
    const onOnline = (): void => ping()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', onOnline)

    return () => {
      active = false
      window.clearTimeout(debounce)
      window.clearInterval(poll)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', onOnline)
      if (channel) {
        try {
          channel.unsubscribe()
        } catch {
          /* ignore */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
