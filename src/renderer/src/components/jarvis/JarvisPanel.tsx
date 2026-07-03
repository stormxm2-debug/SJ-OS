import {
  Bot,
  SendHorizontal,
  Sparkles,
  Wrench,
  History,
  X,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  Hammer,
  Compass,
  ArrowRight,
  ShieldAlert,
  GitBranch,
  ExternalLink,
  XCircle,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  ShieldCheck,
  Brain,
  Cpu,
  RefreshCw,
  CloudOff,
  Activity,
  AudioLines,
  Server,
  Loader2,
  Boxes,
  Copy,
  Check,
  Layers,
  Radar,
  RotateCcw
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from 'react'
import Card from '@renderer/components/ui/Card'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'
import { voiceService } from '@renderer/services/jarvis/VoiceService'
import type {
  VoiceStatus,
  VoiceEngineMode,
  VoiceDiagnostics
} from '@renderer/services/jarvis/VoiceService'
import { AudioRecorder } from '@renderer/services/jarvis/AudioRecorder'
import { sttProxyClient } from '@renderer/services/jarvis/SttProxyClient'
import type { SttStatusResult } from '@renderer/services/jarvis/SttProxyClient'
import { electronAiGateway } from '@renderer/services/jarvis/ElectronAiGateway'
import type { GatewayStatusResult } from '@renderer/services/jarvis/ElectronAiGateway'
import { jarvisGptBrainService } from '@renderer/services/jarvis/JarvisGptBrainService'
import { normalizeCommand } from '@renderer/services/jarvis/normalize'
import { developerPromptRepository } from '@renderer/services/developer-prompt/DeveloperPromptRepository'
import { startSession } from '@renderer/services/jarvis/commandSession'
import type {
  JarvisCommandSession,
  JarvisMode,
  JarvisState,
  JarvisStatus,
  JarvisTimelineStepStatus
} from '@renderer/services/jarvis/types'
import JarvisAiCore, { type AiCoreStatus } from './JarvisAiCore'
import JarvisCommandTimeline from './JarvisCommandTimeline'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { useAppMode } from '@renderer/navigation/AppModeContext'
import type { View } from '@renderer/navigation/types'

/** Simple, arg-free views a Jarvis navigation target can jump to. */
const NAV_VIEWS = new Set([
  'assistant', 'company', 'dashboard', 'fcos', 'customer', 'sales-activity', 'schedule',
  'performance', 'team-leader', 'consultation', 'insurance-analysis', 'cto', 'qa', 'release',
  'devops', 'autopilot', 'devos', 'pm', 'backlog', 'workers', 'projects', 'approvals',
  'app-builder', 'devprompt', 'activity', 'settings'
])

function toView(target: string | null | undefined): View | null {
  if (!target || !NAV_VIEWS.has(target)) return null
  return { name: target } as View
}

/**
 * Interaction-lock safety: ensure nothing has left global pointer-events disabled
 * on <body>/<html>. Nothing in the app sets these, but clearing them defensively
 * guarantees the app can never be left unclickable by a stray global lock.
 */
function clearGlobalPointerLocks(): void {
  if (typeof document === 'undefined') return
  document.body.style.pointerEvents = ''
  document.documentElement.style.pointerEvents = ''
}

/** Minimum push-to-talk duration; shorter clips are treated as "too short". */
const MIN_RECORDING_MS = 800

// CEO-mode quick commands — company/dev/build focus.
const CEO_COMMAND_CHIPS = [
  '오늘 조직 상황 브리핑 해줘',
  '쇼핑몰 시스템 만들어',
  '쇼핑몰 업무 자동화해',
  'AI 영상 광고 제작 시스템 만들어',
  'FC OS에 팀별 필터 만들어',
  '오토파일럿 열어줘',
  '이번 달 실적',
  '우리 회사 앱 다음 기능 추천해줘'
]

// Staff-mode quick commands — daily insurance work focus.
const STAFF_COMMAND_CHIPS = [
  '오늘 일정',
  '오늘 FC 출근 현황',
  '클로징 예정 고객',
  '미완료 활동',
  '이번 달 실적',
  '상담 열어줘',
  '보험분석 열어줘',
  '고객 워크스페이스 열어줘'
]

function statusLabel(status: JarvisStatus): string {
  switch (status) {
    case 'thinking':
      return '분석 중'
    case 'running':
      return '실행 중'
    case 'completed':
      return '완료'
    case 'error':
      return '오류'
    default:
      return '대기 중'
  }
}

function statusClasses(status: JarvisStatus): string {
  switch (status) {
    case 'thinking':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    case 'running':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-300'
    case 'completed':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    case 'error':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-300'
    default:
      return 'border-slate-700 bg-slate-800/70 text-slate-300'
  }
}

const MODE_META: Record<JarvisMode, { label: string; classes: string }> = {
  answer: { label: '응답', classes: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  briefing: { label: '브리핑', classes: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' },
  'implementation-request': { label: '구현', classes: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  'universal-build': { label: '앱 빌더', classes: 'border-violet-500/30 bg-violet-500/10 text-violet-300' },
  navigation: { label: '이동', classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  'external-action': { label: '외부', classes: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  gpt: { label: 'GPT 브레인', classes: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300' },
  unknown: { label: '미확인', classes: 'border-slate-700 bg-slate-800/70 text-slate-300' }
}

const RISK_TONE: Record<string, string> = {
  low: 'text-slate-300',
  medium: 'text-amber-300',
  high: 'text-rose-300',
  critical: 'text-rose-400'
}

/** Korean label + tone for the current voice engine mode. */
const ENGINE_META: Record<VoiceEngineMode, { label: string; classes: string }> = {
  'web-speech': { label: 'Web Speech (로컬 브라우저)', classes: 'text-emerald-300' },
  'stt-proxy-ready': { label: 'STT 프록시 (준비됨)', classes: 'text-emerald-300' },
  'stt-proxy-disabled': { label: 'STT 프록시 권장 (비활성화)', classes: 'text-amber-300' },
  unavailable: { label: '사용 불가', classes: 'text-rose-300' }
}

const MIC_PERMISSION_LABEL: Record<string, string> = {
  granted: '허용됨',
  denied: '차단됨',
  prompt: '요청 필요',
  unknown: '알 수 없음'
}

/**
 * The selectable Jarvis voice engine, in preference order:
 *  A. 'electron-gateway' — Electron Main AI Gateway (DEFAULT desktop mode).
 *  B. 'stt-proxy'        — Legacy sj-ai-proxy (optional/advanced fallback).
 *  C. 'web-speech'       — Browser-local Web Speech (offline fallback).
 */
type VoiceEngineChoice = 'electron-gateway' | 'stt-proxy' | 'web-speech'

/** Korean label + tone for the Electron AI Gateway readiness status. */
const GATEWAY_STATUS_META: Record<string, { label: string; classes: string }> = {
  'Gateway Ready': { label: 'OpenAI 준비됨', classes: 'text-emerald-300' },
  'Gateway Disabled': { label: 'OPENAI_ENABLED=false', classes: 'text-amber-300' },
  'Key Missing': { label: 'API 키 없음 (루트 .env)', classes: 'text-amber-300' },
  'Gateway Unavailable': { label: '게이트웨이 사용 불가', classes: 'text-rose-300' }
}

/** Segmented-control tab classes for the voice engine selector. */
function engineTabClasses(active: boolean): string {
  return [
    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition',
    active ? 'bg-indigo-500/15 text-indigo-200' : 'bg-slate-900/40 text-slate-400 hover:text-slate-200'
  ].join(' ')
}

/** Korean label + tone for the backend STT readiness status. */
const STT_STATUS_META: Record<string, { label: string; classes: string }> = {
  'STT Ready': { label: 'STT 프록시 준비됨', classes: 'text-emerald-300' },
  'STT Disabled': { label: 'STT 프록시 비활성화', classes: 'text-amber-300' },
  'Key Missing': { label: 'API 키 없음 (백엔드)', classes: 'text-amber-300' },
  'Proxy Offline': { label: '프록시 오프라인', classes: 'text-rose-300' }
}

export default function JarvisPanel(): JSX.Element | null {
  const [service] = useState(() => jarvisService)
  const [voice] = useState(() => voiceService)
  const [state, setState] = useState<JarvisState>(() => service.getState())
  const [draft, setDraft] = useState('')
  const [streamedResponse, setStreamedResponse] = useState('')
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false)
  const [diagnostics, setDiagnostics] = useState<VoiceDiagnostics>(() => voice.getDiagnostics())
  const [lastCommand, setLastCommand] = useState('')
  const [promptCopied, setPromptCopied] = useState(false)
  // Fast-UX command session + progressive timeline reveal.
  const [session, setSession] = useState<JarvisCommandSession | null>(null)
  const [revealed, setRevealed] = useState(0)
  const recognitionSupported = voice.isRecognitionSupported()
  const synthesisSupported = voice.isSynthesisSupported()

  // Voice engines: recorder (gateway + proxy) + per-engine status + record state.
  // Command mode: short 5s auto-send cap, 10s hard safety cap.
  const [recorder] = useState(() => new AudioRecorder(8, 12))
  const recorderSupported = recorder.isSupported()
  const gatewayAvailable = electronAiGateway.isAvailable()
  // Default to the Electron Main AI Gateway on desktop; fall back to Web Speech
  // (or the legacy proxy) only when the gateway bridge is not present.
  const [voiceEngine, setVoiceEngine] = useState<VoiceEngineChoice>(() =>
    gatewayAvailable ? 'electron-gateway' : voice.isRecognitionSupported() ? 'web-speech' : 'stt-proxy'
  )
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [sttStatus, setSttStatus] = useState<SttStatusResult | null>(null)
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatusResult | null>(null)
  const [lastTranscript, setLastTranscript] = useState('')
  // Non-error voice notice (e.g. "최대 녹음 시간 도달, 전사합니다").
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null)
  // Compact voice pipeline timing diagnostics (ms), shown after a voice command.
  const [voiceTiming, setVoiceTiming] = useState<{
    recordingMs: number
    transcriptionMs: number
    routingMs: number
    totalMs: number
  } | null>(null)
  // Optional wake mode ("자비스 호출 대기") — OFF by default, opt-in only.
  const [wakeEnabled, setWakeEnabled] = useState(false)
  const [wakeStatus, setWakeStatus] = useState<'standby' | 'detected' | 'awaiting'>('standby')
  const wakeEnabledRef = useRef(false)
  // Live elapsed recording time (seconds) shown while holding the mic.
  const [recordingElapsed, setRecordingElapsed] = useState(0)
  // Why the last recording stopped (손을 뗌 / 최대 시간 도달 / 취소됨 / 오류 / 너무 짧음).
  const [stopReason, setStopReason] = useState<string | null>(null)
  // Cleanup for the temporary window pointerup/cancel listener armed while holding
  // the mic (so release is detected even if the cursor leaves the button).
  const micReleaseRef = useRef<null | (() => void)>(null)
  // True when the current recording ended by hitting the max duration.
  const maxReachedRef = useRef(false)
  // Last time the interaction state was reset (for the stability diagnostics).
  const [lastReset, setLastReset] = useState<string>('—')
  const gptConfig = jarvisGptBrainService.getConfig()
  const { navigate } = useNavigation()
  const { mode } = useAppMode()
  const commandChips = mode === 'staff' ? STAFF_COMMAND_CHIPS : CEO_COMMAND_CHIPS

  // Persistent GPT status badge: Ready / Disabled / Proxy Error / Local Only.
  const gptStatus = ((): { label: string; classes: string } => {
    if (!gptConfig.enabled) {
      return { label: 'GPT 비활성화', classes: 'border-slate-700 bg-slate-800/70 text-slate-300' }
    }
    if (state.gpt?.source === 'backend') {
      return { label: 'API 키 없음', classes: 'border-amber-500/30 bg-amber-500/10 text-amber-300' }
    }
    if (state.gpt?.source === 'error') {
      return { label: '프록시 오류', classes: 'border-rose-500/30 bg-rose-500/10 text-rose-300' }
    }
    if (state.source === 'local') {
      return { label: '로컬 전용', classes: 'border-slate-700 bg-slate-800/70 text-slate-300' }
    }
    return { label: 'GPT 준비됨', classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' }
  })()

  // Subscribe to the Jarvis singleton so any state change (Topbar "자비스" button,
  // command execution, close) re-renders the panel. Without this the singleton
  // and the panel's local copy desync, leaving the full-screen modal open/closed
  // out of step with the rest of the app and trapping clicks. Sync once on mount
  // to catch any state that changed before the subscription attached.
  useEffect(() => {
    const sync = (): void => setState(service.getState())
    sync()
    return service.subscribe(sync)
  }, [service])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
        event.preventDefault()
        service.toggle()
        setState(service.getState())
      }

      if (event.key === 'Escape' && service.getState().isOpen) {
        event.preventDefault()
        service.close()
        setState(service.getState())
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [service])

  useEffect(() => {
    if (!state.isOpen) {
      return
    }

    const field = document.getElementById('jarvis-command-input') as HTMLInputElement | null
    field?.focus()
  }, [state.isOpen])

  // Apply a queued prefill (e.g. from a dashboard 추천 명령): copy it into the
  // input, focus, then clear it. The command is NOT auto-executed — the user
  // reviews/edits and presses Enter / Send.
  useEffect(() => {
    if (!state.pendingDraft) return
    setDraft(state.pendingDraft)
    service.consumePendingDraft()
    const field = document.getElementById('jarvis-command-input') as HTMLInputElement | null
    field?.focus()
  }, [state.pendingDraft, service])

  useEffect(() => {
    if (state.status === 'thinking' || state.status === 'running') {
      setStreamedResponse('')
      const response = state.response
      let index = 0
      const timer = window.setInterval(() => {
        setStreamedResponse(response.slice(0, index))
        index += 1
        if (index > response.length) {
          window.clearInterval(timer)
          setStreamedResponse(response)
        }
      }, 18)

      return () => window.clearInterval(timer)
    }

    setStreamedResponse(state.response)
    return undefined
  }, [state.response, state.status])

  // Progressive timeline reveal: advance one step at a time so the command
  // timeline animates even though local processing is near-instant. The
  // optimistic "analyzing" session holds until the finalized session arrives.
  useEffect(() => {
    if (!session || session.status === 'analyzing') return undefined
    if (revealed >= session.steps.length) return undefined
    const timer = window.setTimeout(() => {
      setRevealed((r) => Math.min(r + 1, session.steps.length))
    }, 200)
    return () => window.clearTimeout(timer)
  }, [session, revealed])

  // Live elapsed recording time while the mic is held.
  useEffect(() => {
    if (!recording) return undefined
    const start = performance.now()
    const timer = window.setInterval(() => {
      setRecordingElapsed((performance.now() - start) / 1000)
    }, 100)
    return () => window.clearInterval(timer)
  }, [recording])

  // Stabilization safety: clear any stray global pointer-events lock on mount so
  // the app can never load in an unclickable state.
  useEffect(() => {
    clearGlobalPointerLocks()
  }, [])

  // Long-session safety timeout guards — auto-reset transient voice/command
  // states if they ever get stuck, so the UI can never be left permanently in a
  // loading/recording state. Each is a single per-transition timeout, cleared on
  // change or unmount (no accumulation).
  useEffect(() => {
    if (!recording) return undefined
    const t = window.setTimeout(() => {
      recorder.stop()
      setRecording(false)
      setVoiceStatus('idle')
      setVoiceNotice('녹음이 자동으로 종료되었습니다.')
    }, 13000)
    return () => window.clearTimeout(t)
  }, [recording, recorder])

  useEffect(() => {
    if (!transcribing) return undefined
    const t = window.setTimeout(() => {
      setTranscribing(false)
      setVoiceError('전사 시간이 초과되었습니다. 다시 시도해 주세요.')
    }, 16000)
    return () => window.clearTimeout(t)
  }, [transcribing])

  useEffect(() => {
    if (state.status !== 'thinking' && state.status !== 'running') return undefined
    const t = window.setTimeout(() => {
      // Stuck-execution guard: never leave Jarvis in a permanent loading state.
      service.resetCommandState()
      setState(service.getState())
    }, 20000)
    return () => window.clearTimeout(t)
  }, [state.status, service])

  const applyResult = (result: Awaited<ReturnType<typeof service.executeCommand>>): void => {
    setState({
      ...service.getState(),
      response: result.response,
      status: result.status,
      mode: result.mode,
      toolCalls: result.toolCalls,
      answer: result.answer,
      implementation: result.implementation,
      universalBuild: result.universalBuild,
      external: result.external,
      gpt: result.gpt,
      source: result.source,
      navigationTarget: result.navigationTarget ?? null,
      suggestedCommands: result.suggestedCommands ?? []
    })
    // Read the Jarvis answer aloud when voice output is on. TTS is fire-and-forget
    // (the browser speaks asynchronously) and guarded so a speech error can never
    // block the UI or future commands.
    if (voiceOutputEnabled) {
      try {
        voice.speak(result.response)
      } catch {
        /* TTS is best-effort; never let it break the command flow */
      }
    }
  }

  const runCommand = async (command: string): Promise<void> => {
    const trimmed = command.trim()
    if (!trimmed) return
    setDraft('')
    setLastCommand(trimmed)
    // Optimistic UI: show "명령 수신 완료" + timeline instantly, before any
    // processing runs, so Jarvis feels immediate even if later steps take time.
    setSession(startSession(trimmed, new Date().toISOString()))
    setRevealed(1)
    try {
      const result = await service.executeCommand(trimmed)
      applyResult(result)
      if (result.session) {
        // Adopt the finalized session and replay its timeline progressively.
        setSession(result.session)
        setRevealed(1)
      }
    } finally {
      // Defensive recovery: always resync from the authoritative service state so
      // the panel can never be left stuck showing 'running' after an unexpected
      // throw. The UI stays clickable and the modal stays dismissible.
      setState(service.getState())
    }
  }

  // Explicitly route a command to the GPT brain (bypasses the local router).
  const askGpt = async (command: string): Promise<void> => {
    const trimmed = command.trim()
    if (!trimmed) return
    setLastCommand(trimmed)
    setState({ ...service.getState(), status: 'running', mode: 'gpt', response: 'GPT 브레인에 질의하는 중입니다…' })
    try {
      const result = await service.askGpt(trimmed)
      applyResult(result)
    } finally {
      // Never leave the optimistic 'running' state stuck if askGpt ever throws.
      setState(service.getState())
    }
  }

  const submitCommand = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    await runCommand(draft)
  }

  // Route a completed voice transcript through the SAME command router as typed
  // input, after normalizing it with the shared Jarvis helper. Identical to the
  // typed path, so voice and text behave the same and share command history.
  const handleVoiceTranscript = async (transcript: string): Promise<void> => {
    const normalized = normalizeCommand(transcript).spaced
    if (!normalized) return
    setInterimTranscript('')
    setLastTranscript(normalized)
    await runCommand(normalized)
  }

  const refreshDiagnostics = (): void => setDiagnostics(voice.getDiagnostics())

  // Manual "프록시 상태 새로고침": force a fresh probe that ignores any cached
  // working URL and hits http://localhost:8787 then http://127.0.0.1:8787.
  const refreshSttStatus = (): void => {
    void sttProxyClient.forceCheckStatus().then(setSttStatus)
  }

  // Manual refresh of the Electron Main AI Gateway status — forces a fresh probe
  // (bypasses the 30s cache). Automatic on-open checks use the cached path.
  const refreshGatewayStatus = (): void => {
    void electronAiGateway.forceCheckStatus().then(setGatewayStatus)
  }

  // --- Web Speech engine (browser-local recognition) ---
  const startListening = (): void => {
    setVoiceError(null)
    setInterimTranscript('')
    voice.stopSpeaking()
    voice.startListening({
      onStatusChange: setVoiceStatus,
      onInterim: setInterimTranscript,
      onError: (message, code) => {
        setVoiceError(message)
        refreshDiagnostics()
        // A network failure means Web Speech is unreliable here — recommend the
        // stable STT Proxy engine by switching the selection to it.
        if (code === 'network' || code === 'service-not-allowed') {
          setVoiceEngine('stt-proxy')
          refreshSttStatus()
        }
      },
      onFinal: (text) => {
        refreshDiagnostics()
        void handleVoiceTranscript(text)
      }
    })
  }

  const stopListening = (): void => {
    voice.stopListening()
  }

  // --- Recording engines (Electron gateway + legacy STT proxy) ---
  // Both record audio with the same recorder; only the transcription backend
  // differs (main process vs. legacy proxy), chosen in transcribeAndRoute.
  const startRecording = (): void => {
    setVoiceError(null)
    setVoiceNotice(null)
    setInterimTranscript('')
    setVoiceTiming(null)
    setRecordingElapsed(0)
    setStopReason(null)
    maxReachedRef.current = false
    voice.stopSpeaking()
    // Release the mic from wake-mode Web Speech while push-to-talk records.
    if (wakeEnabledRef.current) voice.stopListening()
    // Immediate feedback: show "듣는 중" within the same event, before the async
    // getUserMedia resolves. onStart re-confirms; onError rolls it back.
    setRecording(true)
    setVoiceStatus('listening')
    void recorder.start({
      onStart: () => {
        setRecording(true)
        setVoiceStatus('listening')
      },
      onMaxReached: () => {
        maxReachedRef.current = true
        setVoiceNotice('최대 녹음 시간 도달, 전사합니다')
      },
      onError: (message) => {
        disarmMicRelease()
        setRecording(false)
        setVoiceStatus('error')
        setStopReason('오류')
        setVoiceError(message)
      },
      onStop: (blob, _mime, durationMs) => {
        disarmMicRelease()
        setRecording(false)
        setVoiceStatus('idle')
        // Guard against a too-short clip (accidental tap) — MediaRecorder may not
        // have collected any audio yet, which would fail transcription.
        if (!maxReachedRef.current && durationMs < MIN_RECORDING_MS) {
          setStopReason('너무 짧음')
          setVoiceNotice('너무 짧게 녹음되었습니다. 다시 말해주세요.')
          return
        }
        setStopReason(maxReachedRef.current ? '최대 시간 도달' : '손을 뗌')
        void transcribeAndRoute(blob, durationMs)
      }
    })
  }

  const stopRecording = (): void => {
    recorder.stop()
  }

  // Transcribe the recorded clip via the selected backend, then route the
  // transcript through the SAME local Jarvis router as typed input. Never crashes.
  //  - 'electron-gateway' → Electron Main process (default desktop path).
  //  - 'stt-proxy'        → legacy sj-ai-proxy (optional/advanced fallback).
  // Records compact timing diagnostics (recording / transcription / routing) and
  // always clears the transcribing state in a finally so the UI never locks.
  const transcribeAndRoute = async (blob: Blob, recordingMs: number): Promise<void> => {
    const usingGateway = voiceEngine === 'electron-gateway'
    setTranscribing(true)
    setVoiceStatus('idle')
    const transcribeStart = performance.now()
    try {
      const result = usingGateway
        ? await electronAiGateway.transcribeAudio(blob)
        : await sttProxyClient.transcribeAudio(blob)
      const transcriptionMs = performance.now() - transcribeStart
      if (!result.success) {
        // A failure may mean the gateway lost its key / became disabled — force a
        // fresh status probe (bypassing the cache) so the badge reflects reality.
        if (usingGateway) void electronAiGateway.forceCheckStatus().then(setGatewayStatus)
        else refreshSttStatus()
        setVoiceError(result.errorMessage ?? 'STT 전사에 실패했습니다. 텍스트 입력을 사용해 주세요.')
        return
      }
      if (!result.transcript) {
        setVoiceError('음성에서 명령을 인식하지 못했습니다. 다시 시도해 주세요.')
        return
      }
      // Show the transcript immediately, then route it through the same router.
      setLastTranscript(result.transcript)
      const routeStart = performance.now()
      await handleVoiceTranscript(result.transcript)
      const routingMs = performance.now() - routeStart
      setVoiceTiming({
        recordingMs: Math.round(recordingMs),
        transcriptionMs: Math.round(transcriptionMs),
        routingMs: Math.round(routingMs),
        totalMs: Math.round(recordingMs + transcriptionMs + routingMs)
      })
    } finally {
      // Always clear the transcribing state so the mic + UI stay usable.
      setTranscribing(false)
      // Resume wake-mode listening if it was enabled before this recording.
      if (wakeEnabledRef.current) window.setTimeout(() => startWakeLoop(), 250)
    }
  }

  // The mic button dispatches to the selected engine.
  const usesRecorder = voiceEngine === 'electron-gateway' || voiceEngine === 'stt-proxy'
  const startVoice = (): void => {
    if (usesRecorder) startRecording()
    else startListening()
  }
  const stopVoice = (): void => {
    if (usesRecorder) stopRecording()
    else stopListening()
  }
  const voiceActive = voiceStatus === 'listening' || recording
  const canStartVoice = usesRecorder ? recorderSupported : recognitionSupported

  // Remove the temporary window release listener armed while holding the mic.
  const disarmMicRelease = (): void => {
    micReleaseRef.current?.()
    micReleaseRef.current = null
  }

  // Arm a ONE-TIME window pointerup/cancel listener so releasing the mouse/pen
  // ANYWHERE stops recording — even if the cursor drifted off the button while
  // held. This replaces the old onPointerLeave stop, which killed recording on
  // the slightest jitter ("금방 꺼짐"). The listener removes itself on release
  // (and via disarmMicRelease); it is never a permanent global listener.
  const armMicRelease = (): void => {
    disarmMicRelease()
    const onRelease = (): void => {
      disarmMicRelease()
      stopVoice() // idempotent — recorder.stop() is safe even if already stopped
    }
    window.addEventListener('pointerup', onRelease)
    window.addEventListener('pointercancel', onRelease)
    micReleaseRef.current = () => {
      window.removeEventListener('pointerup', onRelease)
      window.removeEventListener('pointercancel', onRelease)
    }
  }

  // True push-to-talk for the recorder engines: hold to record, release to send.
  //  - pointerdown → start recording immediately + arm the window release listener
  //  - release (pointerup/cancel anywhere) → stop + send
  //  - Space/Enter hold → same, for keyboard accessibility
  // No onClick / onPointerLeave is attached, so a slight cursor drift never stops
  // recording and a trailing click can never double-trigger.
  const handleMicPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!usesRecorder) return
    event.preventDefault()
    if (transcribing || voiceActive) return
    startVoice()
    armMicRelease()
  }
  const handleMicKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!usesRecorder) return
    if (event.key !== ' ' && event.key !== 'Enter') return
    if (event.repeat) return
    event.preventDefault()
    if (transcribing || voiceActive) return
    startVoice()
  }
  const handleMicKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!usesRecorder) return
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    if (recording) stopVoice()
  }

  const toggleVoiceOutput = (): void => {
    const next = voice.setVoiceOutput(!voiceOutputEnabled)
    setVoiceOutputEnabled(next)
    if (!next) voice.stopSpeaking()
  }

  // --- Optional wake mode ("자비스 호출 대기") -----------------------------------
  // Opt-in only, using local Web Speech recognition. NO always-on OpenAI STT, NO
  // hidden background recording, NO audio saved. A visible indicator is always
  // shown while enabled. When Web Speech is unavailable, the mode is refused with
  // a clear message so the user falls back to push-to-talk.
  const startWakeLoop = (): void => {
    if (!wakeEnabledRef.current) return
    voice.startListening({
      onInterim: (text) => {
        if (text.includes('자비스')) setWakeStatus('detected')
      },
      onStatusChange: (s) => {
        // Web Speech is single-utterance; restart the loop while wake stays on
        // and no push-to-talk / transcription is in progress.
        if (s === 'idle' && wakeEnabledRef.current && !recording && !transcribing) {
          window.setTimeout(() => startWakeLoop(), 250)
        }
      },
      onError: () => {
        // Web Speech unreliable here → disable wake and fall back to push-to-talk.
        wakeEnabledRef.current = false
        setWakeEnabled(false)
        setWakeStatus('standby')
        setVoiceNotice('이 환경에서는 호출 대기 모드가 제한됩니다. 누르고 말하기를 사용하세요.')
      },
      onFinal: (text) => {
        const idx = text.lastIndexOf('자비스')
        if (idx === -1) return // ignore utterances without the wake word
        const command = text.slice(idx + '자비스'.length).trim()
        if (command) {
          setWakeStatus('standby')
          void handleVoiceTranscript(command)
        } else {
          setWakeStatus('awaiting')
        }
      }
    })
  }

  const toggleWake = (): void => {
    // STABILIZATION: the wake engine is disabled. It never starts background
    // listening, keeps no global listeners, and shows a safe message. Push-to-talk
    // remains the supported voice path.
    wakeEnabledRef.current = false
    setWakeEnabled(false)
    setWakeStatus('standby')
    voice.stopListening()
    setVoiceNotice('호출 대기 모드는 장시간 안정화 후 다시 활성화됩니다. 현재는 누르고 말하기를 사용하세요.')
  }

  // --- Reset / refresh controls (Part I) ---------------------------------------
  // Clears the current command session, timeline, voice transient state, errors
  // and loading — WITHOUT wiping any business data.
  const resetJarvis = (): void => {
    recorder.stop()
    voice.stopSpeaking()
    voice.stopListening()
    wakeEnabledRef.current = false
    setWakeEnabled(false)
    service.resetCommandState()
    setSession(null)
    setRevealed(0)
    setVoiceTiming(null)
    setVoiceError(null)
    setVoiceNotice(null)
    setLastTranscript('')
    setInterimTranscript('')
    setTranscribing(false)
    setRecording(false)
    setStreamedResponse('')
    setWakeStatus('standby')
    clearGlobalPointerLocks()
    setLastReset(new Date().toLocaleTimeString())
    setState(service.getState())
  }

  // Full app refresh (reloads the renderer). Business data persists in storage.
  const refreshApp = (): void => {
    if (typeof window !== 'undefined') window.location.reload()
  }

  // Stop mic + speech + recording when the panel closes so nothing keeps running.
  const isOpen = state.isOpen
  useEffect(() => {
    if (!isOpen) {
      // Disable wake mode + release the mic whenever the panel closes, so nothing
      // keeps listening in the background.
      wakeEnabledRef.current = false
      setWakeEnabled(false)
      // Remove any armed push-to-talk window release listener.
      micReleaseRef.current?.()
      micReleaseRef.current = null
      voice.stopListening()
      voice.stopSpeaking()
      recorder.stop()
      setInterimTranscript('')
      setRecording(false)
      setVoiceStatus('idle')
      return
    }
    // On open, refresh mic permission + capability diagnostics (best-effort).
    void voice.refreshMicPermission().then(() => setDiagnostics(voice.getDiagnostics()))
  }, [isOpen, voice, recorder])

  // Probe AI readiness whenever the panel is open and when the engine changes.
  //  - Electron Main AI Gateway is the default desktop path → always checked.
  //  - Legacy sj-ai-proxy is probed only when its engine is selected, so the app
  //    no longer depends on a running proxy just to open Voice Mode.
  useEffect(() => {
    if (!isOpen) return
    if (gatewayAvailable) void electronAiGateway.checkStatus().then(setGatewayStatus)
    if (voiceEngine === 'stt-proxy') void sttProxyClient.checkStatus().then(setSttStatus)
  }, [isOpen, voiceEngine, gatewayAvailable])

  const goToTarget = (target: string | null | undefined): void => {
    const view = toView(target)
    if (!view) return
    navigate(view)
    service.close()
    setState(service.getState())
  }

  // Copy the generated Claude Code developer prompt to the clipboard. Falls back
  // to selecting the textarea when the Clipboard API is unavailable. When a
  // Developer Prompt Center packet id is given, the packet is marked "복사됨" so
  // its status can be tracked (생성됨 → 복사됨 → Claude 전달됨 → 개발 중 → 완료).
  const copyPrompt = (
    prompt: string,
    opts?: { packetId?: string | null; fallbackId?: string }
  ): void => {
    if (opts?.packetId) developerPromptRepository.markCopied(opts.packetId)
    const done = (): void => {
      setPromptCopied(true)
      window.setTimeout(() => setPromptCopied(false), 2000)
    }
    const selectFallback = (): void => {
      const field = document.getElementById(
        opts?.fallbackId ?? 'jarvis-build-prompt'
      ) as HTMLTextAreaElement | null
      field?.select()
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(prompt).then(done).catch(selectFallback)
      return
    }
    selectFallback()
  }

  // The command session with per-step statuses resolved for the current reveal
  // frame (steps before `revealed` show their final status; the current one
  // shows running; the rest stay pending).
  const displayedSession = useMemo<JarvisCommandSession | null>(() => {
    if (!session) return null
    const steps = session.steps.map((step, index) => {
      let status: JarvisTimelineStepStatus
      if (index < revealed) status = step.status
      else if (index === revealed) status = step.status === 'pending' ? 'pending' : 'running'
      else status = 'pending'
      return { ...step, status }
    })
    return { ...session, steps }
  }, [session, revealed])

  // Drive the AI Core visual from the current phase. Voice phases (듣는 중 / 전사 중)
  // take precedence so the orb reacts the instant the mic is held/released.
  const coreStatus = useMemo<AiCoreStatus>(() => {
    if (recording || voiceStatus === 'listening') return 'listening'
    if (transcribing) return 'transcribing'
    if (displayedSession) {
      const total = displayedSession.steps.length
      if (revealed >= total) return displayedSession.status === 'failed' ? 'failed' : 'completed'
      const running = displayedSession.steps.find((s) => s.status === 'running')
      if (running) {
        if (running.label.includes('프롬프트') || running.label.includes('실행')) return 'executing'
        if (running.label.includes('계획') || running.label.includes('분류') || running.label.includes('설계')) {
          return 'planning'
        }
      }
      return 'analyzing'
    }
    if (state.status === 'thinking' || state.status === 'running') return 'analyzing'
    if (wakeEnabled) return 'wake'
    return 'idle'
  }, [displayedSession, revealed, state.status, recording, voiceStatus, transcribing, wakeEnabled])

  if (!state.isOpen) {
    return null
  }

  const answer = state.answer
  const impl = state.implementation
  const build = state.universalBuild
  const external = state.external
  const gpt = state.gpt

  return (
    // STABILIZATION: Jarvis is a docked side panel, NOT a full-screen modal.
    // There is no full-screen backdrop/overlay, so the sidebar and main content
    // are always clickable while Jarvis is open. Closing unmounts this entirely.
    <div className="fixed bottom-3 right-3 top-3 z-50 flex w-[min(94vw,640px)]">
      <div className="flex w-full flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 shadow-2xl shadow-indigo-900/25 ring-1 ring-indigo-500/10">
        <header className="relative flex items-center justify-between overflow-hidden border-b border-slate-800 bg-gradient-to-r from-indigo-50 via-white to-violet-50 px-5 py-4">
          <div className="relative flex items-center gap-3">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/40">
              <Bot className="relative h-5 w-5" />
            </div>
            <div>
              <p className="flex items-center gap-2 text-sm font-bold text-slate-100">
                SJ 자비스 코어
                <span className="rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                  AI Core
                </span>
                <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[9px] font-bold text-indigo-300">
                  {mode === 'staff' ? '직원 모드' : '대표 모드'}
                </span>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-600">
                  안전 시각화 모드
                </span>
              </p>
              <p className="text-xs text-slate-500">
                {mode === 'staff'
                  ? '직원 업무 어시스턴트 · 일정 · 고객 · 실적 · 상담'
                  : 'AI 업무 어시스턴트 · 명령 · 분석 · 실행'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {voiceStatus === 'listening' ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-300">
                <Mic className="h-3 w-3 animate-pulse" />
                Voice
              </span>
            ) : voiceOutputEnabled ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-300">
                <Volume2 className="h-3 w-3" />
                Voice
              </span>
            ) : null}
            {state.source ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                  state.source === 'gpt'
                    ? 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300'
                    : state.source === 'fallback'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      : 'border-slate-700 bg-slate-800/70 text-slate-300'
                }`}
              >
                {state.source === 'gpt' ? (
                  <Cpu className="h-3 w-3" />
                ) : state.source === 'fallback' ? (
                  <CloudOff className="h-3 w-3" />
                ) : (
                  <Bot className="h-3 w-3" />
                )}
                {state.source === 'gpt' ? 'GPT' : state.source === 'fallback' ? '폴백' : '로컬'}
              </span>
            ) : null}
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${gptStatus.classes}`}
              title="OpenAI 프록시 상태"
            >
              <Brain className="h-3 w-3" />
              {gptStatus.label}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${MODE_META[state.mode].classes}`}>
              {MODE_META[state.mode].label}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusClasses(state.status)}`}>
              {statusLabel(state.status)}
            </span>
            <button
              type="button"
              onClick={resetJarvis}
              title="상태 초기화 · 명령/타임라인/음성/오류/로딩 상태 초기화"
              aria-label="상태 초기화"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-2 text-[11px] font-medium text-slate-400 transition hover:border-indigo-500/40 hover:text-indigo-300"
            >
              <RotateCcw className="h-4 w-4" />
              상태 초기화
            </button>
            <button
              type="button"
              onClick={refreshApp}
              title="앱 새로고침"
              aria-label="앱 새로고침"
              className="rounded-lg border border-slate-700 p-2 text-slate-400 transition hover:border-indigo-500/40 hover:text-indigo-300"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                service.close()
                setState(service.getState())
              }}
              className="rounded-lg border border-slate-700 p-2 text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
              aria-label="Close Jarvis"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="grid gap-4 overflow-y-auto p-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <Card title="명령 입력" icon={<Sparkles className="h-4 w-4 text-indigo-300" />}>
              <form onSubmit={submitCommand} className="space-y-3">
                <label htmlFor="jarvis-command-input" className="text-sm text-slate-400">
                  SJ 자비스에 명령 보내기
                </label>
                <div className="flex gap-2">
                  <input
                    id="jarvis-command-input"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="예: 오늘 브리핑 · FC OS에 팀별 필터 추가해"
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2.5 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2.5 text-sm font-medium text-indigo-300 transition hover:bg-indigo-500/20"
                  >
                    <SendHorizontal className="h-4 w-4" />
                    실행
                  </button>
                  <button
                    type="button"
                    onClick={() => askGpt(draft)}
                    title={gptConfig.enabled ? 'GPT 브레인에 질의' : 'GPT 브레인이 비활성화됨 (설정 안내 표시)'}
                    className="inline-flex items-center gap-2 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2.5 text-sm font-medium text-fuchsia-300 transition hover:bg-fuchsia-500/20"
                  >
                    <Brain className="h-4 w-4" />
                    GPT
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {commandChips.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => runCommand(chip)}
                      className="rounded-full border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-indigo-500/40 hover:text-indigo-200"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500">단축키: Ctrl + Space · 로컬 데이터 전용 · 외부 AI/API 없음</p>
                {/* Subtle interaction diagnostic — confirms no command leaves the
                    UI stuck: '실행 중' returns to 아니오 after every command. */}
                <p className="font-mono text-[10px] text-slate-600">
                  UI 안정 상태 · 실행 중: {state.status === 'thinking' || state.status === 'running' ? 'true' : 'false'} · 녹음:{' '}
                  {recording ? 'true' : 'false'} · 전사: {transcribing ? 'true' : 'false'} · 호출대기:{' '}
                  {wakeEnabled ? 'true' : 'false'} · 마지막 상태 초기화: {lastReset}
                </p>
              </form>
            </Card>

            {/* AI Core + command execution timeline (fast UX). Placed directly
                under the command input so the timeline + response are visible
                immediately on submit — never buried below the Voice mode card. */}
            <Card
              className="border-indigo-500/20 bg-gradient-to-b from-indigo-50/60 to-white ring-1 ring-indigo-500/10"
              title="AI 코어"
              icon={<Cpu className="h-4 w-4 text-indigo-300" />}
              action={
                <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                  Fast Command UX 활성화됨
                </span>
              }
            >
              <JarvisAiCore status={coreStatus} />

              {/* Immediate response text — visible without scrolling. */}
              <div className="mt-3 min-h-[44px] whitespace-pre-line rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs leading-6 text-slate-300">
                {state.status === 'thinking' || state.status === 'running' ? (
                  <span className="flex items-center gap-2 text-slate-400">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    {streamedResponse || '분석 중입니다…'}
                  </span>
                ) : (
                  streamedResponse || state.response
                )}
              </div>

              {displayedSession ? (
                <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
                  <JarvisCommandTimeline session={displayedSession} />
                  {displayedSession.promptPacketId ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        개발 프롬프트 생성 완료
                      </span>
                      <button
                        type="button"
                        onClick={() => goToTarget('devprompt')}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition hover:bg-amber-500/20"
                      >
                        <ArrowRight className="h-3 w-3" />
                        프롬프트 센터로 이동
                      </button>
                    </div>
                  ) : null}
                  {displayedSession.status === 'failed' ? (
                    <button
                      type="button"
                      onClick={() => runCommand(displayedSession.command)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      다시 시도
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-center text-xs text-slate-500">
                  명령을 입력하면 실행 타임라인이 여기에 표시됩니다.
                </p>
              )}
            </Card>

            <Card title="Voice mode" icon={<Mic className="h-4 w-4 text-indigo-300" />}>
              <div className="space-y-3">
                {/* Voice engine selection, in preference order:
                    Electron AI Gateway (default) → STT Proxy (legacy) → Web Speech. */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex overflow-hidden rounded-xl border border-slate-700">
                    <button
                      type="button"
                      onClick={() => {
                        if (!voiceActive) {
                          setVoiceEngine('electron-gateway')
                          refreshGatewayStatus()
                        }
                      }}
                      className={engineTabClasses(voiceEngine === 'electron-gateway')}
                    >
                      <Cpu className="h-3.5 w-3.5" />
                      Electron AI Gateway
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!voiceActive) setVoiceEngine('web-speech')
                      }}
                      className={engineTabClasses(voiceEngine === 'web-speech')}
                    >
                      <Mic className="h-3.5 w-3.5" />
                      Web Speech
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!voiceActive) {
                          setVoiceEngine('stt-proxy')
                          refreshSttStatus()
                        }
                      }}
                      title="Legacy Proxy / optional deployment path"
                      className={engineTabClasses(voiceEngine === 'stt-proxy')}
                    >
                      <Server className="h-3.5 w-3.5" />
                      Legacy Proxy
                    </button>
                  </div>

                  {/* Engine status label */}
                  {voiceEngine === 'electron-gateway' ? (
                    gatewayStatus ? (
                      <span
                        className={`text-[11px] ${GATEWAY_STATUS_META[gatewayStatus.label]?.classes ?? 'text-slate-400'}`}
                      >
                        {GATEWAY_STATUS_META[gatewayStatus.label]?.label ?? gatewayStatus.label}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500">상태 확인 중…</span>
                    )
                  ) : voiceEngine === 'web-speech' ? (
                    <span className={recognitionSupported ? 'text-[11px] text-emerald-300' : 'text-[11px] text-rose-300'}>
                      {recognitionSupported ? 'Web Speech 사용 가능' : 'Web Speech 미지원'}
                    </span>
                  ) : sttStatus ? (
                    <span className={`text-[11px] ${STT_STATUS_META[sttStatus.label]?.classes ?? 'text-slate-400'}`}>
                      {STT_STATUS_META[sttStatus.label]?.label ?? sttStatus.label}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500">상태 확인 중…</span>
                  )}
                </div>

                {/* Controls: engine-aware mic/stop button + voice output toggle. */}
                <div className="flex flex-wrap items-center gap-2">
                  {canStartVoice ? (
                    usesRecorder ? (
                      // True push-to-talk: hold to record, release to send.
                      <button
                        type="button"
                        onPointerDown={handleMicPointerDown}
                        onKeyDown={handleMicKeyDown}
                        onKeyUp={handleMicKeyUp}
                        disabled={transcribing}
                        className={[
                          'inline-flex touch-none select-none items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition',
                          transcribing
                            ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600'
                            : voiceActive
                              ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                              : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'
                        ].join(' ')}
                      >
                        {voiceActive ? <MicOff className="h-4 w-4" /> : <AudioLines className="h-4 w-4" />}
                        {voiceActive ? '듣는 중 · 손을 떼면 전사' : '마이크 (누르고 있는 동안 듣습니다)'}
                      </button>
                    ) : voiceActive ? (
                      <button
                        type="button"
                        onClick={stopVoice}
                        className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2.5 text-sm font-medium text-rose-200 transition hover:bg-rose-500/25"
                      >
                        <MicOff className="h-4 w-4" />
                        듣기 중지
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={startVoice}
                        className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2.5 text-sm font-medium text-indigo-300 transition hover:bg-indigo-500/20"
                      >
                        <Mic className="h-4 w-4" />
                        마이크 (눌러서 말하기)
                      </button>
                    )
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/50 px-3 py-2.5 text-sm text-slate-400">
                      <MicOff className="h-4 w-4" />
                      {usesRecorder ? '오디오 녹음 미지원' : '음성 인식 미지원'}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={toggleVoiceOutput}
                    disabled={!synthesisSupported}
                    className={[
                      'inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition',
                      !synthesisSupported
                        ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600'
                        : voiceOutputEnabled
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                          : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-500'
                    ].join(' ')}
                  >
                    {voiceOutputEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                    음성 출력 {voiceOutputEnabled ? 'ON' : 'OFF'}
                  </button>

                  {/* Optional wake mode — OFF by default, opt-in only. */}
                  <button
                    type="button"
                    onClick={toggleWake}
                    title="켜져 있을 때 '자비스'라고 부르면 짧은 명령을 들을 준비를 합니다."
                    className={[
                      'inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition',
                      wakeEnabled
                        ? 'border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25'
                        : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-500'
                    ].join(' ')}
                  >
                    <Radar className="h-4 w-4" />
                    자비스 호출 대기 {wakeEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>

                {/* Wake-mode indicator — always visible while wake mode is enabled. */}
                {wakeEnabled ? (
                  <div className="flex items-center gap-2 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-400" />
                    </span>
                    {wakeStatus === 'detected'
                      ? '자비스 호출 감지'
                      : wakeStatus === 'awaiting'
                        ? '명령을 말씀하세요'
                        : "호출 대기 중 · '자비스'라고 불러주세요"}
                  </div>
                ) : null}

                {voiceActive ? (
                  <div className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-400" />
                    </span>
                    {usesRecorder
                      ? `듣는 중… ${recordingElapsed.toFixed(1)}초 · 손을 떼면 전사 (최대 ${recorder.getMaxSeconds()}초)`
                      : '자비스가 듣고 있습니다…'}
                  </div>
                ) : null}

                {voiceNotice ? (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {voiceNotice}
                  </div>
                ) : null}

                {transcribing ? (
                  <div className="flex items-center gap-2 rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    전사 중… 잠시만 기다려 주세요.
                  </div>
                ) : null}

                {voiceTiming ? (
                  <p className="font-mono text-[10px] text-slate-500">
                    음성 처리 {(voiceTiming.totalMs / 1000).toFixed(1)}초 · 녹음{' '}
                    {(voiceTiming.recordingMs / 1000).toFixed(1)}초 · 전사{' '}
                    {(voiceTiming.transcriptionMs / 1000).toFixed(1)}초 · 실행{' '}
                    {(voiceTiming.routingMs / 1000).toFixed(1)}초
                  </p>
                ) : null}

                {stopReason ? (
                  <p className="font-mono text-[10px] text-slate-500">
                    마이크 안정화 빌드 · 정지 사유: {stopReason} · 녹음 {recordingElapsed.toFixed(1)}초
                  </p>
                ) : (
                  <p className="font-mono text-[10px] text-slate-600">마이크 안정화 빌드 · 누르고 있는 동안 녹음됩니다</p>
                )}

                {interimTranscript ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
                    <span className="text-slate-500">인식 중: </span>
                    {interimTranscript}
                  </div>
                ) : null}

                {lastTranscript && !voiceActive && !interimTranscript ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
                    <span className="text-slate-500">인식된 명령: </span>
                    {lastTranscript}
                  </div>
                ) : null}

                {voiceError ? (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {voiceError}
                  </div>
                ) : null}

                {voiceEngine === 'electron-gateway' ? (
                  <p className="text-xs text-slate-500">
                    Electron AI Gateway: 녹음을 Main Process로 전송해 OpenAI로 전사합니다. API 키는 Main
                    Process에만 존재 · 별도 프록시 서버 필요 없음 · npm run dev만 필요 · 오디오는 저장되지 않습니다.
                  </p>
                ) : voiceEngine === 'stt-proxy' ? (
                  <p className="text-xs text-slate-500">
                    Legacy Proxy(선택): 녹음을 sj-ai-proxy로 전송해 전사합니다. API 키는 백엔드에만 있습니다 ·
                    오디오는 저장되지 않습니다.
                  </p>
                ) : !recognitionSupported ? (
                  <p className="text-xs text-slate-500">이 환경에서는 음성 인식을 사용할 수 없습니다.</p>
                ) : null}

                {/* Electron AI Gateway diagnostics — the default desktop path. */}
                {voiceEngine === 'electron-gateway' ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
                        <Cpu className="h-3.5 w-3.5 text-indigo-400" />
                        Electron AI Gateway
                      </div>
                      <button
                        type="button"
                        onClick={refreshGatewayStatus}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
                      >
                        <RefreshCw className="h-3 w-3" />
                        상태 새로고침
                      </button>
                    </div>
                    {gatewayStatus ? (
                      <>
                        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                          <DiagBool label="게이트웨이 사용 가능" value={gatewayStatus.available} />
                          <DiagBool label="OpenAI 활성화" value={gatewayStatus.enabled} />
                          <DiagBool label="API 키 설정" value={gatewayStatus.apiKeyConfigured} />
                          <DiagBool label="준비됨(ready)" value={gatewayStatus.ready} />
                        </div>
                        <div className="mt-1.5 grid grid-cols-1 gap-y-1 text-[11px]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-500">STT 모델</span>
                            <span className="font-mono text-slate-300">{gatewayStatus.sttModel ?? '—'}</span>
                          </div>
                        </div>
                        {!gatewayStatus.available ? (
                          <p className="mt-1.5 text-[11px] text-rose-300">
                            Electron AI Gateway를 사용할 수 없습니다. 데스크톱 앱(npm run dev)에서 실행해 주세요.
                          </p>
                        ) : !gatewayStatus.enabled ? (
                          <p className="mt-1.5 text-[11px] text-amber-300">
                            OPENAI_ENABLED=false 상태입니다. SJ OS 루트 .env 에서 OPENAI_ENABLED=true 로 설정하세요.
                          </p>
                        ) : !gatewayStatus.apiKeyConfigured ? (
                          <p className="mt-1.5 text-[11px] text-amber-300">
                            OpenAI API 키가 설정되지 않았습니다. SJ OS 루트 .env 에만 직접 입력하세요.
                          </p>
                        ) : (
                          <p className="mt-1.5 text-[11px] text-emerald-300">
                            OpenAI 준비됨 — API 키는 Main Process에만 존재 · 별도 프록시 서버 필요 없음 · npm run dev만
                            필요.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="mt-1.5 text-[11px] text-slate-500">게이트웨이 상태 확인 중…</p>
                    )}
                  </div>
                ) : null}

                {/* Legacy proxy diagnostics — optional/advanced deployment path only. */}
                {voiceEngine === 'stt-proxy' ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
                        <Server className="h-3.5 w-3.5 text-sky-400" />
                        Legacy Proxy diagnostics
                      </div>
                      <button
                        type="button"
                        onClick={refreshSttStatus}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
                      >
                        <RefreshCw className="h-3 w-3" />
                        프록시 상태 새로고침
                      </button>
                    </div>
                    {sttStatus ? (
                      <>
                        <div className="mt-1.5 grid grid-cols-1 gap-y-1 text-[11px]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-500">현재 프록시 URL</span>
                            <span className="font-mono text-slate-300">{sttStatus.proxyUrl ?? '—'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-2">
                            <span className="shrink-0 text-slate-500">시도한 URL</span>
                            <span className="text-right font-mono text-[10px] text-slate-400">
                              {sttStatus.triedUrls.length > 0 ? sttStatus.triedUrls.join(', ') : '—'}
                            </span>
                          </div>
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                          <DiagBool label="프록시 연결" value={sttStatus.reachable} />
                          <DiagBool label="OpenAI 활성화" value={sttStatus.enabled} />
                          <DiagBool label="API 키 설정" value={sttStatus.apiKeyConfigured} />
                          <DiagBool label="준비됨(ready)" value={sttStatus.ready} />
                        </div>
                        {sttStatus.lastError ? (
                          <p className="mt-1.5 font-mono text-[10px] text-slate-500">
                            마지막 오류: {sttStatus.lastError}
                          </p>
                        ) : null}
                        {!sttStatus.reachable ? (
                          <p className="mt-1.5 text-[11px] text-rose-300">
                            프록시에 연결할 수 없습니다. sj-ai-proxy 서버가 실행 중인지 확인하세요.
                          </p>
                        ) : !sttStatus.ready ? (
                          <p className="mt-1.5 text-[11px] text-amber-300">
                            프록시는 연결됐지만 OpenAI 설정이 준비되지 않았습니다.
                          </p>
                        ) : (
                          <p className="mt-1.5 text-[11px] text-emerald-300">
                            프록시 준비 완료 — 녹음/전사를 사용할 수 있습니다.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="mt-1.5 text-[11px] text-slate-500">프록시 상태 확인 중…</p>
                    )}
                  </div>
                ) : null}

                {/* Compact voice diagnostics — honest capability + last error report. */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
                      <Activity className="h-3.5 w-3.5 text-sky-400" />
                      Voice diagnostics
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void voice.refreshMicPermission().then(() => setDiagnostics(voice.getDiagnostics()))
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
                    >
                      <RefreshCw className="h-3 w-3" />
                      새로고침
                    </button>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <DiagBool label="SpeechRecognition" value={diagnostics.speechRecognitionSupported} />
                    <DiagBool label="webkitSpeechRecognition" value={diagnostics.webkitSpeechRecognitionSupported} />
                    <DiagBool label="speechSynthesis" value={diagnostics.speechSynthesisSupported} />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">마이크 권한</span>
                      <span className="text-slate-300">
                        {MIC_PERMISSION_LABEL[diagnostics.microphonePermission]}
                      </span>
                    </div>
                    <div className="col-span-2 flex items-center justify-between gap-2">
                      <span className="text-slate-500">음성 엔진</span>
                      <span className={ENGINE_META[diagnostics.engine].classes}>
                        {ENGINE_META[diagnostics.engine].label}
                      </span>
                    </div>
                    <div className="col-span-2 flex items-center justify-between gap-2">
                      <span className="text-slate-500">마지막 오류 코드</span>
                      <span className="font-mono text-slate-300">{diagnostics.lastErrorCode ?? '—'}</span>
                    </div>
                  </div>
                  {diagnostics.lastErrorMessage ? (
                    <p className="mt-1.5 text-[11px] text-slate-400">{diagnostics.lastErrorMessage}</p>
                  ) : null}
                  {diagnostics.recommendedFix ? (
                    <p className="mt-1 text-[11px] text-sky-300">권장 조치: {diagnostics.recommendedFix}</p>
                  ) : null}
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                    Voice safety
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
                    <li>· 눌러서 말하기(push-to-talk) 전용 · 상시 청취 없음 · 웨이크워드 없음</li>
                    <li>· 오디오 파일 저장 없음 (메모리에서만 처리)</li>
                    {voiceEngine === 'electron-gateway' ? (
                      <>
                        <li>· Electron AI Gateway: 녹음을 Main Process로만 전송해 OpenAI로 전사</li>
                        <li>· OpenAI API 키는 Main Process에만 존재 · 렌더러/프리로드에는 없음</li>
                      </>
                    ) : voiceEngine === 'stt-proxy' ? (
                      <>
                        <li>· Legacy Proxy: 녹음을 백엔드 프록시로만 전송해 전사</li>
                        <li>· OpenAI API 키는 백엔드에만 존재 · 프론트엔드에는 없음</li>
                      </>
                    ) : (
                      <>
                        <li>· 로컬 브라우저 음성 인식만 사용 · 외부로 오디오 전송 없음</li>
                        <li>· 외부 AI/API 사용 없음</li>
                      </>
                    )}
                  </ul>
                </div>
              </div>
            </Card>

            <Card title="자비스 응답" icon={<Bot className="h-4 w-4 text-indigo-300" />}>
              <div className="min-h-[110px] whitespace-pre-line rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm leading-7 text-slate-300">
                {state.status === 'thinking' || state.status === 'running' ? (
                  <div className="flex items-center gap-2 text-slate-400">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    {streamedResponse || '분석 중입니다…'}
                  </div>
                ) : (
                  <div>{streamedResponse || state.response}</div>
                )}
              </div>
            </Card>

            {/* Answer / Briefing result */}
            {answer ? (
              <Card title="응답" icon={<Compass className="h-4 w-4 text-sky-300" />}>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5">{answer.commandUnderstood}</span>
                    <span>· 출처</span>
                    <span className="text-slate-300">{answer.sourceWorkspace}</span>
                  </div>
                  {answer.cards.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {answer.cards.map((c) => (
                        <div key={c.label} className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
                          <div className="text-[11px] text-slate-500">{c.label}</div>
                          <div className={['mt-0.5 text-sm font-medium', c.tone ?? 'text-slate-200'].join(' ')}>{c.value}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">
                    <span className="text-slate-500">추천 액션: </span>
                    {answer.recommendedNextAction}
                  </div>
                  {toView(answer.navigationTarget) ? (
                    <button
                      type="button"
                      onClick={() => goToTarget(answer.navigationTarget)}
                      className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                      해당 워크스페이스로 이동
                    </button>
                  ) : null}
                </div>
              </Card>
            ) : null}

            {/* External action result */}
            {external ? (
              <Card title="외부 작업" icon={<ExternalLink className="h-4 w-4 text-sky-300" />}>
                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="명령 이해" value={external.commandUnderstood} />
                    <Field label="대상" value={external.target} />
                    <Field label="동작" value={external.action} />
                    <Field
                      label="상태"
                      value={external.ok ? 'completed' : 'failed'}
                      tone={external.ok ? 'text-emerald-300' : 'text-rose-300'}
                    />
                  </div>
                  {external.ok ? (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                      <CheckCircle2 className="h-4 w-4" />
                      승인된 외부 URL을 시스템 브라우저에서 열었습니다{external.url ? ` · ${external.url}` : ''}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                      <XCircle className="h-4 w-4" />
                      {external.error ?? '외부 링크를 열지 못했습니다.'}
                    </div>
                  )}
                </div>
              </Card>
            ) : null}

            {/* GPT brain result */}
            {gpt ? (
              <Card title="GPT 브레인" icon={<Brain className="h-4 w-4 text-fuchsia-300" />}>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-0.5 text-fuchsia-300">
                      <Cpu className="h-3 w-3" /> {gpt.source}
                    </span>
                    <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5">{gpt.mode}</span>
                    {gpt.model ? <span>· {gpt.model}</span> : null}
                  </div>

                  {gpt.disabled ? (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                      <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        GPT 브레인이 비활성화되어 있습니다. 설정 → “AI · GPT Brain” 안내와
                        docs/OPENAI_PROXY_SETUP.md 를 참고해 프록시를 설정하세요. API 키는 프론트엔드에
                        넣지 마세요.
                      </div>
                    </div>
                  ) : null}

                  {gpt.error ? (
                    <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>{gpt.error}</div>
                    </div>
                  ) : null}

                  {gpt.canRetry && lastCommand ? (
                    <button
                      type="button"
                      onClick={() => askGpt(lastCommand)}
                      className="inline-flex items-center gap-2 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-medium text-fuchsia-300 transition hover:bg-fuchsia-500/20"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      다시 시도
                    </button>
                  ) : null}
                </div>
              </Card>
            ) : null}

            {/* Implementation result */}
            {impl ? (
              <Card title="구현 요청 생성됨" icon={<Hammer className="h-4 w-4 text-amber-300" />}>
                <div className="space-y-3">
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-slate-200">
                    <div className="font-medium text-slate-100">{impl.title}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">요청 ID {impl.requestId}</div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="대상 워크스페이스" value={impl.targetWorkspace} />
                    <Field label="우선순위" value={impl.priority} />
                    <Field label="상태" value={impl.status} />
                    <Field label="위험도" value={impl.riskLevel} tone={RISK_TONE[impl.riskLevel]} />
                    <Field label="승인 필요" value={impl.approvalRequired ? '필요' : '불필요'} tone={impl.approvalRequired ? 'text-amber-300' : 'text-emerald-300'} />
                    <Field label="PM 계획" value={impl.pmPlanId ?? '—'} />
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">
                    <span className="text-slate-500">해석된 목표: </span>{impl.interpretedGoal}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-indigo-300">
                      <GitBranch className="h-3 w-3" /> 경로: {impl.routeTarget}
                    </span>
                    {impl.approvalRequired ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-rose-300">
                        <ShieldAlert className="h-3 w-3" /> 승인 대기
                      </span>
                    ) : null}
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">
                    <span className="text-slate-500">다음 액션: </span>{impl.nextAction}
                  </div>
                  {impl.routingLog.length > 0 ? (
                    <div className="space-y-1">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">라우팅</div>
                      <ul className="space-y-1">
                        {impl.routingLog.map((line) => (
                          <li key={line} className="flex items-start gap-2 text-xs text-slate-400">
                            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                            {line}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {/* Generated developer prompt */}
                  {impl.generatedDeveloperPrompt ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Claude Code 개발자 프롬프트</div>
                        <button
                          type="button"
                          onClick={() =>
                            copyPrompt(impl.generatedDeveloperPrompt, {
                              packetId: impl.promptPacketId,
                              fallbackId: 'jarvis-impl-prompt'
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition hover:bg-amber-500/20"
                        >
                          {promptCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          {promptCopied ? '복사됨' : '프롬프트 복사'}
                        </button>
                      </div>
                      <textarea
                        id="jarvis-impl-prompt"
                        readOnly
                        value={impl.generatedDeveloperPrompt}
                        onFocus={(e) => e.currentTarget.select()}
                        className="h-40 w-full resize-y rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-[11px] leading-5 text-slate-300 outline-none"
                      />
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => goToTarget('pm')}
                      className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                      PM Planner에서 확인
                    </button>
                    <button
                      type="button"
                      onClick={() => goToTarget('devprompt')}
                      className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                      개발 프롬프트 센터에서 관리
                    </button>
                  </div>
                </div>
              </Card>
            ) : null}

            {/* Universal App Builder result */}
            {build ? (
              <Card title="범용 앱 빌더" icon={<Boxes className="h-4 w-4 text-violet-300" />}>
                <div className="space-y-3">
                  <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-sm text-slate-200">
                    <div className="font-medium text-slate-100">{build.projectName}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">프로젝트 ID {build.projectId}</div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="앱 타입" value={build.appType} />
                    <Field label="산업" value={build.industry} />
                    <Field label="대상 사용자" value={build.targetUsers} />
                    <Field label="상태" value={build.status} />
                    <Field label="위험도" value={build.riskLevel} tone={RISK_TONE[build.riskLevel]} />
                    <Field
                      label="승인 필요"
                      value={build.approvalRequired ? '필요' : '불필요'}
                      tone={build.approvalRequired ? 'text-amber-300' : 'text-emerald-300'}
                    />
                  </div>

                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">
                    <span className="text-slate-500">해석된 목표: </span>{build.interpretedGoal}
                  </div>

                  {build.assumptions.length > 0 ? (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                      <div className="mb-1 font-medium">가정 (custom/unknown — 확인 필요)</div>
                      <ul className="space-y-0.5">
                        {build.assumptions.map((a) => (
                          <li key={a}>· {a}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <TagList label="필요 모듈" icon={<Layers className="h-3.5 w-3.5 text-violet-300" />} items={build.requiredModules} />
                    <TagList label="추천 화면" icon={<Compass className="h-3.5 w-3.5 text-sky-300" />} items={build.suggestedScreens} />
                    <TagList label="데이터 모델" icon={<Boxes className="h-3.5 w-3.5 text-emerald-300" />} items={build.suggestedDataModels} />
                    <TagList label="추천 연동" icon={<GitBranch className="h-3.5 w-3.5 text-indigo-300" />} items={build.suggestedIntegrations} />
                  </div>

                  {/* AI tool orchestration plan */}
                  {build.aiToolPlan.length > 0 ? (
                    <div className="space-y-1">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">AI 도구 계획</div>
                      <ul className="space-y-1">
                        {build.aiToolPlan.map((t) => (
                          <li key={t.toolId} className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-1.5 text-xs">
                            <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-medium text-violet-300">
                              {t.toolName}
                            </span>
                            <span className="flex-1 text-slate-400">{t.role}</span>
                            <span className="shrink-0 text-[10px] text-slate-500">{t.officialApiStatus} API · {t.status}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {/* Sprint plan */}
                  {build.sprintPlan.length > 0 ? (
                    <div className="space-y-1">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">스프린트 계획</div>
                      <ul className="space-y-1">
                        {build.sprintPlan.map((s) => (
                          <li key={s.id} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-1.5 text-xs text-slate-300">
                            <span className="font-medium text-slate-200">{s.name}</span>
                            <span className="text-slate-500"> — {s.goal}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {/* Generated developer prompt */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Claude Code 개발자 프롬프트</div>
                      <button
                        type="button"
                        onClick={() =>
                          copyPrompt(build.generatedDeveloperPrompt, {
                            packetId: build.promptPacketId,
                            fallbackId: 'jarvis-build-prompt'
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-300 transition hover:bg-violet-500/20"
                      >
                        {promptCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {promptCopied ? '복사됨' : '프롬프트 복사'}
                      </button>
                    </div>
                    <textarea
                      id="jarvis-build-prompt"
                      readOnly
                      value={build.generatedDeveloperPrompt}
                      onFocus={(e) => e.currentTarget.select()}
                      className="h-40 w-full resize-y rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-[11px] leading-5 text-slate-300 outline-none"
                    />
                  </div>

                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-200">
                    다음 액션: {build.nextAction}
                  </div>

                  {build.routingLog.length > 0 ? (
                    <div className="space-y-1">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">라우팅</div>
                      <ul className="space-y-1">
                        {build.routingLog.map((line) => (
                          <li key={line} className="flex items-start gap-2 text-xs text-slate-400">
                            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                            {line}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => goToTarget('app-builder')}
                      className="inline-flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 transition hover:bg-violet-500/20"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                      App Builder에서 확인
                    </button>
                    <button
                      type="button"
                      onClick={() => goToTarget('pm')}
                      className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                      PM Planner에서 확인
                    </button>
                    <button
                      type="button"
                      onClick={() => goToTarget('devprompt')}
                      className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                      개발 프롬프트 센터에서 관리
                    </button>
                  </div>
                </div>
              </Card>
            ) : null}

            {/* Suggested next commands */}
            {state.suggestedCommands.length > 0 ? (
              <Card title="추천 명령" icon={<Sparkles className="h-4 w-4 text-indigo-300" />}>
                <div className="flex flex-wrap gap-1.5">
                  {state.suggestedCommands.map((cmd) => (
                    <button
                      key={cmd}
                      type="button"
                      onClick={() => runCommand(cmd)}
                      className="rounded-full border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-indigo-500/40 hover:text-indigo-200"
                    >
                      {cmd}
                    </button>
                  ))}
                </div>
              </Card>
            ) : null}
          </div>

          <div className="space-y-4">
            <Card title="실행 상태" icon={<CheckCircle2 className="h-4 w-4 text-indigo-300" />}>
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
                  <div className="font-medium text-slate-200">모드 · 상태</div>
                  <div className="mt-1 text-slate-400">{MODE_META[state.mode].label} · {statusLabel(state.status)}</div>
                </div>
                {state.lastError ? (
                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">
                    <div className="flex items-center gap-2 font-medium">
                      <AlertCircle className="h-4 w-4" />
                      Error
                    </div>
                    <p className="mt-1 text-rose-200">{state.lastError}</p>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-500">도구 호출</div>
                  {state.toolCalls.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-800 p-3 text-sm text-slate-500">
                      아직 도구 호출이 없습니다.
                    </div>
                  ) : (
                    state.toolCalls.map((tool) => (
                      <div key={tool.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
                        <div className="flex items-center gap-2 font-medium text-slate-200">
                          <Wrench className="h-3.5 w-3.5 text-indigo-300" />
                          {tool.name}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{tool.detail}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Card>

            <Card title="최근 명령" icon={<History className="h-4 w-4 text-indigo-300" />}>
              <div className="space-y-2">
                {state.recentCommands.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-800 p-3 text-sm text-slate-500">
                    최근 명령이 없습니다.
                  </div>
                ) : (
                  state.recentCommands.map((command) => (
                    <button
                      key={command}
                      type="button"
                      onClick={() => runCommand(command)}
                      className="block w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-left text-sm text-slate-300 transition hover:border-slate-600"
                    >
                      {command}
                    </button>
                  ))
                )}
              </div>
            </Card>

            <Card title="대화 기록" icon={<History className="h-4 w-4 text-indigo-300" />}>
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {state.history.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-800 p-3 text-sm text-slate-500">
                    대화 내역이 없습니다.
                  </div>
                ) : (
                  state.history.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm">
                      <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                        {entry.role === 'user' ? '사용자' : '자비스'} · {entry.timestamp}
                      </div>
                      <div className="text-slate-300">{entry.content}</div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

/** A compact yes/no capability row for the voice diagnostics panel. */
function DiagBool({ label, value }: { label: string; value: boolean }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-slate-500" title={label}>{label}</span>
      <span className={value ? 'text-emerald-300' : 'text-rose-300'}>{value ? 'yes' : 'no'}</span>
    </div>
  )
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={['mt-0.5 truncate text-sm font-medium', tone ?? 'text-slate-200'].join(' ')} title={value}>{value}</div>
    </div>
  )
}

/** A labelled chip list, used for modules/screens/data models/integrations. */
function TagList({ label, icon, items }: { label: string; icon: JSX.Element; items: string[] }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-slate-500">
        {icon}
        {label}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-slate-600">—</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((item) => (
            <span key={item} className="rounded-full border border-slate-700 bg-slate-800/50 px-2 py-0.5 text-[10px] text-slate-300">
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
