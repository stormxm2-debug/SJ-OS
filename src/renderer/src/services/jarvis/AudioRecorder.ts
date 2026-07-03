/**
 * Jarvis voice capture — a stable, click-to-toggle audio recorder.
 *
 * SAFETY / DESIGN:
 *  - Recording starts ONLY on an explicit user action (click). No always-on
 *    listening, no wake word, no press-and-hold.
 *  - Records in memory only (Blob chunks); audio is never written to disk. The
 *    resulting Blob is handed to the caller for a one-shot upload to the Electron
 *    Main AI Gateway, then dropped.
 *  - The microphone stream tracks are always stopped after the final Blob.
 *  - Auto-stops after a safe max duration so the mic is never left open.
 *  - Uses a 250ms timeslice so audio chunks are flushed periodically (even short
 *    recordings capture data) and exposes chunk-count + blob-size diagnostics so
 *    the UI can distinguish a recording failure from a transcription failure.
 */

/** Dev-only debug logging (stripped/ignored in production). */
const IS_DEV = ((): boolean => {
  try {
    return (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true
  } catch {
    return false
  }
})()
function devLog(...args: unknown[]): void {
  if (IS_DEV) console.debug('[JarvisVoice]', ...args)
}

/** The finalized recording handed back to the caller. */
export interface RecordingResult {
  blob: Blob
  mimeType: string
  durationMs: number
  /** Number of audio chunks collected (0 ⇒ nothing was captured). */
  chunkCount: number
  /** Total recorded bytes. */
  blobSize: number
}

export interface RecorderCallbacks {
  /** Fired once recording has actually begun. */
  onStart?: () => void
  /** Fired with the finalized recording when it ends (manual or auto-stop). */
  onStop?: (result: RecordingResult) => void
  /** Fired on capture/permission errors with a Korean, UI-ready message. */
  onError?: (message: string) => void
  /** Fired when the max duration is reached and we auto-stop. */
  onMaxReached?: () => void
}

/** MIME types we prefer, most-compatible first. Empty string = let the browser pick. */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus'
]

