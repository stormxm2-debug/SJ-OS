/**
 * Jarvis Voice Service — safe, local, push-to-talk voice I/O for the CEO
 * control layer.
 *
 * SAFETY (Voice Mode v1):
 *  - Push-to-talk only. No always-on listening, no wake word.
 *  - Uses ONLY the browser/Electron built-in Web Speech APIs
 *    (window.SpeechRecognition / webkitSpeechRecognition, window.speechSynthesis).
 *  - No external AI/API, no audio is recorded or stored, no audio is sent
 *    anywhere. The engine returns a transcript string only.
 *  - Korean-first (ko-KR).
 *
 * Web Speech recognition can be unreliable inside Electron (it may depend on a
 * remote browser speech service and fail with a `network` error). This service
 * therefore classifies errors, surfaces honest Korean diagnostics, and tracks a
 * voice-engine mode so the UI can recommend the (future) backend STT proxy path
 * without ever crashing or blocking typed input.
 *
 * The renderer's DOM lib does not ship SpeechRecognition types, so the minimal
 * surface we rely on is declared locally below.
 */

import { sttProxyClient } from './SttProxyClient'

/** Minimal SpeechRecognition surface we depend on. */
interface SpeechRecognitionAlternativeLike {
  transcript: string
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike
  isFinal: boolean
  length: number
}
interface SpeechRecognitionResultListLike {
  length: number
  [index: number]: SpeechRecognitionResultLike
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: SpeechRecognitionResultListLike
}
interface SpeechRecognitionErrorEventLike {
  error: string
  message?: string
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

/** Listening lifecycle status surfaced to the UI. */
export type VoiceStatus = 'idle' | 'listening' | 'error' | 'unsupported'

/** The active/effective voice engine the UI should present. */
export type VoiceEngineMode = 'web-speech' | 'stt-proxy-disabled' | 'stt-proxy-ready' | 'unavailable'

/** Classified SpeechRecognition error codes we surface to the UI. */
export type VoiceErrorCode =
  | 'no-speech'
  | 'audio-capture'
  | 'not-allowed'
  | 'service-not-allowed'
  | 'network'
  | 'aborted'
  | 'language-not-supported'
  | 'unknown'

/** Microphone permission state (best-effort; 'unknown' when unqueryable). */
export type MicPermission = 'granted' | 'denied' | 'prompt' | 'unknown'

/** Callbacks the UI registers for a listening session. */
export interface VoiceListenCallbacks {
  /** Interim (in-progress) transcript, if the engine supports it. */
  onInterim?: (text: string) => void
  /** Final recognized transcript for the utterance. */
  onFinal?: (text: string) => void
  /** Recoverable/terminal error, with a classified code and Korean message. */
  onError?: (message: string, code: VoiceErrorCode) => void
  /** Listening state changes (start/stop). */
  onStatusChange?: (status: VoiceStatus) => void
}

/** A compact snapshot of voice capability + last error, for the diagnostics UI. */
export interface VoiceDiagnostics {
  speechRecognitionSupported: boolean
  webkitSpeechRecognitionSupported: boolean
  speechSynthesisSupported: boolean
  microphonePermission: MicPermission
  engine: VoiceEngineMode
  lastErrorCode: VoiceErrorCode | null
  lastErrorMessage: string | null
  recommendedFix: string | null
}

const LANG_KO = 'ko-KR'

/** Korean, UI-ready messages for each classified recognition error code. */
const RECOGNITION_ERROR_MESSAGES: Record<VoiceErrorCode, string> = {
  network:
    '브라우저 음성 인식 서비스 연결에 실패했습니다. Electron/Web Speech 환경에서는 이 오류가 발생할 수 있습니다. STT 프록시 모드를 사용하거나 다시 시도해 주세요.',
  'not-allowed': '마이크 권한이 차단되었습니다. Windows 마이크 권한과 앱 권한을 확인해 주세요.',
  'service-not-allowed':
    '음성 인식 서비스 사용이 차단되었습니다. 시스템/브라우저 마이크 권한과 정책을 확인해 주세요.',
  'audio-capture': '마이크 장치를 찾을 수 없습니다. 마이크 연결 상태를 확인해 주세요.',
  'no-speech': '음성이 감지되지 않았습니다. 다시 눌러 말씀해 주세요.',
  aborted: '음성 인식이 중단되었습니다.',
  'language-not-supported':
    '현재 환경에서 한국어(ko-KR) 음성 인식이 지원되지 않습니다. 텍스트 입력을 사용해 주세요.',
  unknown: '알 수 없는 음성 인식 오류가 발생했습니다.'
}

/** Korean, actionable "recommended fix" per error code for the diagnostics UI. */
const RECOMMENDED_FIX: Record<VoiceErrorCode, string> = {
  network:
    'Electron 내장 음성 인식은 원격 음성 서비스에 의존할 수 있습니다. 네트워크 확인 후 다시 시도하거나, 안정적인 운영을 위해 백엔드 STT 프록시 모드를 준비하세요.',
  'not-allowed':
    'Windows 설정 → 개인정보 및 보안 → 마이크에서 이 앱의 마이크 접근을 허용한 뒤 앱을 다시 시작하세요.',
  'service-not-allowed': '시스템/브라우저 마이크 권한을 허용하고 앱을 다시 시작하세요.',
  'audio-capture': '마이크가 연결되어 있고 다른 앱이 점유하지 않는지 확인하세요.',
  'no-speech': '마이크 버튼을 누른 뒤 또렷하게 말씀해 주세요.',
  aborted: '다시 마이크 버튼을 눌러 시도하세요.',
  'language-not-supported': '텍스트 입력을 사용하거나 백엔드 STT 프록시 모드를 준비하세요.',
  unknown: '문제가 지속되면 텍스트 입력을 사용하고, 백엔드 STT 프록시 모드를 준비하세요.'
}

const KNOWN_ERROR_CODES: VoiceErrorCode[] = [
  'no-speech',
  'audio-capture',
  'not-allowed',
  'service-not-allowed',
  'network',
  'aborted',
  'language-not-supported'
]

/** Map a raw SpeechRecognition error string to a classified code. */
function classifyError(raw: string): VoiceErrorCode {
  return (KNOWN_ERROR_CODES as string[]).includes(raw) ? (raw as VoiceErrorCode) : 'unknown'
}

/**
 * VoiceService wraps push-to-talk speech recognition and optional speech
 * synthesis. It holds no audio and performs no network calls (Web Speech mode).
 */
export class VoiceService {
  private recognition: SpeechRecognitionLike | null = null
  private listening = false
  private outputEnabled = false
  private callbacks: VoiceListenCallbacks = {}

