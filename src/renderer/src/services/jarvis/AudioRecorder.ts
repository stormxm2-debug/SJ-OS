/**
 * Push-to-talk audio capture for Jarvis STT Proxy mode.
 *
 * SAFETY:
 *  - Recording starts ONLY on an explicit user action. No always-on listening,
 *    no wake word.
 *  - Auto-stops after a short max duration (default 10s) so the mic is never
 *    left open.
 *  - Audio is kept IN MEMORY only (Blob chunks) and never written to disk. The
 *    resulting Blob is handed to the caller for a one-shot upload to the
 *    configured backend proxy, then dropped.
 *  - The microphone stream tracks are always stopped on end/error.
 */

export interface RecorderCallbacks {
  /** Fired once recording has actually begun. */
  onStart?: () => void
  /** Fired with the recorded audio when recording ends (manual or auto-stop). */
  onStop?: (blob: Blob, mimeType: string, durationMs: number) => void
  /** Fired on capture/permission errors with a Korean, UI-ready message. */
  onError?: (message: string) => void
}

/** MIME types we prefer, most-compatible first. Empty string = let the browser pick. */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4'
]

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private autoStopTimer: number | null = null
  private startedAt = 0
  private recording = false
  private readonly maxMs: number

  constructor(maxSeconds = 10) {
    this.maxMs = Math.max(1, maxSeconds) * 1000
  }

  /** True when this environment can record audio (MediaRecorder + getUserMedia). */
  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof MediaRecorder !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia
    )
  }

  isRecording(): boolean {
    return this.recording
  }

  /** Max recording length in seconds (for UI display). */
  getMaxSeconds(): number {
    return Math.round(this.maxMs / 1000)
  }

  private pickMimeType(): string {
    if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
      for (const type of PREFERRED_MIME_TYPES) {
        if (MediaRecorder.isTypeSupported(type)) return type
      }
    }
    return ''
  }

  /**
   * Begin a push-to-talk recording. Requests mic access, records in memory, and
   * auto-stops after the max duration. Safe to call when already recording
   * (no-op) or unsupported (reports via onError). Never throws.
   */
  async start(callbacks: RecorderCallbacks): Promise<void> {
    if (this.recording) return
    if (!this.isSupported()) {
      callbacks.onError?.('이 환경에서는 오디오 녹음(MediaRecorder)을 사용할 수 없습니다.')
      return
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      const denied = error instanceof DOMException && error.name === 'NotAllowedError'
      callbacks.onError?.(
        denied
          ? '마이크 권한이 차단되었습니다. Windows 마이크 권한과 앱 권한을 확인해 주세요.'
          : '마이크에 접근할 수 없습니다. 마이크 연결 상태를 확인해 주세요.'
      )
      this.cleanupStream()
      return
    }

    const mimeType = this.pickMimeType()
    try {
      this.mediaRecorder = mimeType
        ? new MediaRecorder(this.stream, { mimeType })
        : new MediaRecorder(this.stream)
    } catch {
      // Fallback: let the browser choose the container/codec.
      try {
        this.mediaRecorder = new MediaRecorder(this.stream)
      } catch {
        callbacks.onError?.('오디오 녹음기를 초기화하지 못했습니다.')
        this.cleanupStream()
        return
      }
    }

    this.chunks = []
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data)
    }
    this.mediaRecorder.onstart = () => {
      this.recording = true
      this.startedAt = Date.now()
      callbacks.onStart?.()
    }
    this.mediaRecorder.onstop = () => {
      const durationMs = this.startedAt ? Date.now() - this.startedAt : 0
      const type = this.mediaRecorder?.mimeType || mimeType || 'audio/webm'
      const blob = new Blob(this.chunks, { type })
      this.chunks = []
      this.clearAutoStop()
      this.cleanupStream()
      this.recording = false
      this.mediaRecorder = null
      callbacks.onStop?.(blob, type, durationMs)
    }
    this.mediaRecorder.onerror = () => {
      callbacks.onError?.('녹음 중 오류가 발생했습니다.')
      this.stop()
    }

    try {
      this.mediaRecorder.start()
    } catch {
      callbacks.onError?.('오디오 녹음을 시작하지 못했습니다.')
      this.cleanupStream()
      this.recording = false
      this.mediaRecorder = null
      return
    }

    // Auto-stop so the mic is never left open beyond the max duration.
    this.autoStopTimer = window.setTimeout(() => this.stop(), this.maxMs)
  }

  /** Stop recording (finalizes the Blob via onstop). Safe to call when idle. */
  stop(): void {
    this.clearAutoStop()
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop()
        return
      }
    } catch {
      // Fall through to hard cleanup.
    }
    this.cleanupStream()
    this.recording = false
    this.mediaRecorder = null
  }

  private clearAutoStop(): void {
    if (this.autoStopTimer !== null) {
      window.clearTimeout(this.autoStopTimer)
      this.autoStopTimer = null
    }
  }

  private cleanupStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
  }
}

export const audioRecorder = new AudioRecorder(10)
export default AudioRecorder
