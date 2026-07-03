/**
 * Shared contract for the Electron Main AI Gateway (Jarvis desktop mode).
 *
 * The Electron MAIN process is the local AI gateway: the renderer sends audio
 * (and status queries) over the preload bridge, the main process adds the OpenAI
 * key server-side, calls OpenAI, and returns only sanitized results. Both the
 * main handlers and the preload bridge type against these shapes so they stay in
 * sync.
 *
 * SECURITY: none of these shapes ever carry the OpenAI API key. Status exposes
 * only an `apiKeyConfigured` boolean; the key never leaves the main process.
 */

/** Sanitized readiness snapshot of the main-process AI gateway. */
export interface AiGatewayStatus {
  /** Always 'electron-main' — identifies the gateway transport for the UI. */
  mode: 'electron-main'
  /** OPENAI_ENABLED flag from the root .env / process env. */
  enabled: boolean
  /** True when a non-empty OPENAI_API_KEY is configured (the key is never sent). */
  apiKeyConfigured: boolean
  /** Ready = enabled AND a key is configured. */
  ready: boolean
  /** Chat model label (display only). */
  model: string
  /** Speech-to-text model. */
  sttModel: string
  /** Max recording length the renderer should enforce. */
  maxAudioSeconds: number
  /** Korean, UI-ready status message. */
  message: string
  /** ISO timestamp of the check (main-process clock). */
  checkedAt: string
}

/** Language hint for transcription (Korean-first). */
export type AiTranscribeLanguage = 'ko' | (string & {})

/** Renderer → main transcription request. Audio is bytes, never a file path. */
export interface AiTranscribeRequest {
  /** Raw audio bytes (transferable). Never written to disk in the main process. */
  audioBuffer: ArrayBuffer | Uint8Array
  /** MIME type of the recording (e.g. 'audio/webm'). Validated in main. */
  mimeType: string
  /** Optional file name for the multipart upload (default 'audio.webm'). */
  fileName?: string
  /** Optional language hint (default 'ko'). */
  language?: AiTranscribeLanguage
}

/** Where a transcript came from / the transport used. */
export type AiTranscribeSource = 'electron-main-openai'

/** Main → renderer transcription result. Never throws across IPC. */
export interface AiTranscribeResult {
  success: boolean
  /** Recognized text (present on success). */
  transcript?: string
  /** STT model used (present on success). */
  model?: string
  /** Always identifies the main-process OpenAI path. */
  source: AiTranscribeSource
  /** Machine-readable failure code (e.g. OPENAI_DISABLED, OPENAI_API_KEY_MISSING). */
  errorCode?: string
  /** Korean, UI-ready failure message. */
  errorMessage?: string
}