  // Diagnostics state.
  private webSpeechFailed = false
  private lastErrorCode: VoiceErrorCode | null = null
  private lastErrorMessage: string | null = null
  private micPermission: MicPermission = 'unknown'

  /** True when this environment exposes a SpeechRecognition implementation. */
  isRecognitionSupported(): boolean {
    return this.getRecognitionCtor() !== null
  }

  /** True when the standard (non-webkit) SpeechRecognition constructor exists. */
  isStandardRecognitionSupported(): boolean {
    if (typeof window === 'undefined') return false
    return 'SpeechRecognition' in window
  }

  /** True when the webkit-prefixed SpeechRecognition constructor exists. */
  isWebkitRecognitionSupported(): boolean {
    if (typeof window === 'undefined') return false
    return 'webkitSpeechRecognition' in window
  }

  /** True when this environment exposes speechSynthesis for voice output. */
  isSynthesisSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  }

  isListening(): boolean {
    return this.listening
  }

  isVoiceOutputEnabled(): boolean {
    return this.outputEnabled
  }

  /** Toggle text-to-speech output. Returns the new state. */
  setVoiceOutput(enabled: boolean): boolean {
    this.outputEnabled = enabled && this.isSynthesisSupported()
    if (!this.outputEnabled) this.stopSpeaking()
    return this.outputEnabled
  }

  /**
   * Effective voice engine mode:
   *  - 'stt-proxy-ready'    → STT proxy mode is explicitly enabled.
   *  - 'web-speech'         → Web Speech is supported and hasn't failed.
   *  - 'stt-proxy-disabled' → Web Speech is unusable (failed/unsupported) and the
   *                           stable path is the backend STT proxy, which is off.
   *  - 'unavailable'        → No recognition and no synthesis at all.
   */
  getEngineMode(): VoiceEngineMode {
    if (sttProxyClient.isEnabled()) return 'stt-proxy-ready'
    if (this.isRecognitionSupported() && !this.webSpeechFailed) return 'web-speech'
    if (!this.isRecognitionSupported() && !this.isSynthesisSupported()) return 'unavailable'
    return 'stt-proxy-disabled'
  }

  /**
   * Best-effort microphone permission query via the Permissions API. Caches the
   * result for getDiagnostics(). Never throws; 'unknown' when unqueryable (some
   * Electron builds do not expose the 'microphone' permission descriptor).
   */
  async refreshMicPermission(): Promise<MicPermission> {
    this.micPermission = await this.queryMicPermission()
    return this.micPermission
  }

