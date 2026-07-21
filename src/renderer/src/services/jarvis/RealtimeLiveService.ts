import { getFunctionsBaseUrl, getSupabaseAnonKey, getSupabaseClient, initSupabaseClient } from '@renderer/services/commercial/supabaseClient'

/**
 * 자비스 리얼타임 보이스 (대표 전용, B안) — OpenAI Realtime을 WebRTC로 직결해
 * ChatGPT 보이스와 같은 즉각 응답·음성 끼어들기(barge-in)를 제공한다.
 *
 * 흐름: realtime-token 엣지 함수(owner 검증)에서 에페메럴 토큰 발급 →
 * 마이크 트랙 + RTCPeerConnection SDP 교환 → 원격 오디오 재생.
 * 실제 API 키는 절대 클라이언트에 오지 않는다(토큰은 수명이 짧음).
 *
 * 비용 가드: 분당 과금이므로 세션 10분 자동 종료(연장은 다시 켜면 됨).
 */

export type RealtimeState = 'idle' | 'connecting' | 'live' | 'ended' | 'error'

export interface RealtimeCallbacks {
  onStateChange?: (state: RealtimeState, detail?: string) => void
  /** 자비스(모델)가 말하는 중인지 — 오브 연출용. */
  onAssistantSpeaking?: (speaking: boolean) => void
  /** 전사 텍스트 (대화 기록 표시용). */
  onTranscript?: (role: 'user' | 'assistant', text: string) => void
}

const MAX_SESSION_MS = 10 * 60 * 1000 // 10분 자동 종료 (비용 가드)

async function authBearer(): Promise<string | undefined> {
  const anon = getSupabaseAnonKey()
  try {
    await initSupabaseClient()
    const client = getSupabaseClient() as {
      auth?: { getSession: () => Promise<{ data?: { session?: { access_token?: string } } }> }
    } | null
    const { data } = (await client?.auth?.getSession()) ?? {}
    return data?.session?.access_token ?? anon
  } catch {
    return anon
  }
}

export class RealtimeLiveService {
  private pc: RTCPeerConnection | null = null
  private micStream: MediaStream | null = null
  private audioEl: HTMLAudioElement | null = null
  private callbacks: RealtimeCallbacks = {}
  private state: RealtimeState = 'idle'
  private sessionTimer: number | null = null

  getState(): RealtimeState {
    return this.state
  }

  isActive(): boolean {
    return this.state === 'connecting' || this.state === 'live'
  }

  private setState(state: RealtimeState, detail?: string): void {
    this.state = state
    try {
      this.callbacks.onStateChange?.(state, detail)
    } catch {
      /* 리스너 오류가 세션을 깨지 않게 */
    }
  }

  /** 리얼타임 세션 시작 — 사내 스냅샷(context)을 지시문에 함께 싣는다. */
  async start(context: string, callbacks: RealtimeCallbacks): Promise<{ ok: boolean; error?: string }> {
    if (this.isActive()) return { ok: true }
    this.callbacks = callbacks
    this.setState('connecting')

    const base = getFunctionsBaseUrl()
    const anon = getSupabaseAnonKey()
    if (!base || !anon) {
      this.setState('error', '서버 미설정')
      return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
    }

    try {
      // ① 에페메럴 토큰 (owner 전용 — 함수가 역할 검증)
      const token = (await authBearer()) ?? anon
      const res = await fetch(`${base}/realtime-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ context: context.slice(0, 4000) })
      })
      const data = (await res.json().catch(() => null)) as { success?: boolean; token?: string; model?: string; error?: string } | null
      if (!res.ok || !data?.success || !data.token) {
        const msg = data?.error ?? `토큰 발급 실패 (HTTP ${res.status})`
        this.setState('error', msg)
        return { ok: false, error: msg }
      }

      // ② 마이크
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // ③ WebRTC 연결
      const pc = new RTCPeerConnection()
      this.pc = pc
      for (const track of this.micStream.getTracks()) pc.addTrack(track, this.micStream)

      const audioEl = document.createElement('audio')
      audioEl.autoplay = true
      this.audioEl = audioEl
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0]
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          this.stop('연결이 끊겼습니다.')
        }
      }

      // 이벤트 채널 — 말하기 상태·전사 텍스트 수신.
      const dc = pc.createDataChannel('oai-events')
      dc.onmessage = (e) => this.handleEvent(String(e.data))

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const model = data.model ?? 'gpt-4o-mini-realtime-preview'
      const sdpRes = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp
      })
      if (!sdpRes.ok) {
        const msg = `리얼타임 연결 실패 (HTTP ${sdpRes.status})`
        this.cleanup()
        this.setState('error', msg)
        return { ok: false, error: msg }
      }
      const answerSdp = await sdpRes.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      // 비용 가드 — 10분 후 자동 종료.
      this.sessionTimer = window.setTimeout(() => {
        this.stop('10분이 지나 자동 종료했습니다. 필요하시면 다시 켜 주세요.')
      }, MAX_SESSION_MS)

      this.setState('live')
      return { ok: true }
    } catch (e) {
      const notAllowed = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'NotFoundError')
      const msg = notAllowed ? '마이크 권한이 필요합니다. 허용 후 다시 시도해 주세요.' : '리얼타임 연결 중 오류가 발생했습니다.'
      this.cleanup()
      this.setState('error', msg)
      return { ok: false, error: msg }
    }
  }

  /** 서버 이벤트 → 말하기 상태·전사 콜백. 알 수 없는 이벤트는 무시. */
  private handleEvent(raw: string): void {
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    const type = String(ev.type ?? '')
    try {
      if (type === 'output_audio_buffer.started' || type === 'response.created') {
        this.callbacks.onAssistantSpeaking?.(true)
      } else if (type === 'output_audio_buffer.stopped' || type === 'response.done' || type === 'output_audio_buffer.cleared') {
        this.callbacks.onAssistantSpeaking?.(false)
      } else if (type === 'response.audio_transcript.done') {
        const text = String((ev as { transcript?: unknown }).transcript ?? '').trim()
        if (text) this.callbacks.onTranscript?.('assistant', text)
      } else if (type === 'conversation.item.input_audio_transcription.completed') {
        const text = String((ev as { transcript?: unknown }).transcript ?? '').trim()
        if (text) this.callbacks.onTranscript?.('user', text)
      }
    } catch {
      /* 콜백 오류 무시 — 세션 유지 */
    }
  }

  /** 세션 종료 (사유는 상태 콜백으로 전달). */
  stop(reason?: string): void {
    const wasActive = this.isActive()
    this.cleanup()
    if (wasActive) this.setState('ended', reason)
  }

  private cleanup(): void {
    if (this.sessionTimer !== null) {
      window.clearTimeout(this.sessionTimer)
      this.sessionTimer = null
    }
    try {
      this.pc?.close()
    } catch {
      /* already closed */
    }
    this.pc = null
    this.micStream?.getTracks().forEach((t) => t.stop())
    this.micStream = null
    if (this.audioEl) {
      this.audioEl.srcObject = null
      this.audioEl = null
    }
    this.callbacks.onAssistantSpeaking?.(false)
  }
}

export const realtimeLiveService = new RealtimeLiveService()
export default RealtimeLiveService
