/**
 * STT Proxy Client (renderer side) — backend speech transcription for Jarvis
 * Voice Mode.
 *
 * SECURITY MODEL (mirrors JarvisGptBrainService):
 *  - This client NEVER holds or sends an OpenAI API key. The key lives ONLY in
 *    the backend proxy (sj-ai-proxy). This client only knows the proxy URL.
 *  - Audio is sent to the backend ONLY when the CEO explicitly records via the
 *    STT Proxy engine. Before uploading, transcribeAudio checks backend
 *    readiness (GET /ai/status) and refuses to send audio when STT is disabled
 *    or unconfigured — so audio never leaves the device unless it can be used.
 *  - The backend adds the key server-side and returns transcript text only.
 */

import {
  detectProxyStatus,
  forceDetectProxyStatus,
  primaryProxyUrl,
  activeProxyUrl
} from './proxyConfig'

/** Where a transcript came from, or why it is unavailable. */
export type SttSource = 'stt-proxy' | 'disabled' | 'error'

/** Result of a transcription attempt. Never throws — always a normalized shape. */
export interface TranscriptResult {
  success: boolean
  /** The recognized text (empty unless success). */
  transcript: string
  source: SttSource
  /** Transcription model reported by the backend, when available. */
  model?: string
  /** Server-side transcription duration in ms, when available. */
  durationMs?: number
  /** Machine-readable failure code (e.g. OPENAI_DISABLED, PROXY_OFFLINE). */
  errorCode?: string
  /** Korean, UI-ready failure message. */
  errorMessage?: string
}

export interface SttProxyConfig {
  /** Renderer preference: default to STT Proxy engine when true. */
  enabled: boolean
  proxyUrl: string
}

/** Derived, UI-ready STT readiness label. */
export type SttStatusLabel = 'STT Ready' | 'STT Disabled' | 'Key Missing' | 'Proxy Offline'

/** Result of a GET /ai/status readiness check (no OpenAI call, no secrets). */
export interface SttStatusResult {
  reachable: boolean
  enabled: boolean
  apiKeyConfigured: boolean
  ready: boolean
  model: string | null
  maxAudioSeconds: number | null
  label: SttStatusLabel
  message: string
  /** The proxy URL that answered (null when unreachable). */
  proxyUrl: string | null
  /** All proxy URLs tried, in order. */
  triedUrls: string[]
  /** Low-level connection error detail, when unreachable. */
  lastError: string | null
}

interface TranscribeResponse {
  success?: boolean
  text?: string
  model?: string
  durationMs?: number
  code?: string
  error?: string
}

/** Read renderer config from Vite env (non-secret values only). */
function readEnv(key: string): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return env?.[key]
}

const REQUEST_TIMEOUT_MS = 30000

export class SttProxyClient {
  getConfig(): SttProxyConfig {
    return {
      enabled: String(readEnv('VITE_STT_PROXY_ENABLED') ?? 'false').toLowerCase() === 'true',
      proxyUrl: primaryProxyUrl()
    }
  }

  /** Renderer preference flag: whether STT Proxy should be the default engine. */
  isEnabled(): boolean {
    return this.getConfig().enabled
  }

  /** Map a shared ProxyDetection into the UI-ready STT status shape. */
  private toStatusResult(d: Awaited<ReturnType<typeof detectProxyStatus>>): SttStatusResult {
    const label: SttStatusLabel = !d.reachable
      ? 'Proxy Offline'
      : !d.enabled
        ? 'STT Disabled'
        : !d.apiKeyConfigured
          ? 'Key Missing'
          : 'STT Ready'
    return {
      reachable: d.reachable,
      enabled: d.enabled,
      apiKeyConfigured: d.apiKeyConfigured,
      ready: d.ready,
      model: d.sttModel,
      maxAudioSeconds: d.maxAudioSeconds,
      label,
      message: d.message,
      proxyUrl: d.selectedProxyUrl,
      triedUrls: d.triedUrls,
      lastError: d.lastError
    }
  }

  /**
   * Backend readiness check via shared multi-URL auto-detection (GET /ai/status).
   * Never calls OpenAI, never touches the API key, and never throws —
   * proxy-offline is a normal result.
   */
  async checkStatus(): Promise<SttStatusResult> {
    return this.toStatusResult(await detectProxyStatus())
  }

  /**
   * Force a fresh readiness check for the manual "프록시 상태 새로고침" button.
   * Ignores any cached working URL and probes the hard fallbacks first
   * (http://localhost:8787 then http://127.0.0.1:8787). If either answers,
   * selectedProxyUrl is set and the proxy is marked connected.
   */
  async forceCheckStatus(): Promise<SttStatusResult> {
    return this.toStatusResult(await forceDetectProxyStatus())
  }

  /**
   * Transcribe recorded audio via the backend STT proxy.
   *
   * Checks backend readiness first; audio is uploaded ONLY when STT is enabled
   * and a key is configured server-side. Uses multipart/form-data. The API key
   * is never included from the renderer. Never throws.
   */
  async transcribeAudio(audioBlob: Blob): Promise<TranscriptResult> {
    // Readiness precheck — never upload audio to a disabled/unconfigured proxy.
    const status = await this.checkStatus()
    if (!status.reachable) {
      return { success: false, transcript: '', source: 'error', errorCode: 'PROXY_OFFLINE', errorMessage: status.message }
    }
    if (!status.enabled) {
      return {
        success: false,
        transcript: '',
        source: 'disabled',
        errorCode: 'OPENAI_DISABLED',
        errorMessage:
          status.message ||
          'STT 프록시가 비활성화되어 있습니다. 백엔드에서 OPENAI_ENABLED=true 로 설정하세요.'
      }
    }
    if (!status.apiKeyConfigured) {
      return {
        success: false,
        transcript: '',
        source: 'error',
        errorCode: 'OPENAI_API_KEY_MISSING',
        errorMessage:
          status.message ||
          'OPENAI_ENABLED=true 이지만 백엔드에 OPENAI_API_KEY 가 설정되지 않았습니다.'
      }
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const form = new FormData()
      form.append('audio', audioBlob, 'audio.webm')
      form.append('lang', 'ko')
      // Use the URL that just answered the readiness check (falls back to the
      // primary candidate) so audio goes to the reachable proxy.
      const base = status.proxyUrl ?? activeProxyUrl()
      const response = await fetch(`${base}/ai/transcribe`, {
        method: 'POST',
        body: form,
        signal: controller.signal
      })
      const data = (await response.json().catch(() => ({ success: false }))) as TranscribeResponse
      if (!response.ok || !data.success) {
        return {
          success: false,
          transcript: '',
          source: 'error',
          errorCode: data.code ?? `HTTP_${response.status}`,
          errorMessage: data.error ?? `STT 프록시 응답 오류 (HTTP ${response.status}).`
        }
      }
      return {
        success: true,
        transcript: (data.text ?? '').trim(),
        source: 'stt-proxy',
        model: data.model,
        durationMs: data.durationMs
      }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      return {
        success: false,
        transcript: '',
        source: 'error',
        errorCode: aborted ? 'STT_TIMEOUT' : 'PROXY_UNREACHABLE',
        errorMessage: aborted
          ? 'STT 프록시 응답이 시간 내에 도착하지 않았습니다.'
          : 'STT 프록시에 연결할 수 없습니다. 프록시가 실행 중인지 확인해 주세요.'
      }
    } finally {
      window.clearTimeout(timer)
    }
  }
}

export const sttProxyClient = new SttProxyClient()
export default SttProxyClient