  private async queryMicPermission(): Promise<MicPermission> {
    try {
      const perms = (navigator as unknown as {
        permissions?: { query?: (d: { name: string }) => Promise<{ state: string }> }
      }).permissions
      if (!perms?.query) return 'unknown'
      const status = await perms.query({ name: 'microphone' })
      if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
        return status.state
      }
      return 'unknown'
    } catch {
      // 'microphone' descriptor unsupported (common in Electron) → unknown.
      return 'unknown'
    }
  }

  /** A compact snapshot of voice capability + last error, for the UI. */
  getDiagnostics(): VoiceDiagnostics {
    return {
      speechRecognitionSupported: this.isStandardRecognitionSupported(),
      webkitSpeechRecognitionSupported: this.isWebkitRecognitionSupported(),
      speechSynthesisSupported: this.isSynthesisSupported(),
      microphonePermission: this.micPermission,
      engine: this.getEngineMode(),
      lastErrorCode: this.lastErrorCode,
      lastErrorMessage: this.lastErrorMessage,
      recommendedFix: this.lastErrorCode ? RECOMMENDED_FIX[this.lastErrorCode] : null
    }
  }

  /** Clear the "Web Speech failed" flag so the user can retry Web Speech mode. */
  resetWebSpeechFailure(): void {
    this.webSpeechFailed = false
    this.lastErrorCode = null
    this.lastErrorMessage = null
  }

  private getRecognitionCtor(): SpeechRecognitionCtor | null {
    if (typeof window === 'undefined') return null
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor
      webkitSpeechRecognition?: SpeechRecognitionCtor
    }
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
  }

  /**
   * Start a push-to-talk listening session. Safe to call when already
   * listening (no-op) or when unsupported (reports via onStatusChange/onError).
   */
  startListening(callbacks: VoiceListenCallbacks): void {
    this.callbacks = callbacks
    if (this.listening) return

    const Ctor = this.getRecognitionCtor()
    if (!Ctor) {
      callbacks.onStatusChange?.('unsupported')
      callbacks.onError?.('이 환경에서는 음성 인식을 사용할 수 없습니다.', 'unknown')
      return
    }

    const recognition = new Ctor()
    recognition.lang = LANG_KO
    // Push-to-talk: single utterance, released by the CEO via stopListening.
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      this.listening = true
      callbacks.onStatusChange?.('listening')
    }

    recognition.onresult = (event) => {
      let interim = ''
      let final = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) {
          final += text
        } else {
          interim += text
        }
      }
      if (interim) callbacks.onInterim?.(interim.trim())
      if (final) {
        // A successful transcript means Web Speech is working again.
        this.webSpeechFailed = false
        this.lastErrorCode = null
        this.lastErrorMessage = null
        this.micPermission = 'granted'
        callbacks.onFinal?.(final.trim())
      }
    }

    recognition.onerror = (event) => {
      const code = classifyError(event.error)
      const message = RECOGNITION_ERROR_MESSAGES[code]
      this.lastErrorCode = code
      this.lastErrorMessage = message
      // Network / language errors mean Web Speech is unreliable here → mark it
      // failed so the engine mode recommends the backend STT proxy path.
      if (code === 'network' || code === 'service-not-allowed' || code === 'language-not-supported') {
        this.webSpeechFailed = true
      }
      if (code === 'not-allowed') this.micPermission = 'denied'
      callbacks.onError?.(message, code)
      callbacks.onStatusChange?.('error')
    }

    recognition.onend = () => {
      this.listening = false
      this.recognition = null
      callbacks.onStatusChange?.('idle')
    }

    this.recognition = recognition
    try {
      recognition.start()
    } catch (error) {
      // start() throws if called while a prior session is still tearing down.
      this.listening = false
      this.recognition = null
      const message = error instanceof Error ? error.message : '음성 인식을 시작하지 못했습니다.'
      this.lastErrorCode = 'unknown'
      this.lastErrorMessage = message
      callbacks.onError?.(message, 'unknown')
      callbacks.onStatusChange?.('error')
    }
  }

  /** Stop the current listening session (finalizes any pending transcript). */
  stopListening(): void {
    if (!this.recognition) return
    try {
      this.recognition.stop()
    } catch {
      // Ignore — onend will reset state.
    }
  }

  /**
   * Speak a Jarvis response aloud when voice output is enabled. Korean voice is
   * preferred when available; otherwise the utterance still requests ko-KR.
   */
  speak(text: string): void {
    if (!this.outputEnabled || !this.isSynthesisSupported()) return
    const clean = text.trim()
    if (!clean) return

    const synth = window.speechSynthesis
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(clean)
    utterance.lang = LANG_KO
    const koVoice = synth.getVoices().find((voice) => voice.lang?.toLowerCase().startsWith('ko'))
    if (koVoice) utterance.voice = koVoice
    synth.speak(utterance)
  }

  /** Stop any in-progress speech output. */
  stopSpeaking(): void {
    if (!this.isSynthesisSupported()) return
    window.speechSynthesis.cancel()
  }
}

export const voiceService = new VoiceService()
export default VoiceService
