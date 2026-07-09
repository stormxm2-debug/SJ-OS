/**
 * PWA auto-update — no service worker needed.
 *
 * The web build emits `version.json` containing a unique build id (see
 * vite.config.web.ts). Phones that keep the PWA open for days never re-request
 * index.html, so they keep running the old bundle after a deploy. This module
 * remembers the build id it started with and re-checks the server copy whenever
 * the app comes back to the foreground (and every 15 minutes while open). When
 * the server id differs, the page reloads once and the phone is on the new build.
 *
 * - Electron/dev: version.json does not exist → first fetch fails → checks stop.
 * - `cache: 'no-store'` bypasses the HTTP cache so we always see the live deploy.
 */

const CHECK_INTERVAL_MS = 15 * 60 * 1000

let startedWith: string | null = null
let disabled = false
let reloading = false

async function fetchBuildId(): Promise<string | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as { buildId?: unknown }
    return typeof body.buildId === 'string' ? body.buildId : null
  } catch {
    return null
  }
}

async function check(): Promise<void> {
  if (disabled || reloading) return
  const id = await fetchBuildId()
  if (!id) {
    // Not a hosted web build (dev server / Electron) — stop checking entirely.
    if (startedWith === null) disabled = true
    return
  }
  if (startedWith === null) {
    startedWith = id
    return
  }
  if (id !== startedWith) {
    reloading = true
    window.location.reload()
  }
}

/** Start update checks: at boot, on foreground resume, and on a slow interval. */
export function startAppUpdateWatcher(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  void check()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void check()
  }, CHECK_INTERVAL_MS)
}
