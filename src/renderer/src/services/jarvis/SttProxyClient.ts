/**
 * STT Proxy Client (renderer side) — future-ready interface for backend speech
 * transcription.
 *
 * SECURITY MODEL (mirrors JarvisGptBrainService):
 *  - This client NEVER holds or sends an OpenAI API key. The key lives ONLY in
 *    the backend proxy (sj-ai-proxy). This client only knows the proxy URL and
 *    whether the CEO has explicitly enabled STT proxy mode.
 *  - Audio is sent to the backend ONLY when STT proxy mode is explicitly enabled
 *    (VITE_STT_PROXY_ENABLED=true). While disabled (the default), transcribeAudio
 *    performs NO network call and NO audio leaves the device.
 *  - The backend /ai/transcribe endpoint is a safe, disabled-by-default stub in
 *    this sprint; real Whisper transcription (with upload handling) is deferred.
 */

/** Where a transcript came from, or why it is unavailable. */
export type SttSource = 'stt-proxy' | 'disabled' | 'error'

/** Result of a transcription attempt. Never throws — always a normalized shape. */
export interface TranscriptResult {
  success: boolean
  /** The recognized text (empty unless success). */
  text: string
  source: SttSource
  /** Korean, UI-ready message when unavailable/failed. */
  error?: string
}

export interface SttProxyConfig {
  /** Whether the CEO has explicitly opted into sending audio to the backend. */
  enabled: boolean
  proxyUrl: string
}

/** Read renderer config from Vite env (non-secret values only). */
function readEnv(key: string): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return env?.[key]
}

const DEFAULT_PROXY_URL = 'http://localhost:8787'
const REQUEST_TIMEOUT_MS = 30000

/** Shown when STT proxy mode is off — the safe default state. */
const DISABLED_MESSAGE =
  'STT 프록시가 아직 활성화되지 않았습니다. OpenAI API 키는 백엔드에서만 설정해야 합니다.'

export class SttProxyClient {
  getConfig(): SttProxyConfig {
    return {
      enabled: String(readEnv('VITE_STT_PROXY_ENABLED') ?? 'false').toLowerCase() === 'true',
      proxyUrl: readEnv('VITE_AI_PROXY_URL') ?? DEFAULT_PROXY_URL
    }
  }

  /** True only when the CEO has explicitly enabled STT proxy mode. */
  isEnabled(): boolean {
    return this.getConfig().enabled
  }

  /**
   * Transcribe recorded audio via the backend STT proxy.
   *
   * When STT proxy mode is disabled (default), this returns a clear fallback and
   * NEVER touches the network — the audio blob is not read or sent anywhere.
   * When enabled, it POSTs the audio to /ai/transcribe (multipart) with a
   * timeout; the backend adds the key and talks to OpenAI. Never throws.
   */
  async transcribeAudio(audioBlob: Blob): Promise<TranscriptResult> {
    const config = this.getConfig()
    if (!config.enabled) {
      return { success: false, text: '', source: 'disabled', error: DISABLED_MESSAGE }
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const form = new FormData()
      form.append('audio', audioBlob, 'audio.webm')
      form.append('lang', 'ko')
      const response = await fetch(`${config.proxyUrl.replace(/\/$/, '')}/ai/transcribe`, {
        method: 'POST',
        body: form,
        signal: controller.signal
      })
      const data = (await response.json().catch(() => ({ success: false }))) as {
        success?: boolean
        text?: string
        error?: string
      }
      if (!response.ok || !data.success) {
        return {
          success: false,
          text: '',
          source: 'error',
          error: data.error ?? `STT 프록시 응답 오류 (HTTP ${response.status}).`
        }
      }
      return { success: true, text: data.text ?? '', source: 'stt-proxy' }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      return {
        success: false,
        text: '',
        source: 'error',
        error: aborted
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
