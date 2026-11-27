/**
 * PWA auto-update — no service worker needed.
 *
 * The web build emits `version.json` containing a unique build id (see
 * vite.config.web.ts). Phones that keep the PWA open for days never re-request
 * index.html, so they keep running the old bundle after a deploy. This module
 * remembers the build id it started with and re-checks the server copy whenever
 * the app comes back to the foreground (on focus / tab show / network regained,
 * and on a short interval while open). When the server id differs, the page
 * reloads once and the phone is on the new build.
 *
 * - Electron/dev: version.json does not exist → first fetch fails → checks stop.
 * - `cache: 'no-store'` + `/version.json` no-store header (see public/_headers)
 *   bypass both browser and CDN caches so we always see the live deploy fast.
 * - A deploy never interrupts someone mid-typing (memo, form) — the reload waits
 *   for the next check once the field is no longer focused.
 */

// 열려 있는 앱은 2분마다 확인(앞으로 올 때는 즉시). version.json 요청은 아주 가벼워 부담 없음.
const CHECK_INTERVAL_MS = 2 * 60 * 1000

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

/** 메모·폼 입력 중에는 새로고침으로 내용을 날리지 않는다 — 다음 기회에 적용. */
function isEditing(): boolean {
  try {
    const el = document.activeElement as HTMLElement | null
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
  } catch {
    return false
  }
}

/** "업데이트 중" 짧은 안내 띠 — 사용자가 자동 갱신을 눈으로 확인할 수 있게. */
function showUpdatingBanner(): void {
  try {
    if (document.getElementById('sj-update-banner')) return
    const bar = document.createElement('div')
    bar.id = 'sj-update-banner'
    bar.setAttribute('role', 'status')
    bar.textContent = '새 버전으로 업데이트 중…'
    bar.style.cssText = [
      'position:fixed',
      'left:0',
      'right:0',
      'top:0',
      'z-index:2147483647',
      'background:#0e1e3a',
      'color:#fff',
      'text-align:center',
      'padding:10px 12px',
      'font-family:-apple-system,BlinkMacSystemFont,"Malgun Gothic",sans-serif',
      'font-size:13px',
      'font-weight:700',
      'letter-spacing:0.2px',
      'box-shadow:0 2px 8px rgba(0,0,0,0.25)'
    ].join(';')
    document.body.appendChild(bar)
  } catch {
    /* 띠를 못 그려도 새로고침은 진행된다 */
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
  if (id === startedWith) return
  // 새 버전 감지 — 입력 중이면 방해하지 않고 다음 확인 때 적용한다.
  if (isEditing()) return
  reloading = true
  showUpdatingBanner()
  // 띠를 잠깐 보여준 뒤 새로고침. /index.html 은 no-cache 라 최신 번들을 가리킨다.
  window.setTimeout(() => window.location.reload(), 600)
}

/** Start update checks: at boot, on foreground/focus/network, and on a short interval. */
export function startAppUpdateWatcher(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  void check()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
  // 데스크톱 탭 전환·창 포커스, 폰 앱 복귀(bfcache), 네트워크 재연결에서도 즉시 확인.
  window.addEventListener('focus', () => void check())
  window.addEventListener('pageshow', () => void check())
  window.addEventListener('online', () => void check())
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void check()
  }, CHECK_INTERVAL_MS)
}
