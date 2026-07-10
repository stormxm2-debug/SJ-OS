/**
 * 박수(더블 클랩) 감지기 — Web Audio API로 마이크 소리 크기만 분석한다.
 *
 * 박수는 "짧고 강한 광대역 트랜지언트"다: 조용하다가 갑자기 큰 피크 → 클랩 온셋.
 * 오탐(말·문 닫힘 등)을 줄이려고 **더블 클랩**(120~700ms 간격 두 번)만 트리거하고,
 * 트리거 후 쿨다운을 둔다. 오디오는 저장하지 않으며 파형 진폭만 본다.
 * 어떤 실패에서도 throw하지 않는다(권한 거부 등은 {ok:false}).
 */
export interface ClapStartResult {
  ok: boolean
  error?: string
}

export class ClapDetector {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private raf = 0
  private running = false
  private firstClap = 0
  private cooldownUntil = 0
  private onDouble: (() => void) | null = null

  isRunning(): boolean {
    return this.running
  }

  async start(onDouble: () => void): Promise<ClapStartResult> {
    if (this.running) return { ok: true }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return { ok: false, error: '이 환경에서는 마이크를 사용할 수 없습니다.' }
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }
      })
    } catch {
      return { ok: false, error: '마이크 권한이 필요합니다. 브라우저에서 허용해 주세요.' }
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AC()
      const src = this.ctx.createMediaStreamSource(this.stream)
      const analyser = this.ctx.createAnalyser()
      analyser.fftSize = 1024
      src.connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)
      this.onDouble = onDouble
      this.running = true
      let prevPeak = 0

      const tick = (): void => {
        if (!this.running) return
        analyser.getByteTimeDomainData(buf)
        let peak = 0
        for (let i = 0; i < buf.length; i += 1) {
          const v = Math.abs(buf[i] - 128) / 128
          if (v > peak) peak = v
        }
        const now = performance.now()
        // 클랩 온셋: 직전이 조용했는데(prevPeak<0.18) 지금 강한 피크(>0.55).
        if (now > this.cooldownUntil && peak > 0.55 && prevPeak < 0.18) {
          if (this.firstClap && now - this.firstClap > 120 && now - this.firstClap < 700) {
            // 더블 클랩 성립 → 트리거 + 쿨다운.
            this.firstClap = 0
            this.cooldownUntil = now + 1500
            try {
              this.onDouble?.()
            } catch {
              /* 콜백 오류가 감지 루프를 멈추지 않게 */
            }
          } else {
            this.firstClap = now
          }
        }
        // 단일 클랩 대기창 만료.
        if (this.firstClap && now - this.firstClap > 700) this.firstClap = 0
        prevPeak = peak
        this.raf = requestAnimationFrame(tick)
      }
      this.raf = requestAnimationFrame(tick)
      return { ok: true }
    } catch {
      this.stop()
      return { ok: false, error: '오디오 분석을 시작하지 못했습니다.' }
    }
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close().catch(() => {})
    this.ctx = null
    this.stream = null
    this.firstClap = 0
    this.onDouble = null
  }
}
