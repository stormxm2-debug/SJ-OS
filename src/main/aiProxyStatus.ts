import type { AiProxyBridgeStatus } from '@shared/aiProxy'

/**
 * AI Proxy status bridge (main process).
 *
 * SECURITY: this module talks ONLY to the LOCAL sj-ai-proxy status endpoint. It
 * never calls OpenAI, never reads or forwards an API key, and never accepts a
 * URL from the renderer — the two loopback URLs are hard-coded. It returns only
 * the proxy's sanitized readiness flags.
 *
 * Why do this in the main process? A renderer `fetch` to the proxy can fail in
 * Electron for reasons that have nothing to do with the proxy being down (CORS,
 * the file:// origin, a stale renderer). A Node `fetch` from the main process
 * sends no Origin header, so it bypasses CORS entirely and gives Jarvis a
 * reliable readiness signal.
 */

/** The only status URLs this bridge will ever probe, IPv4 + IPv6 loopback forms. */
const PROXY_STATUS_URLS = [
  'http://localhost:8787/ai/status',
  'http://127.0.0.1:8787/ai/status'
]

const STATUS_TIMEOUT_MS = 4000

/** The sanitized subset of GET /ai/status we read. Never includes a key. */
interface AiStatusResponse {
  enabled?: boolean
  apiKeyConfigured?: boolean
  ready?: boolean
  model?: string
  sttModel?: string
  maxAudioSeconds?: number
  message?: string
}

/** Strip the `/ai/status` suffix to recover the proxy base URL. */
function toBaseUrl(statusUrl: string): string {
  return statusUrl.replace(/\/ai\/status$/, '')
}

/**
 * Probe the local proxy's status endpoint (localhost then 127.0.0.1) and return
 * the first reachable result. Never throws — an unreachable proxy is a normal
 * result. No API key is ever read or returned.
 */
export async function getAiProxyStatus(): Promise<AiProxyBridgeStatus> {
  const checkedAt = new Date().toISOString()
  let lastError: string | undefined

  for (const statusUrl of PROXY_STATUS_URLS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS)
    try {
      const response = await fetch(statusUrl, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      })
      if (!response.ok) {
        lastError = `HTTP ${response.status} @ ${statusUrl}`
        continue
      }
      let data: AiStatusResponse
      try {
        data = (await response.json()) as AiStatusResponse
      } catch {
        lastError = `invalid response (not JSON) @ ${statusUrl}`
        continue
      }
      return {
        reachable: true,
        selectedProxyUrl: toBaseUrl(statusUrl),
        enabled: Boolean(data.enabled),
        apiKeyConfigured: Boolean(data.apiKeyConfigured),
        ready: Boolean(data.ready),
        model: data.model,
        sttModel: data.sttModel,
        maxAudioSeconds:
          typeof data.maxAudioSeconds === 'number' ? data.maxAudioSeconds : undefined,
        message: data.message,
        checkedAt
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      lastError = `${detail || 'failed to fetch'} @ ${statusUrl}`
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    reachable: false,
    message: '프록시에 연결할 수 없습니다. sj-ai-proxy 서버가 실행 중인지 확인하세요.',
    lastError,
    checkedAt
  }
}
