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
 * The renderer's DOM lib does not ship SpeechRecognition types, so the minimal
 * surface we rely on is declared locally below.
 */

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

/** Callbacks the UI registers for a listening session. */
export interface VoiceListenCallbacks {
  /** Interim (in-progress) transcript, if the engine supports it. */
  onInterim?: (text: string) => void
  /** Final recognized transcript for the utterance. */
  onFinal?: (text: string) => void
  /** Recoverable/terminal error message (Korean, UI-ready). */
  onError?: (message: string) => void
  /** Listening state changes (start/stop). */
  onStatusChange?: (status: VoiceStatus) => void
}

const LANG_KO = 'ko-KR'

/** Korean, UI-ready messages for the known SpeechRecognition error codes. */
const RECOGNITION_ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': '마이크 권한이 필요합니다. 브라우저/시스템 설정에서 마이크 접근을 허용해 주세요.',
  'service-not-allowed': '마이크 권한이 필요합니다. 브라우저/시스템 설정에서 마이크 접근을 허용해 주세요.',
  'no-speech': '음성이 감지되지 않았습니다. 마이크 버튼을 누른 채 다시 말씀해 주세요.',
  'audio-capture': '마이크를 찾을 수 없습니다. 마이크가 연결되어 있는지 확인해 주세요.',
  network: '음성 인식 네트워크 오류가 발생했습니다. 다시 시도해 주세요.',
  aborted: '음성 인식이 중단되었습니다.'
}

/**
 * VoiceService wraps push-to-talk speech recognition and optional speech
 * synthesis. It holds no audio and performs no network calls.
 */
export class VoiceService {
  private recognition: SpeechRecognitionLike | null = null
  private listening = false
  private outputEnabled = false
  private callbacks: VoiceListenCallbacks = {}

  /** True when this environment exposes a SpeechRecognition implementation. */
  isRecognitionSupported(): boolean {
    return this.getRecognitionCtor() !== null
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
      callbacks.onError?.('이 환경에서는 음성 인식을 사용할 수 없습니다.')
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
      if (final) callbacks.onFinal?.(final.trim())
    }

    recognition.onerror = (event) => {
      const message =
        RECOGNITION_ERROR_MESSAGES[event.error] ??
        `음성 인식 중 오류가 발생했습니다 (${event.error}).`
      callbacks.onError?.(message)
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
      callbacks.onError?.(message)
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
