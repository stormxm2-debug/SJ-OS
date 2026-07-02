/**
 * Shared SJ AI Proxy configuration + auto-detection for the renderer.
 *
 * Both the GPT brain client and the STT proxy client resolve the proxy URL and
 * probe readiness through here, so they always agree on which backend to use.
 *
 * SECURITY: this module never holds or transmits an OpenAI API key. It only
 * knows candidate proxy URLs and reads the sanitized GET /ai/status response.
 *
 * Why multiple candidates? On Windows, `localhost` can resolve to IPv6 `::1`
 * while the proxy is reachable on IPv4 `127.0.0.1` (or vice versa). Trying both
 * — plus several accepted env-var names — makes local connection reliable
 * without requiring a .env.local when the default port works.
 */

/** Read a Vite env var (non-secret values only). */
function readEnv(key: string): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return env?.[key]
}

/** Trim whitespace and strip any trailing slashes. */
function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Fallback URLs tried when no env override resolves (IPv6 + IPv4 forms). */
const FALLBACK_URLS = ['http://localhost:8787', 'http://127.0.0.1:8787']

const STATUS_TIMEOUT_MS = 4000

/**
 * Ordered, normalized, de-duplicated proxy URL candidates:
 *   A. VITE_AI_PROXY_URL
 *   B. VITE_OPENAI_PROXY_URL
 *   C. VITE_JARVIS_PROXY_URL
 *   D. http://localhost:8787
 *   E. http://127.0.0.1:8787
 */
export function resolveProxyUrls(): string[] {
  const candidates = [
    readEnv('VITE_AI_PROXY_URL'),
    readEnv('VITE_OPENAI_PROXY_URL'),
    readEnv('VITE_JARVIS_PROXY_URL'),
    ...FALLBACK_URLS
  ]
    .map((u) => (u ? normalizeUrl(u) : ''))
    .filter((u) => u.length > 0)
  return Array.from(new Set(candidates))
}

/** The primary (preferred) proxy URL — first resolved candidate. */
export function primaryProxyUrl(): string {
  return resolveProxyUrls()[0] ?? FALLBACK_URLS[0]
}

/** Sanitized status + which URL answered. */
export interface ProxyDetection {
  reachable: boolean
  /** The candidate that answered, or null when none did. */
  selectedProxyUrl: string | null
  /** All candidates tried, in order. */
  triedUrls: string[]
  enabled: boolean
  apiKeyConfigured: boolean
  ready: boolean
  model: string | null
  sttModel: string | null
  maxAudioSeconds: number | null
  message: string
  lastError: string | null
  /** ISO timestamp of the probe (renderer clock). */
  checkedAt: string
}

interface AiStatusResponse {
  enabled?: boolean
  apiKeyConfigured?: boolean
  ready?: boolean
  model?: string
  sttModel?: string
  maxAudioSeconds?: number
  message?: string
}

/** The last URL that successfully answered — tried first on the next probe. */
let lastWorkingUrl: string | null = null

/** The most recent working proxy URL, or null if none has answered yet. */
export function getLastWorkingUrl(): string | null {
  return lastWorkingUrl
}

/**
 * The base URL to use for API calls: the last known-working URL when available,
 * otherwise the primary candidate. Cheap (no network); pair with a prior
 * detectProxyStatus() to populate the working URL.
 */
export function activeProxyUrl(): string {
  return lastWorkingUrl ?? primaryProxyUrl()
}

/**
 * Probe candidate proxy URLs' GET /ai/status and return the first reachable.
 * Never throws — an unreachable proxy is a normal result. The last working URL
 * is tried first on subsequent calls so repeat checks are fast.
 */
export async function detectProxyStatus(): Promise<ProxyDetection> {
  const candidates = resolveProxyUrls()
  const ordered =
    lastWorkingUrl && candidates.includes(lastWorkingUrl)
      ? [lastWorkingUrl, ...candidates.filter((u) => u !== lastWorkingUrl)]
      : candidates
  const checkedAt = new Date().toISOString()
  let lastError: string | null = null

  for (const url of ordered) {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS)
    try {
      const response = await fetch(`${url}/ai/status`, { signal: controller.signal })
      if (!response.ok) {
        lastError = `HTTP ${response.status} @ ${url}`
        continue
      }
      const data = (await response.json()) as AiStatusResponse
      lastWorkingUrl = url
      return {
        reachable: true,
        selectedProxyUrl: url,
        triedUrls: ordered,
        enabled: Boolean(data.enabled),
        apiKeyConfigured: Boolean(data.apiKeyConfigured),
        ready: Boolean(data.ready),
        model: data.model ?? null,
        sttModel: data.sttModel ?? null,
        maxAudioSeconds: typeof data.maxAudioSeconds === 'number' ? data.maxAudioSeconds : null,
        message: data.message ?? '',
        lastError: null,
        checkedAt
      }
    } catch (error) {
      lastError =
        error instanceof DOMException && error.name === 'AbortError'
          ? `timeout @ ${url}`
          : `unreachable @ ${url}`
    } finally {
      window.clearTimeout(timer)
    }
  }

  // None answered — forget the stale working URL so the next probe re-scans all.
  lastWorkingUrl = null
  return {
    reachable: false,
    selectedProxyUrl: null,
    triedUrls: ordered,
    enabled: false,
    apiKeyConfigured: false,
    ready: false,
    model: null,
    sttModel: null,
    maxAudioSeconds: null,
    message: '프록시에 연결할 수 없습니다. sj-ai-proxy 서버가 실행 중인지 확인하세요.',
    lastError,
    checkedAt
  }
}