/** Flush audio data every 250ms so chunks accumulate even for short clips. */
const TIMESLICE_MS = 250

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private commandTimer: number | null = null
  private hardTimer: number | null = null
  private startedAt = 0
  private recording = false
  /** True once onstop has finalized, so we never finalize twice. */
  private finalized = false
  private callbacks: RecorderCallbacks = {}
  /** Command-mode auto-stop cap. */
  private readonly commandMaxMs: number
  /** Hard safety cap — the mic is never left open beyond this. */
  private readonly hardMaxMs: number

  constructor(commandMaxSeconds = 10, hardMaxSeconds = 12) {
    this.commandMaxMs = Math.max(1, commandMaxSeconds) * 1000
    this.hardMaxMs = Math.max(commandMaxSeconds, hardMaxSeconds) * 1000
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

  /** Command-mode max recording length in seconds (for UI display). */
  getMaxSeconds(): number {
    return Math.round(this.commandMaxMs / 1000)
  }

  /** Hard safety cap in seconds. */
  getHardMaxSeconds(): number {
    return Math.round(this.hardMaxMs / 1000)
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
   * Begin recording. Requests mic access, validates the stream, records in memory
   * with a periodic timeslice, and auto-stops after the max duration. Safe to call
   * when already recording (no-op) or unsupported (reports via onError). Never
   * throws.
   */
  async start(callbacks: RecorderCallbacks): Promise<void> {
    if (this.recording) {
      devLog('start ignored — already recording')
      return
    }
    this.callbacks = callbacks
    this.finalized = false
    devLog('startRecording called')

    if (!this.isSupported()) {
      callbacks.onError?.('이 환경에서는 오디오 녹음(MediaRecorder)을 사용할 수 없습니다.')
      return
    }

    // 1) Request the microphone.
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      devLog('permission/getUserMedia failed', name)
      callbacks.onError?.(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? '마이크 권한이 필요합니다. Windows 마이크 권한과 앱 권한을 확인해 주세요.'
          : name === 'NotFoundError'
            ? '마이크 장치를 찾을 수 없습니다. 마이크 연결을 확인해 주세요.'
            : '음성 입력을 시작하지 못했습니다. 마이크 상태를 확인해 주세요.'
      )
      this.cleanupStream()
      return
    }

    // 2) Validate the stream has a live audio track.
    const audioTracks = this.stream.getAudioTracks()
    if (audioTracks.length === 0 || audioTracks[0].readyState !== 'live') {
      devLog('no live audio track', audioTracks.length, audioTracks[0]?.readyState)
      callbacks.onError?.('마이크에서 오디오 입력을 찾을 수 없습니다. 마이크를 확인해 주세요.')
      this.cleanupStream()
      return
    }
    devLog('permission granted, audio track live')

    // 3) Pick a supported MIME type (fallback: let the browser decide).
    const mimeType = this.pickMimeType()
    devLog('selected mimeType', mimeType || '(browser default)')
    try {
      this.mediaRecorder = mimeType
        ? new MediaRecorder(this.stream, { mimeType })
        : new MediaRecorder(this.stream)
    } catch {
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
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data)
        devLog('dataavailable chunk', event.data.size, 'total', this.chunks.length)
      }
    }
    this.mediaRecorder.onstart = () => {
      this.recording = true
      this.startedAt = Date.now()
      devLog('recorder state → recording')
      callbacks.onStart?.()
    }
    this.mediaRecorder.onstop = () => this.finalize(mimeType)
    this.mediaRecorder.onerror = () => {
      devLog('recorder onerror')
      callbacks.onError?.('녹음 중 오류가 발생했습니다. 다시 시도해 주세요.')
      this.stop()
    }

    // 4) Start with a timeslice so chunks flush periodically.
    try {
      this.mediaRecorder.start(TIMESLICE_MS)
    } catch {
      callbacks.onError?.('음성 입력을 시작하지 못했습니다.')
      this.cleanupStream()
      this.recording = false
      this.mediaRecorder = null
      return
    }

    // 5) Auto-stop timers.
    this.commandTimer = window.setTimeout(() => {
      callbacks.onMaxReached?.()
      this.stop()
    }, this.commandMaxMs)
    this.hardTimer = window.setTimeout(() => this.stop(), this.hardMaxMs)
  }

  /** Finalize exactly once: build the Blob, report diagnostics, clean up. */
  private finalize(fallbackMime: string): void {
    if (this.finalized) return
    this.finalized = true
    const durationMs = this.startedAt ? Date.now() - this.startedAt : 0
    const mimeType = this.mediaRecorder?.mimeType || fallbackMime || 'audio/webm'
    const chunkCount = this.chunks.length
    const blob = new Blob(this.chunks, { type: mimeType })
    const blobSize = blob.size
    this.chunks = []
    this.clearAutoStop()
    this.cleanupStream()
    this.recording = false
    this.mediaRecorder = null
    devLog('onstop', { durationMs, chunkCount, blobSize, mimeType })
    this.callbacks.onStop?.({ blob, mimeType, durationMs, chunkCount, blobSize })
  }

  /** Stop recording (finalizes the Blob via onstop). Safe to call when idle. */
  stop(): void {
    this.clearAutoStop()
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        // Flush any buffered audio before stopping.
        try {
          this.mediaRecorder.requestData()
        } catch {
          /* not all implementations support requestData while recording */
        }
        this.mediaRecorder.stop()
        return
      }
    } catch {
      // Fall through to hard cleanup.
    }
    // Recorder missing/inactive — clean up so nothing is left open.
    this.cleanupStream()
    this.recording = false
    this.mediaRecorder = null
  }

  private clearAutoStop(): void {
    if (this.commandTimer !== null) {
      window.clearTimeout(this.commandTimer)
      this.commandTimer = null
    }
    if (this.hardTimer !== null) {
      window.clearTimeout(this.hardTimer)
      this.hardTimer = null
    }
  }

  private cleanupStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
  }
}

export const audioRecorder = new AudioRecorder(10, 12)
export default AudioRecorder
