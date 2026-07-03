/**
 * Electron AI Gateway client (renderer side) — Jarvis desktop Voice Mode.
 *
 * This is the DEFAULT local AI transport for the desktop app. It talks to the
 * Electron MAIN process over the preload bridge (`window.sj.ai`), which holds the
 * OpenAI key and performs transcription. There is no separate proxy server, no
 * localhost:8787, no VITE_AI_PROXY_URL, and no CORS.
 *
 * SECURITY: this client never holds or sees the OpenAI API key. It sends audio
 * bytes to the main process and receives only sanitized status + transcript text.
 */

import type {
  AiGatewayStatus,
  AiTranscribeResult
} from '@shared/aiGateway'

/** UI-ready readiness label for the Electron gateway. */
export type GatewayStatusLabel = 'Gateway Ready' | 'Gateway Disabled' | 'Key Missing' | 'Gateway Unavailable'

/** Renderer-facing status, derived from the main-process gateway status. */
export interface GatewayStatusResult {
  /** True when the preload bridge (`window.sj.ai`) is present at all. */
  available: boolean
  enabled: boolean
  apiKeyConfigured: boolean
  ready: boolean
  model: string | null
  sttModel: string | null
  maxAudioSeconds: number | null
  label: GatewayStatusLabel
  message: string
  checkedAt: string
}

/** Normalized transcription result (mirrors the STT proxy client shape). */
export interface GatewayTranscriptResult {
  success: boolean
  transcript: string
  source: 'electron-main' | 'unavailable' | 'error'
  model?: string
  errorCode?: string
  errorMessage?: string
}

/** Access the preload bridge if present (undefined in a plain browser context). */
function bridge(): Window['sj']['ai'] | undefined {
  if (typeof window === 'undefined') return undefined
  return window.sj?.ai
}

/** How long a fetched gateway status stays fresh before a re-check (ms). */
const STATUS_CACHE_MS = 30_000

export class ElectronAiGatewayClient {
  /** Last fetched status + when it was fetched, for the short-lived cache. */
  private cache: { status: GatewayStatusResult; at: number } | null = null

  /** True when running inside the Electron desktop app with the AI bridge. */
  isAvailable(): boolean {
    return !!bridge()
  }

  /** The cached status if still fresh (< 30s old), else null. */
  getCachedStatus(): GatewayStatusResult | null {
    if (!this.cache) return null
    if (Date.now() - this.cache.at > STATUS_CACHE_MS) return null
    return this.cache.status
  }

  /** True when a cached, fresh status reports the gateway ready to transcribe. */
  isReadyCached(): boolean {
    return this.getCachedStatus()?.ready === true
  }

  /** Drop the cached status so the next check re-probes the main process. */
  invalidateCache(): void {
    this.cache = null
  }

  /** Force a fresh status probe, bypassing (and refreshing) the cache. */
  async forceCheckStatus(): Promise<GatewayStatusResult> {
    this.cache = null
    return this.checkStatus()
  }

  private toStatusResult(s: AiGatewayStatus): GatewayStatusResult {
    const label: GatewayStatusLabel = !s.enabled
      ? 'Gateway Disabled'
      : !s.apiKeyConfigured
        ? 'Key Missing'
        : 'Gateway Ready'
    return {
      available: true,
      enabled: s.enabled,
      apiKeyConfigured: s.apiKeyConfigured,
      ready: s.ready,
      model: s.model,
      sttModel: s.sttModel,
      maxAudioSeconds: s.maxAudioSeconds,
      label,
      message: s.message,
      checkedAt: s.checkedAt
    }
  }

  /**
   * Read main-process gateway readiness. Never throws — when the bridge is
   * absent (e.g. non-Electron), returns an 'unavailable' status.
   */
  async checkStatus(): Promise<GatewayStatusResult> {
    // Serve a fresh cached status to avoid an IPC round-trip before every voice
    // command (the cache lives 30s; forceCheckStatus / invalidateCache bypass it).
    const cached = this.getCachedStatus()
    if (cached) return cached

    const ai = bridge()
    const checkedAt = new Date().toISOString()
    if (!ai) {
      const status: GatewayStatusResult = {
        available: false,
        enabled: false,
        apiKeyConfigured: false,
        ready: false,
        model: null,
        sttModel: null,
        maxAudioSeconds: null,
        label: 'Gateway Unavailable',
        message:
          'Electron AI Gateway를 사용할 수 없습니다. 데스크톱 앱(npm run dev)에서 실행해 주세요.',
        checkedAt
      }
      this.cache = { status, at: Date.now() }
      return status
    }
    try {
      const status = this.toStatusResult(await ai.getStatus())
      this.cache = { status, at: Date.now() }
      return status
    } catch {
      // Transient IPC error — do NOT cache, so the next check retries.
      return {
        available: false,
        enabled: false,
        apiKeyConfigured: false,
        ready: false,
        model: null,
        sttModel: null,
        maxAudioSeconds: null,
        label: 'Gateway Unavailable',
        message: 'Electron AI Gateway 상태를 확인하지 못했습니다.',
        checkedAt
      }
    }
  }

  /**
   * Transcribe a recorded clip via the main process. Converts the Blob to bytes,
   * sends them over IPC, and returns a normalized result. Never throws.
   */
  async transcribeAudio(audioBlob: Blob): Promise<GatewayTranscriptResult> {
    const ai = bridge()
    if (!ai) {
      return {
        success: false,
        transcript: '',
        source: 'unavailable',
        errorCode: 'GATEWAY_UNAVAILABLE',
        errorMessage:
          'Electron AI Gateway를 사용할 수 없습니다. 데스크톱 앱(npm run dev)에서 실행해 주세요.'
      }
    }
    try {
      const audioBuffer = await audioBlob.arrayBuffer()
      const result: AiTranscribeResult = await ai.transcribeAudio({
        audioBuffer,
        mimeType: audioBlob.type || 'audio/webm',
        fileName: 'audio.webm',
        language: 'ko'
      })
      if (!result.success) {
        // A failure may mean the gateway became disabled / lost its key — drop
        // the cached status so the next check reflects reality.
        this.invalidateCache()
        return {
          success: false,
          transcript: '',
          source: 'error',
          errorCode: result.errorCode,
          errorMessage: result.errorMessage ?? 'STT 전사에 실패했습니다.'
        }
      }
      return {
        success: true,
        transcript: (result.transcript ?? '').trim(),
        source: 'electron-main',
        model: result.model
      }
    } catch {
      return {
        success: false,
        transcript: '',
        source: 'error',
        errorCode: 'IPC_FAILED',
        errorMessage: 'Electron AI Gateway 호출에 실패했습니다. 앱을 다시 시작해 주세요.'
      }
    }
  }
}

export const electronAiGateway = new ElectronAiGatewayClient()
export default ElectronAiGatewayClient
