import type {
  AiGatewayStatus,
  AiTranscribeRequest,
  AiTranscribeResult
} from '@shared/aiGateway'
import { readGatewayEnv } from './env'

/**
 * Electron Main AI Gateway (Jarvis desktop mode).
 *
 * The MAIN process is the local AI gateway: it holds the OpenAI API key (read
 * from the SJ OS root `.env` / process.env), talks to OpenAI directly, and
 * returns only sanitized results to the renderer over IPC.
 *
 * SECURITY
 *  - The OpenAI API key is read from the environment ONLY and NEVER returned,
 *    exposed to the renderer, or logged (not even partially).
 *  - Audio is held IN MEMORY only for the single request and never written to
 *    disk or logged.
 *  - Enable/key gates run BEFORE any OpenAI call, and BEFORE decoding audio, so a
 *    disabled gateway never touches the network or buffers audio needlessly.
 *  - No SDK dependency: transcription uses the Node global `fetch` + multipart
 *    body available in the Electron main process, so `npm run dev` needs no
 *    extra install.
 */

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions'

/** App-specific root dirs (e.g. app.getAppPath()) searched for `.env`, set once at startup. */
let extraEnvRoots: string[] = []

/** Register additional roots to search for the SJ OS `.env` (called from main on boot). */
export function configureAiGatewayRoots(roots: string[]): void {
  extraEnvRoots = roots.filter((r) => typeof r === 'string' && r.length > 0)
}

/** Only audio MIME types are accepted for transcription. */
function isAllowedAudioMime(mime: string): boolean {
  return typeof mime === 'string' && /^audio\//i.test(mime.trim())
}

/**
 * Sanitized gateway readiness — does NOT call OpenAI and NEVER exposes the key.
 * Reports enabled/key/ready plus the models and audio limit for the UI.
 */
export function getAiGatewayStatus(): AiGatewayStatus {
  const env = readGatewayEnv(extraEnvRoots)
  const apiKeyConfigured = env.apiKey.length > 0
  const ready = env.enabled && apiKeyConfigured
  const message = !env.enabled
    ? 'OPENAI_ENABLED=false 상태입니다. SJ OS 루트 .env 에서 OPENAI_ENABLED=true 로 설정하세요.'
    : !apiKeyConfigured
      ? 'OpenAI API 키가 설정되지 않았습니다. SJ OS 루트 .env 에만 직접 입력하세요.'
      : 'Electron AI Gateway 준비됨 — OpenAI 사용 가능. 별도 프록시 서버가 필요 없습니다.'
  return {
    mode: 'electron-main',
    enabled: env.enabled,
    apiKeyConfigured,
    ready,
    model: env.model,
    sttModel: env.sttModel,
    maxAudioSeconds: env.maxAudioSeconds,
    message,
    checkedAt: new Date().toISOString()
  }
}

/** Normalize the incoming audio payload to a Uint8Array without copying twice. */
function toBytes(audio: ArrayBuffer | Uint8Array): Uint8Array {
  return audio instanceof Uint8Array ? audio : new Uint8Array(audio)
}

/**
 * Transcribe recorded audio through OpenAI from the MAIN process.
 *
 * Validates enable/key gates, MIME type, and byte size BEFORE any network call.
 * Never throws — every failure path returns a normalized {@link AiTranscribeResult}
 * with a machine-readable code and a Korean message. No audio is stored or logged.
 */
export async function transcribeAudio(
  request: AiTranscribeRequest
): Promise<AiTranscribeResult> {
  const env = readGatewayEnv(extraEnvRoots)

  // Gate before decoding audio — never process audio we won't use.
  if (!env.enabled) {
    return {
      success: false,
      source: 'electron-main-openai',
      errorCode: 'OPENAI_DISABLED',
      errorMessage:
        'OPENAI_ENABLED=false 상태입니다. SJ OS 루트 .env 에서 OPENAI_ENABLED=true 로 설정하세요.'
    }
  }
  if (env.apiKey.length === 0) {
    return {
      success: false,
      source: 'electron-main-openai',
      errorCode: 'OPENAI_API_KEY_MISSING',
      errorMessage:
        'OpenAI API 키가 설정되지 않았습니다. SJ OS 루트 .env 에만 직접 입력하세요.'
    }
  }

  const mimeType = (request.mimeType ?? '').trim() || 'audio/webm'
  if (!isAllowedAudioMime(mimeType)) {
    return {
      success: false,
      source: 'electron-main-openai',
      errorCode: 'AUDIO_MIME_INVALID',
      errorMessage: '지원하지 않는 오디오 형식입니다. 오디오 녹음만 전송할 수 있습니다.'
    }
  }

  const bytes = toBytes(request.audioBuffer)
  if (bytes.length === 0) {
    return {
      success: false,
      source: 'electron-main-openai',
      errorCode: 'AUDIO_MISSING',
      errorMessage: '오디오 데이터가 비어 있습니다. 다시 녹음해 주세요.'
    }
  }
  const maxBytes = env.maxAudioUploadMb * 1024 * 1024
  if (bytes.length > maxBytes) {
    return {
      success: false,
      source: 'electron-main-openai',
      errorCode: 'AUDIO_TOO_LARGE',
      errorMessage: `오디오 파일이 너무 큽니다 (최대 ${env.maxAudioUploadMb}MB).`
    }
  }

  const language =
    typeof request.language === 'string' && request.language.trim()
      ? request.language.trim()
      : 'ko'
  const fileName = request.fileName?.trim() || 'audio.webm'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), env.timeoutMs)
  try {
    const form = new FormData()
    // Copy into a fresh ArrayBuffer-backed Blob (in-memory only, never on disk).
    form.append('file', new Blob([bytes], { type: mimeType }), fileName)
    form.append('model', env.sttModel)
    form.append('language', language)

    const response = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: 'POST',
      headers: {
        // The key is used ONLY here, in-request. Never logged, never returned.
        Authorization: `Bearer ${env.apiKey}`
      },
      body: form,
      signal: controller.signal
    })

    if (!response.ok) {
      // Read the error body for a message ONLY — never audio content.
      let detail = ''
      try {
        const errJson = (await response.json()) as { error?: { message?: string } }
        detail = errJson?.error?.message ?? ''
      } catch {
        detail = ''
      }
      const keyRejected = response.status === 401 || response.status === 403
      return {
        success: false,
        source: 'electron-main-openai',
        errorCode: keyRejected ? 'OPENAI_AUTH_FAILED' : `HTTP_${response.status}`,
        errorMessage: keyRejected
          ? 'OpenAI 인증에 실패했습니다. SJ OS 루트 .env 의 OPENAI_API_KEY 를 확인하세요.'
          : `STT 전사 처리 중 오류가 발생했습니다 (HTTP ${response.status}).${
              detail ? ` ${detail}` : ''
            }`
      }
    }

    const data = (await response.json()) as { text?: string }
    const transcript = (typeof data?.text === 'string' ? data.text : '').trim()
    return {
      success: true,
      transcript,
      model: env.sttModel,
      source: 'electron-main-openai'
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      success: false,
      source: 'electron-main-openai',
      errorCode: aborted ? 'STT_TIMEOUT' : 'STT_FAILED',
      errorMessage: aborted
        ? 'STT 응답이 시간 내에 도착하지 않았습니다. 다시 시도해 주세요.'
        : 'OpenAI 에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.'
    }
  } finally {
    clearTimeout(timer)
  }
}
