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
  RotateCcw,
  Settings,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
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
import type { AiCoreStatus } from './JarvisAiCore'
import JarvisHoloOrb from './JarvisHoloOrb'
import JarvisCommandTimeline from './JarvisCommandTimeline'
import { useClaudeAutoBuild } from '@renderer/services/claude-auto-build/useClaudeAutoBuild'
import {
  isDevelopmentCommand,
  generateAutoBuildPrompt
} from '@renderer/services/claude-auto-build/promptGenerator'
import { scanAutoBuildPrompt } from '@shared/claudeAutoBuild'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { useAppMode } from '@renderer/navigation/AppModeContext'
import type { View } from '@renderer/navigation/types'

/** Simple, arg-free views a Jarvis navigation target can jump to. */
const NAV_VIEWS = new Set([
  'assistant', 'company', 'dashboard', 'fcos', 'customer', 'sales-activity', 'schedule',
  'performance', 'team-leader', 'consultation', 'insurance-analysis', 'cto', 'qa', 'release',
  'devops', 'autopilot', 'devos', 'pm', 'backlog', 'workers', 'projects', 'approvals',
  'app-builder', 'devprompt', 'activity', 'settings',
  // 직원 업무 화면 + 자비스 브레인 이동 대상
  'staff-home', 'attendance', 'shared-schedule', 'claim-assistant', 'wiki', 'underwriting',
  'pre-underwriting', 'contacts', 'notice', 'staff-overview', 'staff-table', 'registration-admin'
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

/** Minimum recording duration; shorter clips are treated as "too short". */
const MIN_RECORDING_MS = 1000

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

// 다크 홀로 오버레이 전용 — 이 앱의 Tailwind 토큰(slate + 액센트 100~400)은 밝은
// 테마로 리매핑되어 있어, 오버레이 위 색은 전부 명시적 hex/rgba 임의값만 쓴다.
function statusClasses(status: JarvisStatus): string {
  switch (status) {
    case 'thinking':
      return 'border-[#fcd34d]/40 bg-[#fbbf24]/10 text-[#fde68a]'
    case 'running':
      return 'border-[#7dd3fc]/40 bg-[#38bdf8]/10 text-[#a5e3ff]'
    case 'completed':
      return 'border-[#6ee7b7]/40 bg-[#10b981]/10 text-[#6ee7b7]'
    case 'error':
      return 'border-[#fda4af]/40 bg-[#f43f5e]/10 text-[#fda4af]'
    default:
      return 'border-[#67e8f9]/25 bg-[#38bdf8]/5 text-[#9adcff]'
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
  brain: { label: 'AI 대화', classes: 'border-[#67e8f9]/30 bg-[#38bdf8]/10 text-[#9adcff]' },
  unknown: { label: '미확인', classes: 'border-slate-700 bg-slate-800/70 text-slate-300' }
}

/** 위험도 → 값 텍스트 색 (다크 홀로 Field의 tone hex). */
const RISK_TONE: Record<string, string> = {
  low: 'rgba(214,233,255,0.9)',
  medium: '#fde68a',
  high: '#fda4af',
  critical: '#fb7185'
}

/** Korean label + tone for the current voice engine mode. */
const ENGINE_META: Record<VoiceEngineMode, { label: string; classes: string }> = {
  'web-speech': { label: 'Web Speech (로컬 브라우저)', classes: 'text-[#6ee7b7]' },
  'stt-proxy-ready': { label: 'STT 프록시 (준비됨)', classes: 'text-[#6ee7b7]' },
  'stt-proxy-disabled': { label: 'STT 프록시 권장 (비활성화)', classes: 'text-[#fde68a]' },
  unavailable: { label: '사용 불가', classes: 'text-[#fda4af]' }
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
  'Gateway Ready': { label: 'OpenAI 준비됨', classes: 'text-[#6ee7b7]' },
  'Gateway Disabled': { label: 'OPENAI_ENABLED=false', classes: 'text-[#fde68a]' },
  'Key Missing': { label: 'API 키 없음 (루트 .env)', classes: 'text-[#fde68a]' },
  'Gateway Unavailable': { label: '게이트웨이 사용 불가', classes: 'text-[#fda4af]' }
}

/** Segmented-control tab classes for the voice engine selector. */
function engineTabClasses(active: boolean): string {
  return [
    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition',
    active ? 'bg-[#38bdf8]/15 text-[#9adcff]' : 'bg-transparent text-[rgba(150,190,235,0.6)] hover:text-[#cfeaff]'
  ].join(' ')
}

/** Korean label + tone for the backend STT readiness status. */
const STT_STATUS_META: Record<string, { label: string; classes: string }> = {
  'STT Ready': { label: 'STT 프록시 준비됨', classes: 'text-[#6ee7b7]' },
  'STT Disabled': { label: 'STT 프록시 비활성화', classes: 'text-[#fde68a]' },
  'Key Missing': { label: 'API 키 없음 (백엔드)', classes: 'text-[#fde68a]' },
  'Proxy Offline': { label: '프록시 오프라인', classes: 'text-[#fda4af]' }
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
  // 음성 출력 기본 ON — 서비스가 진실의 원천 (미지원 환경은 자동 false).
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(() => voiceService.isVoiceOutputEnabled())
  // TTS로 말하는 중 — 오브 '말하는 중' 연출.
  const [speaking, setSpeaking] = useState(false)
  // 답변을 한 글자씩 흘리는 중 — 오브 맥동(하트비트) 동기화.
  const [typing, setTyping] = useState(false)
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
  const [recorder] = useState(() => new AudioRecorder(10, 12))
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
  // Why the last recording stopped (사용자가 종료 / 최대 시간 도달 / 오류 / 너무 짧음 / 빈 녹음).
  const [stopReason, setStopReason] = useState<string | null>(null)
  // Voice pipeline diagnostics so failures can be reported precisely.
  const [voiceState, setVoiceState] = useState<string>('대기')
  const [audioChunks, setAudioChunks] = useState(0)
  const [audioBytes, setAudioBytes] = useState(0)
  // True when the current recording ended by hitting the max duration.
  const maxReachedRef = useRef(false)
  // Last time the interaction state was reset (for the stability diagnostics).
  const [lastReset, setLastReset] = useState<string>('—')
  const gptConfig = jarvisGptBrainService.getConfig()
  const { navigate } = useNavigation()
  const { mode } = useAppMode()
  const commandChips = mode === 'staff' ? STAFF_COMMAND_CHIPS : CEO_COMMAND_CHIPS

  // 자비스 브레인이 모드별 프롬프트·이동 화이트리스트를 쓰도록 동기화.
  useEffect(() => {
    service.setAppMode(mode)
  }, [service, mode])

  // TTS 말하기 상태 구독 — 오브가 말할 때 골드 파동으로 진동.
  useEffect(() => voice.onSpeakingChange(setSpeaking), [voice])

  // Jarvis → Claude Code Auto Builder. Dev commands create an auto-build job.
  // Auto mode (default OFF) auto-runs a safe job right after creation.
  const autoBuild = useClaudeAutoBuild()
  const [autoRunDev, setAutoRunDev] = useState(false)
  const [lastAutoBuildJobId, setLastAutoBuildJobId] = useState<string | null>(null)
  // Optimistic preview shown the instant a dev command is entered — the card never
  // silently fails to appear even before the async job is created.
  const [devPreview, setDevPreview] = useState<{ command: string; prompt: string } | null>(null)
  const [showDevPrompt, setShowDevPrompt] = useState(false)
  // 홀로 UI: 설정·진단 시트 + 대화 기록 접기.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const lastAutoBuildJob = lastAutoBuildJobId
    ? autoBuild.jobs.find((j) => j.id === lastAutoBuildJobId) ?? null
    : null
  // Renderer-side safety preview (workspace is always the SJ-OS project here).
  const devSafety = devPreview ? scanAutoBuildPrompt(devPreview.prompt, true) : null
  const autoBuildStatusLabel = (status: string): string =>
    ({
      draft: '초안',
      'prompt-generated': '프롬프트 생성',
      'safety-checking': '안전 검사 중',
      blocked: '차단됨',
      ready: '실행 대기',
      queued: '대기 중',
      running: '실행 중',
      verifying: '검증 중',
      succeeded: '완료',
      failed: '실패',
      cancelled: '취소됨',
      'needs-review': '검토 필요',
      skipped: '건너뜀'
    })[status] ?? status

  // Persistent GPT status badge: Ready / Disabled / Proxy Error / Local Only.
  const gptStatus = ((): { label: string; classes: string } => {
    if (!gptConfig.enabled) {
      return { label: 'GPT 비활성화', classes: 'border-[#67e8f9]/20 bg-[#38bdf8]/5 text-[rgba(150,190,235,0.75)]' }
    }
    if (state.gpt?.source === 'backend') {
      return { label: 'API 키 없음', classes: 'border-[#fcd34d]/40 bg-[#fbbf24]/10 text-[#fde68a]' }
    }
    if (state.gpt?.source === 'error') {
      return { label: '프록시 오류', classes: 'border-[#fda4af]/40 bg-[#f43f5e]/10 text-[#fda4af]' }
    }
    if (state.source === 'local') {
      return { label: '로컬 전용', classes: 'border-[#67e8f9]/20 bg-[#38bdf8]/5 text-[rgba(150,190,235,0.75)]' }
    }
    return { label: 'GPT 준비됨', classes: 'border-[#6ee7b7]/40 bg-[#10b981]/10 text-[#6ee7b7]' }
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

  // 응답 타이프라이터 — 최종 답변까지 한 글자씩 흘린다. 길이에 따라 스텝을
  // 조절해 어떤 길이든 대략 1.2~2.4초에 완료(챗봇 톤). typing 상태가 오브 맥동을
  // 구동한다 ("답변 타이핑에 맞춰 오브 맥동").
  useEffect(() => {
    const full = state.response ?? ''
    if (!full || state.status === 'idle') {
      setStreamedResponse(full)
      setTyping(false)
      return undefined
    }
    setStreamedResponse('')
    setTyping(true)
    const step = Math.max(1, Math.ceil(full.length / 140))
    let index = 0
    const timer = window.setInterval(() => {
      index = Math.min(full.length, index + step)
      setStreamedResponse(full.slice(0, index))
      if (index >= full.length) {
        window.clearInterval(timer)
        setTyping(false)
      }
    }, 16)
    return () => {
      window.clearInterval(timer)
      setTyping(false)
    }
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

    // Development commands additionally create a Claude Code auto-build job (the
    // existing router still runs, so navigation/utility commands are unaffected).
    // The preview is set synchronously so the job card appears immediately.
    if (isDevelopmentCommand(trimmed)) {
      setDevPreview({ command: trimmed, prompt: generateAutoBuildPrompt(trimmed) })
      setLastAutoBuildJobId(null)
      if (autoBuild.available) {
        void autoBuild.createFromCommand(trimmed, 'jarvis').then((job) => {
          if (!job) return
          setLastAutoBuildJobId(job.id)
          // Auto Mode: run immediately only when ON and the job passed safety. The
          // main queue still serializes — if another job is active, this waits.
          if (autoRunDev && job.status === 'queued') void autoBuild.runJob(job.id)
        })
      }
    }

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
    setAudioChunks(0)
    setAudioBytes(0)
    setVoiceState('마이크 요청 중')
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
        setVoiceState('녹음 중')
      },
      onMaxReached: () => {
        maxReachedRef.current = true
        setVoiceNotice('최대 녹음 시간 도달, 전사합니다')
      },
      onError: (message) => {
        setRecording(false)
        setVoiceStatus('error')
        setStopReason('오류')
        setVoiceState('오류')
        setVoiceError(message)
      },
      onStop: (result) => {
        setRecording(false)
        setVoiceStatus('idle')
        setAudioChunks(result.chunkCount)
        setAudioBytes(result.blobSize)
        // Too short (accidental double-click) — recording never captured usable audio.
        if (!maxReachedRef.current && result.durationMs < MIN_RECORDING_MS) {
          setStopReason('너무 짧음')
          setVoiceState('너무 짧음')
          setVoiceNotice('녹음 시간이 너무 짧습니다. 다시 시도해주세요.')
          return
        }
        // No/empty audio captured — this is a RECORDING failure (not transcription).
        if (result.chunkCount === 0 || result.blobSize < 1200) {
          setStopReason('빈 녹음')
          setVoiceState('녹음 실패')
          setVoiceError('음성이 제대로 녹음되지 않았습니다. 다시 시도해주세요.')
          return
        }
        setStopReason(maxReachedRef.current ? '최대 시간 도달' : '사용자가 종료')
        void transcribeAndRoute(result.blob, result.durationMs)
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
    setVoiceState('전사 중')
    const transcribeStart = performance.now()
    try {
      const result = usingGateway
        ? await electronAiGateway.transcribeAudio(blob)
        : await sttProxyClient.transcribeAudio(blob)
      const transcriptionMs = performance.now() - transcribeStart
      setVoiceTiming({
        recordingMs: Math.round(recordingMs),
        transcriptionMs: Math.round(transcriptionMs),
        routingMs: 0,
        totalMs: Math.round(recordingMs + transcriptionMs)
      })
      if (!result.success) {
        // The RECORDING succeeded (we had valid audio) — this is a TRANSCRIPTION
        // failure (e.g. missing/disabled OpenAI key, quota). Say so explicitly so
        // it is not mistaken for a broken mic.
        if (usingGateway) void electronAiGateway.forceCheckStatus().then(setGatewayStatus)
        else refreshSttStatus()
        setVoiceState('전사 실패')
        setVoiceError(
          `녹음은 성공했지만 전사(STT)에 실패했습니다: ${result.errorMessage ?? result.errorCode ?? '알 수 없는 오류'}`
        )
        return
      }
      if (!result.transcript) {
        setVoiceState('전사 실패')
        setVoiceError('녹음은 성공했지만 음성에서 명령을 인식하지 못했습니다. 다시 시도해 주세요.')
        return
      }
      // Show the transcript immediately, then route it through the same router.
      setLastTranscript(result.transcript)
      setVoiceState('완료')
      const routeStart = performance.now()
      await handleVoiceTranscript(result.transcript)
      const routingMs = performance.now() - routeStart
      setVoiceTiming({
        recordingMs: Math.round(recordingMs),
        transcriptionMs: Math.round(transcriptionMs),
        routingMs: Math.round(routingMs),
        totalMs: Math.round(recordingMs + transcriptionMs + routingMs)
      })
    } catch {
      setVoiceState('전사 실패')
      setVoiceError('전사 중 오류가 발생했습니다. 다시 시도해 주세요.')
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

  // Click-to-toggle recording: click once to start, click again to stop. This is
  // immune to every pointer subtlety (pointerleave/cancel/capture/drift, permission
  // dialogs) that made press-and-hold cut off early ("금방 꺼짐") on some setups.
  // Recording can ONLY stop on an explicit second click or the safe max duration,
  // so it never turns off unexpectedly. A plain onClick also works with the
  // keyboard (Space/Enter) natively, so no extra key handlers are needed.
  const handleMicClick = (): void => {
    if (!usesRecorder) return
    if (recording) {
      setVoiceState('녹음 정리 중')
      stopVoice()
      return
    }
    if (transcribing) return
    startVoice()
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
    setTyping(false)
    setWakeStatus('standby')
    setStopReason(null)
    setVoiceState('대기')
    setAudioChunks(0)
    setAudioBytes(0)
    setDevPreview(null)
    setShowDevPrompt(false)
    setLastAutoBuildJobId(null)
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
      voice.stopListening()
      voice.stopSpeaking()
      recorder.stop()
      setInterimTranscript('')
      setRecording(false)
      setVoiceStatus('idle')
      // 다음에 열 때 설정 시트가 그대로 떠 있지 않도록 접어둔다.
      setSettingsOpen(false)
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
    // 답변을 소리 내어 읽는 중 — 실행 연출보다 우선해 오브가 '말하는 중'으로 진동.
    if (speaking && state.status !== 'thinking' && state.status !== 'running') return 'speaking'
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
  }, [displayedSession, revealed, state.status, recording, voiceStatus, transcribing, wakeEnabled, speaking])

  if (!state.isOpen) {
    return null
  }

  const answer = state.answer
  const impl = state.implementation
  const build = state.universalBuild
  const external = state.external
  const gpt = state.gpt

  // 실제 대화가 시작됐는지 — 초기 placeholder 응답(streamedResponse)은 제외해야
  // 대기 히어로가 보인다. 명령을 보내면 lastCommand/history가 즉시 채워진다.
  const hasConversation = Boolean(
    lastCommand || displayedSession || answer || impl || build || external || gpt || state.history.length > 0
  )

  // 오브 아래 상태 문구 — 음성 단계가 최우선.
  const orbStatusLine = recording
    ? `녹음 중 ${recordingElapsed.toFixed(1)}초 · 마이크를 다시 누르면 전송`
    : transcribing
      ? '음성을 해석하는 중…'
      : undefined

  // 대기 히어로 문구 (풀스크린 코어 위 중앙) — 코어 자체엔 문구가 없다.
  const heroText =
    orbStatusLine ??
    (coreStatus === 'listening'
      ? '듣고 있습니다…'
      : coreStatus === 'wake'
        ? "호출 대기 중 · '자비스'라고 부르세요"
        : mode === 'staff'
          ? '무엇이든 말씀하세요'
          : '무엇이든 말씀하세요, 대표님')

  // 하단 칩: 최근 명령 2개 + 모드별 추천 명령 (중복 제거).
  const barChips = [...state.recentCommands.slice(0, 2), ...commandChips.filter((c) => !state.recentCommands.slice(0, 2).includes(c))].slice(0, 9)

  return (
    // 풀스크린 자비스 월드 (대표님 승인). 과거 클릭 먹통 사고 방지책 유지:
    // ESC(전역 핸들러) + 상시 노출 닫기 버튼 + 마운트 시 포인터락 해제 + 배경
    // 장식 레이어는 전부 pointer-events-none.
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{ background: 'radial-gradient(1100px 700px at 50% -12%, #0b2144 0%, #060f22 46%, #02060e 100%)' }}
    >
      {/* ── 홀로그램 배경 (장식 전용 — 클릭 통과) ─────────────────── */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {/* 정밀 그리드 */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(103,232,249,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(103,232,249,0.7) 1px, transparent 1px)',
            backgroundSize: '46px 46px',
            WebkitMaskImage: 'radial-gradient(ellipse 75% 65% at 50% 38%, black 18%, transparent 78%)',
            maskImage: 'radial-gradient(ellipse 75% 65% at 50% 38%, black 18%, transparent 78%)'
          }}
        />
        {/* 스타필드 — 미세 입자 */}
        <div
          className="absolute h-px w-px rounded-full"
          style={{
            boxShadow: [
              '12vw 18vh 0 1px rgba(219,231,245,0.4)', '28vw 9vh 0 0 rgba(219,231,245,0.3)', '44vw 6vh 0 1px rgba(230,200,119,0.35)',
              '63vw 12vh 0 0 rgba(219,231,245,0.35)', '81vw 20vh 0 1px rgba(219,231,245,0.3)', '90vw 38vh 0 0 rgba(230,200,119,0.3)',
              '7vw 42vh 0 0 rgba(219,231,245,0.3)', '19vw 60vh 0 1px rgba(219,231,245,0.35)', '35vw 74vh 0 0 rgba(219,231,245,0.25)',
              '52vw 82vh 0 1px rgba(230,200,119,0.3)', '68vw 70vh 0 0 rgba(219,231,245,0.3)', '86vw 62vh 0 1px rgba(219,231,245,0.35)',
              '94vw 84vh 0 0 rgba(219,231,245,0.25)', '4vw 78vh 0 1px rgba(230,200,119,0.25)', '58vw 30vh 0 0 rgba(219,231,245,0.28)',
              '74vw 46vh 0 0 rgba(219,231,245,0.3)', '23vw 33vh 0 0 rgba(219,231,245,0.25)', '39vw 50vh 0 0 rgba(230,200,119,0.22)'
            ].join(', ')
          }}
        />
        {/* 대형 동심원 링 필드 — 오브를 중심으로 겹겹이 */}
        {[
          { s: '34vmin', style: { border: '1px solid rgba(230,200,119,0.14)' } },
          { s: '52vmin', style: { border: '1px dashed rgba(103,232,249,0.12)', animation: 'jarvis-holo-rotate 140s linear infinite' } },
          { s: '72vmin', style: { border: '1px solid rgba(219,231,245,0.08)' } },
          { s: '94vmin', style: { border: '1px dotted rgba(230,200,119,0.12)', animation: 'jarvis-holo-rotate-rev 110s linear infinite' } },
          { s: '120vmin', style: { border: '1px solid rgba(103,232,249,0.06)' } }
        ].map((r) => (
          <div
            key={r.s}
            className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ width: r.s, height: r.s, ...r.style }}
          />
        ))}
        {/* 오로라 스윕 — 골드·아이스 */}
        <div
          className="jarvis-holo-rotate absolute left-1/2 top-[36%] h-[150vmax] w-[150vmax] -translate-x-1/2 -translate-y-1/2"
          style={{
            opacity: 0.14,
            background:
              'conic-gradient(from 0deg, transparent 0deg, rgba(56,189,248,0.32) 40deg, transparent 95deg, rgba(230,200,119,0.3) 185deg, transparent 250deg, rgba(34,211,238,0.26) 320deg, transparent 360deg)'
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-52" style={{ background: 'linear-gradient(to top, rgba(230,200,119,0.06), transparent)' }} />
      </div>

      {/* ── 화면 전체 코어 (살아있는 배경) ─────────────────────────── */}
      <JarvisHoloOrb fullscreen status={coreStatus} pulsing={typing || speaking} />

      {/* 가독성 스크림 — 대화 중엔 중앙을 살짝 어둡게(코어는 가장자리로 은은히). */}
      <div
        className="pointer-events-none absolute inset-0 transition-[background] duration-700"
        style={{
          background: hasConversation
            ? 'radial-gradient(125% 95% at 50% 42%, rgba(2,6,14,0.66) 0%, rgba(2,6,14,0.4) 40%, rgba(2,6,14,0.06) 72%)'
            : 'transparent'
        }}
      />

      {/* ── 헤더 ──────────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'radial-gradient(circle at 32% 28%, #9be8ff, #38bdf8 45%, #0b3f74)', boxShadow: '0 0 18px rgba(56,189,248,0.7)' }}
          >
            <Bot className="h-4 w-4 text-white" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="bg-gradient-to-r from-[#dbe7f5] via-[#f4ecd7] to-[#e6c877] bg-clip-text text-sm font-black tracking-[0.32em] text-transparent">
                SJ JARVIS
              </span>
              <span className="hidden text-[8px] font-bold tracking-[0.3em] sm:inline" style={{ color: 'rgba(230,200,119,0.55)' }}>
                EXECUTIVE AI
              </span>
              <span className="rounded-full border px-2 py-0.5 text-[9px] font-bold" style={{ borderColor: 'rgba(230,200,119,0.45)', color: '#e6c877', background: 'rgba(230,200,119,0.08)' }}>
                {mode === 'staff' ? '직원 모드' : '대표 모드'}
              </span>
            </div>
            <div className="hidden text-[10px] sm:block" style={{ color: 'rgba(150,190,235,0.6)' }}>
              {mode === 'staff' ? 'AI 업무 어시스턴트 · 일정 · 고객 · 실적 · 상담' : 'AI 업무 어시스턴트 · 명령 · 분석 · 실행'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`hidden items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium sm:inline-flex ${statusClasses(state.status)}`}>
            {MODE_META[state.mode].label} · {statusLabel(state.status)}
          </span>
          {voiceOutputEnabled ? (
            <span className="hidden items-center gap-1 rounded-full border px-2 py-1 text-[11px] sm:inline-flex" style={{ borderColor: 'rgba(103,232,249,0.35)', color: '#7dd3fc', background: 'rgba(56,189,248,0.1)' }}>
              <Volume2 className="h-3 w-3" /> 음성
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="자비스 설정 · 진단"
            aria-label="자비스 설정 · 진단"
            className="rounded-xl border p-2 transition hover:brightness-150"
            style={{ borderColor: 'rgba(103,232,249,0.25)', color: '#7dd3fc', background: 'rgba(56,189,248,0.07)' }}
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              service.close()
              setState(service.getState())
            }}
            aria-label="자비스 닫기"
            className="rounded-xl border p-2 transition hover:brightness-150"
            style={{ borderColor: 'rgba(103,232,249,0.25)', color: '#9adcff', background: 'rgba(56,189,248,0.07)' }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ── 메인: 대화 스트림 (코어 위에 떠 있음) ─────────────────── */}
      <main className="relative z-10 flex-1 overflow-y-auto px-4 sm:px-6">
        <div className={`mx-auto flex w-full max-w-3xl flex-col pb-6 ${hasConversation ? '' : 'min-h-full justify-center'}`}>
          {/* 대기 히어로 — 코어 중앙 위에 큰 상태 문구 */}
          {!hasConversation ? (
            <div className="flex flex-col items-center pb-[14vh] text-center">
              <div
                className="font-semibold tracking-[0.14em] transition-colors duration-500"
                style={{ color: '#eaf6ff', fontSize: 'clamp(18px, 3.2vw, 28px)', textShadow: '0 0 28px rgba(56,189,248,0.55)' }}
              >
                {heroText}
              </div>
              <p className="mt-3 text-[13px]" style={{ color: 'rgba(160,200,240,0.7)' }}>
                아래에 입력하거나 마이크를 눌러 말씀하세요.
              </p>
            </div>
          ) : null}

          {/* 음성 라이브 알림 */}
          <div className="flex flex-col items-center gap-1.5">
            {wakeEnabled ? (
              <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px]" style={{ borderColor: 'rgba(103,232,249,0.35)', color: '#a5f3fc', background: 'rgba(34,211,238,0.08)' }}>
                <Radar className="h-3 w-3 animate-pulse" />
                {wakeStatus === 'detected' ? '자비스 호출 감지' : wakeStatus === 'awaiting' ? '명령을 말씀하세요' : "호출 대기 중 · '자비스'라고 불러주세요"}
              </span>
            ) : null}
            {interimTranscript ? (
              <span className="rounded-full border px-3 py-1 text-[12px]" style={{ borderColor: 'rgba(103,232,249,0.3)', color: '#cfeaff', background: 'rgba(56,189,248,0.08)' }}>
                인식 중… {interimTranscript}
              </span>
            ) : null}
            {lastTranscript && !voiceActive && !interimTranscript && !hasConversation ? (
              <span className="rounded-full border px-3 py-1 text-[12px]" style={{ borderColor: 'rgba(103,232,249,0.3)', color: '#cfeaff', background: 'rgba(56,189,248,0.08)' }}>
                인식된 명령: {lastTranscript}
              </span>
            ) : null}
            {voiceNotice ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px]" style={{ borderColor: 'rgba(252,211,77,0.35)', color: '#fde68a', background: 'rgba(251,191,36,0.08)' }}>
                <AlertCircle className="h-3 w-3" /> {voiceNotice}
              </span>
            ) : null}
            {voiceError ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px]" style={{ borderColor: 'rgba(251,113,133,0.4)', color: '#fda4af', background: 'rgba(244,63,94,0.08)' }}>
                <AlertCircle className="h-3 w-3" /> {voiceError}
              </span>
            ) : null}
          </div>

          {/* 대화 기록 (접힘) */}
          {state.history.length > 0 ? (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                className="mx-auto flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] transition hover:brightness-150"
                style={{ borderColor: 'rgba(103,232,249,0.2)', color: 'rgba(150,190,235,0.75)', background: 'rgba(56,189,248,0.05)' }}
              >
                <History className="h-3 w-3" /> 대화 기록 {state.history.length}
                {historyOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {historyOpen ? (
                <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                  {state.history.map((entry) => (
                    <div key={entry.id} className={entry.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                      <div
                        className="max-w-[85%] rounded-2xl border px-3 py-2 text-[12px] leading-5"
                        style={
                          entry.role === 'user'
                            ? { borderColor: 'rgba(230,200,119,0.3)', background: 'rgba(230,200,119,0.08)', color: '#f3e3b5' }
                            : { borderColor: 'rgba(103,232,249,0.2)', background: 'rgba(13,30,58,0.6)', color: 'rgba(214,233,255,0.9)' }
                        }
                      >
                        <div className="mb-0.5 text-[9px] uppercase tracking-[0.2em]" style={{ color: 'rgba(150,190,235,0.55)' }}>
                          {entry.role === 'user' ? '대표님' : '자비스'} · {entry.timestamp}
                        </div>
                        {entry.content}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 현재 명령 (사용자 버블) */}
          {lastCommand ? (
            <div className="mt-3 flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md border px-4 py-2.5 text-sm" style={{ borderColor: 'rgba(230,200,119,0.4)', background: 'linear-gradient(135deg, rgba(230,200,119,0.16), rgba(198,152,47,0.1))', color: '#f6e9c6', boxShadow: '0 0 20px -8px rgba(230,200,119,0.5)' }}>
                {lastCommand}
              </div>
            </div>
          ) : null}

          {/* 자비스 응답 버블 (스트리밍) — 대기 placeholder는 히어로로 대체하므로 제외 */}
          {hasConversation && (streamedResponse || state.response || state.status === 'thinking' || state.status === 'running') ? (
            <div className="mt-3 flex justify-start">
              <div className="flex max-w-[92%] items-start gap-2.5">
                <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: 'radial-gradient(circle at 32% 28%, #9be8ff, #38bdf8 45%, #0b3f74)', boxShadow: '0 0 12px rgba(56,189,248,0.6)' }}>
                  <Bot className="h-3.5 w-3.5 text-white" />
                </span>
                <div className="rounded-2xl rounded-tl-md border px-4 py-3 text-sm leading-7 backdrop-blur-md" style={{ borderColor: 'rgba(103,232,249,0.25)', background: 'linear-gradient(180deg, rgba(13,30,58,0.75), rgba(6,14,30,0.75))', color: 'rgba(224,240,255,0.95)', boxShadow: '0 0 26px -10px rgba(56,189,248,0.5)' }}>
                  {state.status === 'thinking' || state.status === 'running' ? (
                    <span className="flex items-center gap-2" style={{ color: 'rgba(160,205,255,0.85)' }}>
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      <span className="whitespace-pre-line">{streamedResponse || '분석 중입니다…'}</span>
                    </span>
                  ) : (
                    <span className="whitespace-pre-line">{streamedResponse || state.response}</span>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {/* 브레인 실행 액션 — 자비스가 제안한 화면 이동 (골드 버튼) */}
          {state.mode === 'brain' && state.navigationTarget && toView(state.navigationTarget) ? (
            <div className="mt-2 pl-9">
              <button
                type="button"
                onClick={() => goToTarget(state.navigationTarget)}
                className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-bold transition hover:brightness-110"
                style={{ background: 'linear-gradient(135deg, #e6c877, #c6982f)', color: '#0e1e3a', boxShadow: '0 0 18px -4px rgba(230,200,119,0.7)' }}
              >
                <ArrowRight className="h-3.5 w-3.5" /> 화면 열기
              </button>
            </div>
          ) : null}

          {/* 추천 명령 — 응답 바로 아래 글로우 캡슐 */}
          {state.suggestedCommands.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5 pl-9">
              {state.suggestedCommands.map((cmd) => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => runCommand(cmd)}
                  className="rounded-full border px-3 py-1 text-[11px] transition hover:brightness-150"
                  style={{ borderColor: 'rgba(230,200,119,0.35)', color: '#e6c877', background: 'rgba(230,200,119,0.07)' }}
                >
                  <Sparkles className="mr-1 inline h-3 w-3" />
                  {cmd}
                </button>
              ))}
            </div>
          ) : null}

          {/* 실행 오류 */}
          {state.lastError ? (
            <div className="mt-3 flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: 'rgba(251,113,133,0.4)', background: 'rgba(244,63,94,0.08)', color: '#fecdd3' }}>
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {state.lastError}
            </div>
          ) : null}

          {/* 실행 타임라인 + 도구 호출 */}
          {displayedSession ? (
            <HoloCard title="실행 타임라인" icon={<Activity className="h-3.5 w-3.5" />}>
              <JarvisCommandTimeline session={displayedSession} />
              {state.toolCalls.length > 0 ? (
                <div className="mt-3 space-y-1.5 border-t pt-2.5" style={{ borderColor: 'rgba(103,232,249,0.15)' }}>
                  {state.toolCalls.map((tool) => (
                    <div key={tool.id} className="flex items-start gap-2 text-[12px]">
                      <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: '#7dd3fc' }} />
                      <div>
                        <span style={{ color: 'rgba(224,240,255,0.92)' }}>{tool.name}</span>
                        <span style={{ color: 'rgba(150,190,235,0.6)' }}> — {tool.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {displayedSession.promptPacketId ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: 'rgba(110,231,183,0.3)', background: 'rgba(16,185,129,0.07)' }}>
                  <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: '#6ee7b7' }}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    개발 프롬프트 생성 완료
                  </span>
                  <button
                    type="button"
                    onClick={() => goToTarget('devprompt')}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition hover:brightness-150"
                    style={{ borderColor: 'rgba(230,200,119,0.4)', color: '#e6c877', background: 'rgba(230,200,119,0.08)' }}
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
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:brightness-150"
                  style={{ borderColor: 'rgba(251,113,133,0.4)', color: '#fda4af', background: 'rgba(244,63,94,0.08)' }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  다시 시도
                </button>
              ) : null}
            </HoloCard>
          ) : null}

          {/* Claude 자동 개발 — 개발 명령이 감지된 경우에만 등장 */}
          {devPreview ? (
            <HoloCard
              title="Claude 자동 개발"
              icon={<Hammer className="h-3.5 w-3.5" />}
              accent="gold"
              action={
                <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold" style={{ borderColor: 'rgba(230,200,119,0.4)', color: '#e6c877', background: 'rgba(230,200,119,0.08)' }}>
                  {lastAutoBuildJob ? autoBuildStatusLabel(lastAutoBuildJob.status) : autoBuild.available ? '작업 생성 중' : '실행 대기'}
                </span>
              }
            >
              <div className="text-sm font-semibold" style={{ color: '#f6e9c6' }}>
                {lastAutoBuildJob?.status === 'queued'
                  ? `개발 작업 큐에 추가했습니다. 대기 순번 ${lastAutoBuildJob.queueIndex}번`
                  : 'Claude 자동 개발 작업을 생성했습니다.'}
              </div>
              <div className="mt-0.5 truncate text-[11px]" style={{ color: 'rgba(150,190,235,0.65)' }}>
                {lastAutoBuildJob?.title ?? devPreview.command}
              </div>

              <div className="mt-2 rounded-lg border px-2.5 py-1.5 text-[11px]" style={{ borderColor: 'rgba(103,232,249,0.18)', background: 'rgba(6,14,30,0.5)', color: 'rgba(180,215,255,0.8)' }}>
                <span style={{ color: 'rgba(150,190,235,0.55)' }}>명령: </span>
                {devPreview.command}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ borderColor: 'rgba(110,231,183,0.35)', color: '#6ee7b7', background: 'rgba(16,185,129,0.08)' }}>
                  <ShieldCheck className="h-3 w-3" /> 작업 폴더 허용
                </span>
                {devSafety?.promptSafe ? (
                  <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ borderColor: 'rgba(110,231,183,0.35)', color: '#6ee7b7', background: 'rgba(16,185,129,0.08)' }}>
                    <ShieldCheck className="h-3 w-3" />{' '}
                    {devSafety.allowedSafetyMentions.length > 0 ? '금지 명령 안전 규칙 확인됨' : '안전 검사 통과 · 실행 차단 없음'}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ borderColor: 'rgba(251,113,133,0.4)', color: '#fda4af', background: 'rgba(244,63,94,0.08)' }}>
                    <ShieldAlert className="h-3 w-3" /> 위험 명령 실행 지시 감지
                  </span>
                )}
              </div>
              {devSafety && !devSafety.promptSafe && devSafety.blockedReason ? (
                <div className="mt-2 rounded-lg border px-2.5 py-1.5 text-[11px]" style={{ borderColor: 'rgba(251,113,133,0.35)', background: 'rgba(244,63,94,0.08)', color: '#fecdd3' }}>
                  {devSafety.blockedReason}
                </div>
              ) : null}

              <div className="mt-2">
                <button type="button" onClick={() => setShowDevPrompt((s) => !s)} className="text-[11px] font-medium transition hover:brightness-150" style={{ color: '#7dd3fc' }}>
                  {showDevPrompt ? '프롬프트 미리보기 숨기기' : '생성된 Claude Code 프롬프트 미리보기'}
                </button>
                {showDevPrompt ? (
                  <pre className="mt-1 max-h-40 overflow-y-auto rounded-lg border p-2 font-mono text-[10px] leading-5" style={{ borderColor: 'rgba(103,232,249,0.18)', background: 'rgba(3,7,15,0.7)', color: 'rgba(180,215,255,0.75)' }}>
                    {devPreview.prompt}
                  </pre>
                ) : (
                  <p className="mt-1 line-clamp-2 text-[11px]" style={{ color: 'rgba(150,190,235,0.55)' }}>{devPreview.prompt.slice(0, 160)}…</p>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => lastAutoBuildJob && void autoBuild.runJob(lastAutoBuildJob.id)}
                  disabled={
                    !lastAutoBuildJob ||
                    !autoBuild.envReady ||
                    !(
                      lastAutoBuildJob.status === 'ready' ||
                      lastAutoBuildJob.status === 'queued' ||
                      lastAutoBuildJob.status === 'failed' ||
                      lastAutoBuildJob.status === 'needs-review'
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition hover:brightness-150 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ borderColor: 'rgba(110,231,183,0.4)', color: '#6ee7b7', background: 'rgba(16,185,129,0.08)' }}
                >
                  <Hammer className="h-3 w-3" />
                  {lastAutoBuildJob && (lastAutoBuildJob.status === 'failed' || lastAutoBuildJob.status === 'needs-review') ? '다시 시도' : 'Claude Code 실행'}
                </button>
                {lastAutoBuildJob && (lastAutoBuildJob.status === 'running' || lastAutoBuildJob.status === 'verifying') ? (
                  <button
                    type="button"
                    onClick={() => void autoBuild.cancelJob(lastAutoBuildJob.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition hover:brightness-150"
                    style={{ borderColor: 'rgba(251,113,133,0.4)', color: '#fda4af', background: 'rgba(244,63,94,0.08)' }}
                  >
                    <XCircle className="h-3 w-3" />
                    작업 중지
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => navigate({ name: 'devprompt' })}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition hover:brightness-150"
                  style={{ borderColor: 'rgba(103,232,249,0.25)', color: '#9adcff', background: 'rgba(56,189,248,0.06)' }}
                >
                  <History className="h-3 w-3" />
                  로그 보기
                </button>
              </div>

              {!autoBuild.available ? (
                <p className="mt-2 text-[11px]" style={{ color: '#fde68a' }}>실행은 데스크톱 앱(npm run dev)에서만 가능합니다. 프롬프트는 위에서 미리 볼 수 있습니다.</p>
              ) : !autoBuild.envReady ? (
                <p className="mt-2 text-[11px]" style={{ color: '#fde68a' }}>Claude Code 실행 환경을 먼저 확인해주세요. “로그 보기 → Claude Code 실행 환경”에서 점검할 수 있습니다.</p>
              ) : autoBuild.jobs.filter((j) => j.status === 'queued').length >= 2 ? (
                <p className="mt-2 text-[11px]" style={{ color: 'rgba(150,190,235,0.6)' }}>
                  이 작업들은 병렬 후보입니다. 같은 폴더에서 동시에 수정하지 않고, 개발 센터의 “병렬 Claude 개발”에서 별도 worktree로 분리해 실행할 수 있습니다.
                </p>
              ) : null}
            </HoloCard>
          ) : null}

          {/* 응답 데이터 카드 */}
          {answer ? (
            <HoloCard title="브리핑 데이터" icon={<Compass className="h-3.5 w-3.5" />}>
              <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'rgba(150,190,235,0.65)' }}>
                <span className="rounded-full border px-2 py-0.5" style={{ borderColor: 'rgba(103,232,249,0.25)', color: '#9adcff' }}>{answer.commandUnderstood}</span>
                <span>· 출처</span>
                <span style={{ color: 'rgba(214,233,255,0.9)' }}>{answer.sourceWorkspace}</span>
              </div>
              {answer.cards.length > 0 ? (
                <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {answer.cards.map((c) => (
                    <div key={c.label} className="rounded-xl border px-3 py-2" style={{ borderColor: 'rgba(103,232,249,0.18)', background: 'rgba(6,14,30,0.5)' }}>
                      <div className="text-[11px]" style={{ color: 'rgba(150,190,235,0.6)' }}>{c.label}</div>
                      <div className="mt-0.5 text-sm font-semibold" style={{ color: '#eaf6ff' }}>{c.value}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mt-2.5 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'rgba(230,200,119,0.25)', background: 'rgba(230,200,119,0.05)', color: 'rgba(224,240,255,0.9)' }}>
                <span style={{ color: '#e6c877' }}>추천 액션: </span>
                {answer.recommendedNextAction}
              </div>
              {toView(answer.navigationTarget) ? (
                <button
                  type="button"
                  onClick={() => goToTarget(answer.navigationTarget)}
                  className="mt-2.5 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:brightness-150"
                  style={{ borderColor: 'rgba(110,231,183,0.4)', color: '#6ee7b7', background: 'rgba(16,185,129,0.08)' }}
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                  해당 워크스페이스로 이동
                </button>
              ) : null}
            </HoloCard>
          ) : null}

          {/* 외부 작업 결과 */}
          {external ? (
            <HoloCard title="외부 작업" icon={<ExternalLink className="h-3.5 w-3.5" />}>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="명령 이해" value={external.commandUnderstood} />
                <Field label="대상" value={external.target} />
                <Field label="동작" value={external.action} />
                <Field label="상태" value={external.ok ? 'completed' : 'failed'} tone={external.ok ? '#6ee7b7' : '#fda4af'} />
              </div>
              {external.ok ? (
                <div className="mt-2.5 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'rgba(110,231,183,0.3)', background: 'rgba(16,185,129,0.07)', color: '#a7f3d0' }}>
                  <CheckCircle2 className="h-4 w-4" />
                  승인된 외부 URL을 시스템 브라우저에서 열었습니다{external.url ? ` · ${external.url}` : ''}
                </div>
              ) : (
                <div className="mt-2.5 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'rgba(251,113,133,0.35)', background: 'rgba(244,63,94,0.08)', color: '#fecdd3' }}>
                  <XCircle className="h-4 w-4" />
                  {external.error ?? '외부 링크를 열지 못했습니다.'}
                </div>
              )}
            </HoloCard>
          ) : null}

          {/* GPT 브레인 결과 */}
          {gpt ? (
            <HoloCard title="GPT 브레인" icon={<Brain className="h-3.5 w-3.5" />}>
              <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'rgba(150,190,235,0.65)' }}>
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5" style={{ borderColor: 'rgba(103,232,249,0.3)', color: '#9adcff' }}>
                  <Cpu className="h-3 w-3" /> {gpt.source}
                </span>
                <span className="rounded-full border px-2 py-0.5" style={{ borderColor: 'rgba(103,232,249,0.2)' }}>{gpt.mode}</span>
                {gpt.model ? <span>· {gpt.model}</span> : null}
              </div>
              {gpt.disabled ? (
                <div className="mt-2.5 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'rgba(252,211,77,0.3)', background: 'rgba(251,191,36,0.07)', color: '#fde68a' }}>
                  <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>GPT 브레인이 비활성화되어 있습니다. 설정 → “AI · GPT Brain” 안내와 docs/OPENAI_PROXY_SETUP.md 를 참고해 프록시를 설정하세요. API 키는 프론트엔드에 넣지 마세요.</div>
                </div>
              ) : null}
              {gpt.error ? (
                <div className="mt-2.5 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'rgba(251,113,133,0.35)', background: 'rgba(244,63,94,0.08)', color: '#fecdd3' }}>
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>{gpt.error}</div>
                </div>
              ) : null}
              {gpt.canRetry && lastCommand ? (
                <button
                  type="button"
                  onClick={() => askGpt(lastCommand)}
                  className="mt-2.5 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:brightness-150"
                  style={{ borderColor: 'rgba(103,232,249,0.3)', color: '#9adcff', background: 'rgba(56,189,248,0.07)' }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  다시 시도
                </button>
              ) : null}
            </HoloCard>
          ) : null}

          {/* 구현 요청 결과 */}
          {impl ? (
            <HoloCard title="구현 요청 생성됨" icon={<Hammer className="h-3.5 w-3.5" />} accent="gold">
              <div className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'rgba(230,200,119,0.3)', background: 'rgba(230,200,119,0.06)' }}>
                <div className="font-semibold" style={{ color: '#f6e9c6' }}>{impl.title}</div>
                <div className="mt-0.5 text-[11px]" style={{ color: 'rgba(150,190,235,0.6)' }}>요청 ID {impl.requestId}</div>
              </div>
              <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="대상 워크스페이스" value={impl.targetWorkspace} />
                <Field label="우선순위" value={impl.priority} />
                <Field label="상태" value={impl.status} />
                <Field label="위험도" value={impl.riskLevel} tone={RISK_TONE[impl.riskLevel]} />
                <Field label="승인 필요" value={impl.approvalRequired ? '필요' : '불필요'} tone={impl.approvalRequired ? '#fde68a' : '#6ee7b7'} />
                <Field label="PM 계획" value={impl.pmPlanId ?? '—'} />
              </div>
              <div className="mt-2.5 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'rgba(103,232,249,0.18)', background: 'rgba(6,14,30,0.5)', color: 'rgba(214,233,255,0.9)' }}>
                <span style={{ color: 'rgba(150,190,235,0.6)' }}>해석된 목표: </span>
                {impl.interpretedGoal}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5" style={{ borderColor: 'rgba(103,232,249,0.3)', color: '#9adcff' }}>
                  <GitBranch className="h-3 w-3" /> 경로: {impl.routeTarget}
                </span>
                {impl.approvalRequired ? (
                  <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5" style={{ borderColor: 'rgba(251,113,133,0.4)', color: '#fda4af' }}>
                    <ShieldAlert className="h-3 w-3" /> 승인 대기
                  </span>
                ) : null}
              </div>
              <div className="mt-2.5 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'rgba(103,232,249,0.18)', background: 'rgba(6,14,30,0.5)', color: 'rgba(214,233,255,0.9)' }}>
                <span style={{ color: 'rgba(150,190,235,0.6)' }}>다음 액션: </span>
                {impl.nextAction}
              </div>
              {impl.routingLog.length > 0 ? (
                <div className="mt-2.5 space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: 'rgba(150,190,235,0.55)' }}>라우팅</div>
                  <ul className="space-y-1">
                    {impl.routingLog.map((line) => (
                      <li key={line} className="flex items-start gap-2 text-xs" style={{ color: 'rgba(180,215,255,0.75)' }}>
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" style={{ color: '#6ee7b7' }} />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {impl.generatedDeveloperPrompt ? (
                <div className="mt-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: 'rgba(150,190,235,0.55)' }}>Claude Code 개발자 프롬프트</div>
                    <button
                      type="button"
                      onClick={() => copyPrompt(impl.generatedDeveloperPrompt, { packetId: impl.promptPacketId, fallbackId: 'jarvis-impl-prompt' })}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition hover:brightness-150"
                      style={{ borderColor: 'rgba(230,200,119,0.4)', color: '#e6c877', background: 'rgba(230,200,119,0.08)' }}
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
                    className="h-40 w-full resize-y rounded-xl border p-3 font-mono text-[11px] leading-5 outline-none"
                    style={{ borderColor: 'rgba(103,232,249,0.18)', background: 'rgba(3,7,15,0.7)', color: 'rgba(180,215,255,0.8)' }}
                  />
                </div>
              ) : null}
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" onClick={() => goToTarget('pm')} className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:brightness-150" style={{ borderColor: 'rgba(110,231,183,0.4)', color: '#6ee7b7', background: 'rgba(16,185,129,0.08)' }}>
                  <ArrowRight className="h-3.5 w-3.5" />
                  PM Planner에서 확인
                </button>
                <button type="button" onClick={() => goToTarget('devprompt')} className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:brightness-150" style={{ borderColor: 'rgba(230,200,119,0.4)', color: '#e6c877', background: 'rgba(230,200,119,0.08)' }}>
                  <ArrowRight className="h-3.5 w-3.5" />
                  개발 프롬프트 센터에서 관리
                </button>
              </div>
            </HoloCard>
          ) : null}

          {/* 범용 앱 빌더 결과 */}
          {build ? (
            <HoloCard title="범용 앱 빌더" icon={<Boxes className="h-3.5 w-3.5" />}>
              <div className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'rgba(103,232,249,0.25)', background: 'rgba(56,189,248,0.06)' }}>
                <div className="font-semibold" style={{ color: '#eaf6ff' }}>{build.projectName}</div>
                <div className="mt-0.5 text-[11px]" style={{ color: 'rgba(150,190,235,0.6)' }}>프로젝트 ID {build.projectId}</div>
              </div>
              <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="앱 타입" value={build.appType} />
                <Field label="산업" value={build.industry} />
                <Field label="대상 사용자" value={build.targetUsers} />
                <Field label="상태" value={build.status} />
                <Field label="위험도" value={build.riskLevel} tone={RISK_TONE[build.riskLevel]} />
                <Field label="승인 필요" value={build.approvalRequired ? '필요' : '불필요'} tone={build.approvalRequired ? '#fde68a' : '#6ee7b7'} />
              </div>
              <div className="mt-2.5 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'rgba(103,232,249,0.18)', background: 'rgba(6,14,30,0.5)', color: 'rgba(214,233,255,0.9)' }}>
                <span style={{ color: 'rgba(150,190,235,0.6)' }}>해석된 목표: </span>
                {build.interpretedGoal}
              </div>
              {build.assumptions.length > 0 ? (
                <div className="mt-2.5 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: 'rgba(252,211,77,0.3)', background: 'rgba(251,191,36,0.06)', color: '#fde68a' }}>
                  <div className="mb-1 font-medium">가정 (custom/unknown — 확인 필요)</div>
                  <ul className="space-y-0.5">
                    {build.assumptions.map((a) => (
                      <li key={a}>· {a}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
                <TagList label="필요 모듈" icon={<Layers className="h-3.5 w-3.5" style={{ color: '#9adcff' }} />} items={build.requiredModules} />
                <TagList label="추천 화면" icon={<Compass className="h-3.5 w-3.5" style={{ color: '#9adcff' }} />} items={build.suggestedScreens} />
                <TagList label="데이터 모델" icon={<Boxes className="h-3.5 w-3.5" style={{ color: '#6ee7b7' }} />} items={build.suggestedDataModels} />
                <TagList label="추천 연동" icon={<GitBranch className="h-3.5 w-3.5" style={{ color: '#e6c877' }} />} items={build.suggestedIntegrations} />
              </div>
              {build.aiToolPlan.length > 0 ? (
                <div className="mt-2.5 space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: 'rgba(150,190,235,0.55)' }}>AI 도구 계획</div>
                  <ul className="space-y-1">
                    {build.aiToolPlan.map((t) => (
                      <li key={t.toolId} className="flex items-start gap-2 rounded-xl border px-3 py-1.5 text-xs" style={{ borderColor: 'rgba(103,232,249,0.15)', background: 'rgba(6,14,30,0.5)' }}>
                        <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-medium" style={{ borderColor: 'rgba(103,232,249,0.3)', color: '#9adcff' }}>
                          {t.toolName}
                        </span>
                        <span className="flex-1" style={{ color: 'rgba(180,215,255,0.75)' }}>{t.role}</span>
                        <span className="shrink-0 text-[10px]" style={{ color: 'rgba(150,190,235,0.55)' }}>{t.officialApiStatus} API · {t.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {build.sprintPlan.length > 0 ? (
                <div className="mt-2.5 space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: 'rgba(150,190,235,0.55)' }}>스프린트 계획</div>
                  <ul className="space-y-1">
                    {build.sprintPlan.map((s) => (
                      <li key={s.id} className="rounded-xl border px-3 py-1.5 text-xs" style={{ borderColor: 'rgba(103,232,249,0.15)', background: 'rgba(6,14,30,0.5)', color: 'rgba(214,233,255,0.85)' }}>
                        <span className="font-medium" style={{ color: '#eaf6ff' }}>{s.name}</span>
                        <span style={{ color: 'rgba(150,190,235,0.6)' }}> — {s.goal}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: 'rgba(150,190,235,0.55)' }}>Claude Code 개발자 프롬프트</div>
                  <button
                    type="button"
                    onClick={() => copyPrompt(build.generatedDeveloperPrompt, { packetId: build.promptPacketId, fallbackId: 'jarvis-build-prompt' })}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition hover:brightness-150"
                    style={{ borderColor: 'rgba(103,232,249,0.3)', color: '#9adcff', background: 'rgba(56,189,248,0.07)' }}
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
                  className="h-40 w-full resize-y rounded-xl border p-3 font-mono text-[11px] leading-5 outline-none"
                  style={{ borderColor: 'rgba(103,232,249,0.18)', background: 'rgba(3,7,15,0.7)', color: 'rgba(180,215,255,0.8)' }}
                />
              </div>
              <div className="mt-2.5 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'rgba(110,231,183,0.3)', background: 'rgba(16,185,129,0.06)', color: '#a7f3d0' }}>
                다음 액션: {build.nextAction}
              </div>
              {build.routingLog.length > 0 ? (
                <div className="mt-2.5 space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: 'rgba(150,190,235,0.55)' }}>라우팅</div>
                  <ul className="space-y-1">
                    {build.routingLog.map((line) => (
                      <li key={line} className="flex items-start gap-2 text-xs" style={{ color: 'rgba(180,215,255,0.75)' }}>
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" style={{ color: '#6ee7b7' }} />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" onClick={() => goToTarget('app-builder')} className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:brightness-150" style={{ borderColor: 'rgba(103,232,249,0.3)', color: '#9adcff', background: 'rgba(56,189,248,0.07)' }}>
                  <ArrowRight className="h-3.5 w-3.5" />
                  App Builder에서 확인
                </button>
                <button type="button" onClick={() => goToTarget('pm')} className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:brightness-150" style={{ borderColor: 'rgba(110,231,183,0.4)', color: '#6ee7b7', background: 'rgba(16,185,129,0.08)' }}>
                  <ArrowRight className="h-3.5 w-3.5" />
                  PM Planner에서 확인
                </button>
                <button type="button" onClick={() => goToTarget('devprompt')} className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:brightness-150" style={{ borderColor: 'rgba(230,200,119,0.4)', color: '#e6c877', background: 'rgba(230,200,119,0.08)' }}>
                  <ArrowRight className="h-3.5 w-3.5" />
                  개발 프롬프트 센터에서 관리
                </button>
              </div>
            </HoloCard>
          ) : null}
        </div>
      </main>

      {/* ── 하단 글로우 명령바 ─────────────────────────────────────── */}
      <footer className="relative z-10 px-4 pt-1 sm:px-6" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto w-full max-w-3xl">
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {barChips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => runCommand(chip)}
                className="shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[11px] transition hover:brightness-150"
                style={{ borderColor: 'rgba(103,232,249,0.25)', color: 'rgba(180,220,255,0.85)', background: 'rgba(13,30,58,0.55)' }}
              >
                {state.recentCommands.slice(0, 2).includes(chip) ? <History className="mr-1 inline h-3 w-3" style={{ color: '#e6c877' }} /> : null}
                {chip}
              </button>
            ))}
          </div>

          <form
            onSubmit={submitCommand}
            className="flex items-center gap-2 rounded-2xl border p-2 backdrop-blur-xl"
            style={{
              borderColor: voiceActive ? 'rgba(251,113,133,0.5)' : 'rgba(103,232,249,0.3)',
              background: 'rgba(8,18,38,0.85)',
              boxShadow: voiceActive ? '0 0 34px -6px rgba(251,113,133,0.55)' : '0 0 30px -8px rgba(56,189,248,0.5)'
            }}
          >
            {/* 마이크 — 클릭으로 녹음 시작/종료 */}
            <button
              type="button"
              onClick={() => {
                if (usesRecorder) handleMicClick()
                else if (voiceActive) stopVoice()
                else startVoice()
              }}
              disabled={!canStartVoice}
              title={canStartVoice ? (voiceActive ? '클릭하면 녹음 종료 · 전송' : '클릭하여 말하기') : '이 환경에서는 음성을 사용할 수 없습니다'}
              aria-label="음성 명령"
              className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition disabled:cursor-not-allowed disabled:opacity-40"
              style={
                voiceActive
                  ? { background: 'radial-gradient(circle at 32% 28%, #ffd7dd, #fb7185 45%, #7f1d3a)', boxShadow: '0 0 22px rgba(251,113,133,0.8)', color: '#fff' }
                  : transcribing
                    ? { background: 'rgba(34,211,238,0.15)', border: '1px solid rgba(103,232,249,0.4)', color: '#a5f3fc' }
                    : { background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(103,232,249,0.35)', color: '#7dd3fc' }
              }
            >
              {voiceActive ? (
                <>
                  <span className="absolute inset-0 animate-ping rounded-xl" style={{ background: 'rgba(251,113,133,0.35)' }} />
                  <MicOff className="relative h-5 w-5" />
                </>
              ) : transcribing ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <AudioLines className="h-5 w-5" />
              )}
            </button>

            <input
              id="jarvis-command-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={mode === 'staff' ? '자비스에게 말하듯 입력하세요 — 예: 오늘 일정' : '자비스에게 말하듯 입력하세요 — 예: 오늘 조직 브리핑'}
              className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none"
              style={{ color: '#eaf6ff', caretColor: '#e6c877' }}
            />

            <button
              type="button"
              onClick={() => askGpt(draft)}
              title={gptConfig.enabled ? 'GPT 브레인에 질의' : 'GPT 브레인이 비활성화됨 (설정 안내 표시)'}
              className="hidden shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition hover:brightness-150 sm:inline-flex"
              style={{ borderColor: 'rgba(103,232,249,0.25)', color: '#9adcff', background: 'rgba(56,189,248,0.07)' }}
            >
              <Brain className="h-3.5 w-3.5" />
              GPT
            </button>

            <button
              type="submit"
              aria-label="명령 실행"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-bold transition hover:brightness-110"
              style={{ background: 'linear-gradient(135deg, #e6c877, #c6982f)', color: '#0e1e3a', boxShadow: '0 0 22px -4px rgba(230,200,119,0.8)' }}
            >
              <SendHorizontal className="h-5 w-5" />
            </button>
          </form>

          <p className="mt-1.5 text-center text-[10px]" style={{ color: 'rgba(150,190,235,0.45)' }}>
            Ctrl + Space 열기/닫기 · ESC 닫기 · 음성은 마이크 버튼 (누르고 말하기)
          </p>
        </div>
      </footer>

      {/* ── 설정 · 진단 시트 (기어) ────────────────────────────────── */}
      {settingsOpen ? (
        <div className="absolute inset-0 z-30 flex justify-end" style={{ background: 'rgba(2,6,14,0.55)' }} onClick={() => setSettingsOpen(false)}>
          <div
            className="h-full w-[min(94vw,440px)] overflow-y-auto border-l p-4"
            style={{ background: 'rgba(6,14,30,0.97)', borderColor: 'rgba(103,232,249,0.22)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold" style={{ color: '#eaf6ff' }}>
                <Settings className="h-4 w-4" style={{ color: '#7dd3fc' }} />
                자비스 설정 · 진단
              </div>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="설정 닫기" className="rounded-lg border p-1.5 transition hover:brightness-150" style={{ borderColor: 'rgba(103,232,249,0.25)', color: '#9adcff' }}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 빠른 제어 */}
            <SheetSection title="빠른 제어">
              <div className="flex flex-wrap gap-1.5">
                <SheetToggle onClick={toggleVoiceOutput} active={voiceOutputEnabled} disabled={!synthesisSupported} icon={voiceOutputEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}>
                  음성 출력 {voiceOutputEnabled ? 'ON' : 'OFF'}
                </SheetToggle>
                <SheetToggle onClick={toggleWake} active={wakeEnabled} icon={<Radar className="h-3.5 w-3.5" />}>
                  호출 대기 {wakeEnabled ? 'ON' : 'OFF'}
                </SheetToggle>
                <SheetToggle onClick={() => setAutoRunDev((v) => !v)} active={autoRunDev} icon={<Hammer className="h-3.5 w-3.5" />}>
                  개발 명령 자동 실행 {autoRunDev ? 'ON' : 'OFF'}
                </SheetToggle>
                <SheetToggle onClick={resetJarvis} icon={<RotateCcw className="h-3.5 w-3.5" />}>상태 초기화</SheetToggle>
                <SheetToggle onClick={refreshApp} icon={<RefreshCw className="h-3.5 w-3.5" />}>앱 새로고침</SheetToggle>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${gptStatus.classes}`}>
                  <Brain className="h-3 w-3" />
                  {gptStatus.label}
                </span>
                {state.source ? (
                  <span className="rounded-full border px-2.5 py-1 text-[11px]" style={{ borderColor: 'rgba(103,232,249,0.25)', color: '#9adcff' }}>
                    응답 출처: {state.source === 'brain' ? '자비스 AI (Claude)' : state.source === 'gpt' ? 'GPT' : state.source === 'fallback' ? '폴백' : '로컬'}
                  </span>
                ) : null}
              </div>
            </SheetSection>

            {/* 음성 엔진 */}
            <SheetSection title="음성 엔진">
              <div className="inline-flex overflow-hidden rounded-xl border" style={{ borderColor: 'rgba(103,232,249,0.25)' }}>
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
                  AI Gateway
                </button>
                <button type="button" onClick={() => { if (!voiceActive) setVoiceEngine('web-speech') }} className={engineTabClasses(voiceEngine === 'web-speech')}>
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
                  Legacy
                </button>
              </div>
              <div className="mt-1.5 text-[11px]">
                {voiceEngine === 'electron-gateway' ? (
                  gatewayStatus ? (
                    <span className={GATEWAY_STATUS_META[gatewayStatus.label]?.classes ?? ''} style={{ color: undefined }}>
                      {GATEWAY_STATUS_META[gatewayStatus.label]?.label ?? gatewayStatus.label}
                    </span>
                  ) : (
                    <span style={{ color: 'rgba(150,190,235,0.6)' }}>상태 확인 중…</span>
                  )
                ) : voiceEngine === 'web-speech' ? (
                  <span style={{ color: recognitionSupported ? '#6ee7b7' : '#fda4af' }}>{recognitionSupported ? 'Web Speech 사용 가능' : 'Web Speech 미지원'}</span>
                ) : sttStatus ? (
                  <span className={STT_STATUS_META[sttStatus.label]?.classes ?? ''}>{STT_STATUS_META[sttStatus.label]?.label ?? sttStatus.label}</span>
                ) : (
                  <span style={{ color: 'rgba(150,190,235,0.6)' }}>상태 확인 중…</span>
                )}
              </div>
              <p className="mt-1.5 text-[11px]" style={{ color: 'rgba(150,190,235,0.55)' }}>
                {voiceEngine === 'electron-gateway'
                  ? 'Electron AI Gateway: 녹음을 Main Process로 전송해 OpenAI로 전사합니다. API 키는 Main Process에만 존재 · 오디오는 저장되지 않습니다.'
                  : voiceEngine === 'stt-proxy'
                    ? 'Legacy Proxy(선택): 녹음을 sj-ai-proxy로 전송해 전사합니다. API 키는 백엔드에만 있습니다 · 오디오는 저장되지 않습니다.'
                    : '로컬 브라우저 음성 인식만 사용 · 외부로 오디오 전송 없음.'}
              </p>
            </SheetSection>

            {/* Electron AI Gateway 진단 */}
            {voiceEngine === 'electron-gateway' ? (
              <SheetSection
                title="Electron AI Gateway"
                action={
                  <button type="button" onClick={refreshGatewayStatus} className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition hover:brightness-150" style={{ borderColor: 'rgba(103,232,249,0.25)', color: '#9adcff' }}>
                    <RefreshCw className="h-3 w-3" />
                    새로고침
                  </button>
                }
              >
                {gatewayStatus ? (
                  <>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      <DiagBool label="게이트웨이 사용 가능" value={gatewayStatus.available} />
                      <DiagBool label="OpenAI 활성화" value={gatewayStatus.enabled} />
                      <DiagBool label="API 키 설정" value={gatewayStatus.apiKeyConfigured} />
                      <DiagBool label="준비됨(ready)" value={gatewayStatus.ready} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                      <span style={{ color: 'rgba(150,190,235,0.6)' }}>STT 모델</span>
                      <span className="font-mono" style={{ color: 'rgba(214,233,255,0.85)' }}>{gatewayStatus.sttModel ?? '—'}</span>
                    </div>
                    {!gatewayStatus.available ? (
                      <p className="mt-1.5 text-[11px]" style={{ color: '#fda4af' }}>Electron AI Gateway를 사용할 수 없습니다. 데스크톱 앱(npm run dev)에서 실행해 주세요.</p>
                    ) : !gatewayStatus.enabled ? (
                      <p className="mt-1.5 text-[11px]" style={{ color: '#fde68a' }}>OPENAI_ENABLED=false 상태입니다. SJ OS 루트 .env 에서 OPENAI_ENABLED=true 로 설정하세요.</p>
                    ) : !gatewayStatus.apiKeyConfigured ? (
                      <p className="mt-1.5 text-[11px]" style={{ color: '#fde68a' }}>OpenAI API 키가 설정되지 않았습니다. SJ OS 루트 .env 에만 직접 입력하세요.</p>
                    ) : (
                      <p className="mt-1.5 text-[11px]" style={{ color: '#6ee7b7' }}>OpenAI 준비됨 — API 키는 Main Process에만 존재 · 별도 프록시 서버 필요 없음.</p>
                    )}
                  </>
                ) : (
                  <p className="text-[11px]" style={{ color: 'rgba(150,190,235,0.6)' }}>게이트웨이 상태 확인 중…</p>
                )}
              </SheetSection>
            ) : null}

            {/* Legacy Proxy 진단 */}
            {voiceEngine === 'stt-proxy' ? (
              <SheetSection
                title="Legacy Proxy 진단"
                action={
                  <button type="button" onClick={refreshSttStatus} className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition hover:brightness-150" style={{ borderColor: 'rgba(103,232,249,0.25)', color: '#9adcff' }}>
                    <RefreshCw className="h-3 w-3" />
                    새로고침
                  </button>
                }
              >
                {sttStatus ? (
                  <>
                    <div className="grid grid-cols-1 gap-y-1 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span style={{ color: 'rgba(150,190,235,0.6)' }}>현재 프록시 URL</span>
                        <span className="font-mono" style={{ color: 'rgba(214,233,255,0.85)' }}>{sttStatus.proxyUrl ?? '—'}</span>
                      </div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="shrink-0" style={{ color: 'rgba(150,190,235,0.6)' }}>시도한 URL</span>
                        <span className="text-right font-mono text-[10px]" style={{ color: 'rgba(180,215,255,0.7)' }}>
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
                      <p className="mt-1.5 font-mono text-[10px]" style={{ color: 'rgba(150,190,235,0.6)' }}>마지막 오류: {sttStatus.lastError}</p>
                    ) : null}
                    {!sttStatus.reachable ? (
                      <p className="mt-1.5 text-[11px]" style={{ color: '#fda4af' }}>프록시에 연결할 수 없습니다. sj-ai-proxy 서버가 실행 중인지 확인하세요.</p>
                    ) : !sttStatus.ready ? (
                      <p className="mt-1.5 text-[11px]" style={{ color: '#fde68a' }}>프록시는 연결됐지만 OpenAI 설정이 준비되지 않았습니다.</p>
                    ) : (
                      <p className="mt-1.5 text-[11px]" style={{ color: '#6ee7b7' }}>프록시 준비 완료 — 녹음/전사를 사용할 수 있습니다.</p>
                    )}
                  </>
                ) : (
                  <p className="text-[11px]" style={{ color: 'rgba(150,190,235,0.6)' }}>프록시 상태 확인 중…</p>
                )}
              </SheetSection>
            ) : null}

            {/* Voice 진단 */}
            <SheetSection
              title="Voice 진단"
              action={
                <button
                  type="button"
                  onClick={() => void voice.refreshMicPermission().then(() => setDiagnostics(voice.getDiagnostics()))}
                  className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition hover:brightness-150"
                  style={{ borderColor: 'rgba(103,232,249,0.25)', color: '#9adcff' }}
                >
                  <RefreshCw className="h-3 w-3" />
                  새로고침
                </button>
              }
            >
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <DiagBool label="SpeechRecognition" value={diagnostics.speechRecognitionSupported} />
                <DiagBool label="webkitSpeechRecognition" value={diagnostics.webkitSpeechRecognitionSupported} />
                <DiagBool label="speechSynthesis" value={diagnostics.speechSynthesisSupported} />
                <div className="flex items-center justify-between gap-2">
                  <span style={{ color: 'rgba(150,190,235,0.6)' }}>마이크 권한</span>
                  <span style={{ color: 'rgba(214,233,255,0.85)' }}>{MIC_PERMISSION_LABEL[diagnostics.microphonePermission]}</span>
                </div>
                <div className="col-span-2 flex items-center justify-between gap-2">
                  <span style={{ color: 'rgba(150,190,235,0.6)' }}>음성 엔진</span>
                  <span className={ENGINE_META[diagnostics.engine].classes}>{ENGINE_META[diagnostics.engine].label}</span>
                </div>
                <div className="col-span-2 flex items-center justify-between gap-2">
                  <span style={{ color: 'rgba(150,190,235,0.6)' }}>마지막 오류 코드</span>
                  <span className="font-mono" style={{ color: 'rgba(214,233,255,0.85)' }}>{diagnostics.lastErrorCode ?? '—'}</span>
                </div>
              </div>
              {diagnostics.lastErrorMessage ? <p className="mt-1.5 text-[11px]" style={{ color: 'rgba(180,215,255,0.75)' }}>{diagnostics.lastErrorMessage}</p> : null}
              {diagnostics.recommendedFix ? <p className="mt-1 text-[11px]" style={{ color: '#7dd3fc' }}>권장 조치: {diagnostics.recommendedFix}</p> : null}
            </SheetSection>

            {/* 음성 파이프라인 진단 */}
            <SheetSection title="음성 파이프라인 진단">
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] leading-5" style={{ color: 'rgba(150,190,235,0.7)' }}>
                <span>상태: {voiceState}</span>
                <span>정지 사유: {stopReason ?? '—'}</span>
                <span>녹음 시간: {recordingElapsed.toFixed(1)}초</span>
                <span>전사 시간: {voiceTiming ? (voiceTiming.transcriptionMs / 1000).toFixed(1) + '초' : '—'}</span>
                <span>오디오 청크: {audioChunks}개</span>
                <span>오디오 크기: {(audioBytes / 1024).toFixed(1)}KB</span>
              </div>
              {voiceTiming ? (
                <p className="mt-1 font-mono text-[10px]" style={{ color: 'rgba(150,190,235,0.6)' }}>
                  음성 처리 {(voiceTiming.totalMs / 1000).toFixed(1)}초 · 녹음 {(voiceTiming.recordingMs / 1000).toFixed(1)}초 · 전사{' '}
                  {(voiceTiming.transcriptionMs / 1000).toFixed(1)}초 · 실행 {(voiceTiming.routingMs / 1000).toFixed(1)}초
                </p>
              ) : null}
              <div className="mt-1 truncate font-mono text-[10px]" style={{ color: 'rgba(150,190,235,0.55)' }}>마지막 오류: {voiceError ?? '—'}</div>
              {lastTranscript ? (
                <div className="mt-1 font-mono text-[10px]" style={{ color: 'rgba(150,190,235,0.55)' }}>인식된 명령: {lastTranscript}</div>
              ) : null}
              <div className="mt-1 font-mono text-[10px]" style={{ color: 'rgba(150,190,235,0.5)' }}>
                최대 녹음 {recorder.getMaxSeconds()}초 · UI 안정: 실행 {state.status === 'thinking' || state.status === 'running' ? 'true' : 'false'} · 녹음{' '}
                {recording ? 'true' : 'false'} · 전사 {transcribing ? 'true' : 'false'} · 마지막 초기화 {lastReset}
              </div>
            </SheetSection>

            {/* Voice 안전 */}
            <SheetSection title="Voice 안전">
              <ul className="space-y-0.5 text-[11px]" style={{ color: 'rgba(150,190,235,0.65)' }}>
                <li>· 눌러서 말하기(push-to-talk) 전용 · 상시 청취 없음</li>
                <li>· 오디오 파일 저장 없음 (메모리에서만 처리)</li>
                <li>· API 키는 백엔드/Main Process에만 존재 · 프론트엔드에는 없음</li>
                <li>· 로컬 데이터 전용 명령은 외부 AI/API 없이 처리</li>
              </ul>
            </SheetSection>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** 홀로그램 글래스 카드 — 스트림 안의 결과 컨테이너. */
function HoloCard({
  title,
  icon,
  action,
  accent = 'cyan',
  children
}: {
  title: string
  icon: JSX.Element
  action?: JSX.Element
  accent?: 'cyan' | 'gold'
  children: React.ReactNode
}): JSX.Element {
  const glow = accent === 'gold' ? 'rgba(230,200,119,' : 'rgba(56,189,248,'
  return (
    <section
      className="mt-3 rounded-2xl border p-4 backdrop-blur-md"
      style={{
        borderColor: `${glow}0.28)`,
        background: 'linear-gradient(180deg, rgba(13,30,58,0.72), rgba(6,14,30,0.72))',
        boxShadow: `0 0 26px -10px ${glow}0.5), inset 0 1px 0 rgba(255,255,255,0.05)`
      }}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: accent === 'gold' ? '#e6c877' : '#7dd3fc' }}>
          {icon}
          {title}
        </div>
        {action ?? null}
      </div>
      {children}
    </section>
  )
}

/** 설정 시트 섹션. */
function SheetSection({ title, action, children }: { title: string; action?: JSX.Element; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-3 rounded-2xl border p-3" style={{ borderColor: 'rgba(103,232,249,0.16)', background: 'rgba(13,30,58,0.5)' }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: 'rgba(150,190,235,0.7)' }}>{title}</div>
        {action ?? null}
      </div>
      {children}
    </div>
  )
}

/** 설정 시트 토글/액션 버튼. */
function SheetToggle({
  onClick,
  active = false,
  disabled = false,
  icon,
  children
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  icon: JSX.Element
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition hover:brightness-150 disabled:cursor-not-allowed disabled:opacity-40"
      style={
        active
          ? { borderColor: 'rgba(230,200,119,0.5)', color: '#e6c877', background: 'rgba(230,200,119,0.1)' }
          : { borderColor: 'rgba(103,232,249,0.25)', color: 'rgba(180,220,255,0.85)', background: 'rgba(56,189,248,0.05)' }
      }
    >
      {icon}
      {children}
    </button>
  )
}

/** 진단용 yes/no 행 (다크 홀로 테마). */
function DiagBool({ label, value }: { label: string; value: boolean }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate" title={label} style={{ color: 'rgba(150,190,235,0.6)' }}>
        {label}
      </span>
      <span style={{ color: value ? '#6ee7b7' : '#fda4af' }}>{value ? 'yes' : 'no'}</span>
    </div>
  )
}

/** 라벨+값 필드 (다크 홀로 테마). tone은 값 텍스트 색 (hex). */
function Field({ label, value, tone }: { label: string; value: string; tone?: string }): JSX.Element {
  return (
    <div className="rounded-xl border px-3 py-2" style={{ borderColor: 'rgba(103,232,249,0.18)', background: 'rgba(6,14,30,0.5)' }}>
      <div className="text-[11px]" style={{ color: 'rgba(150,190,235,0.6)' }}>{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium" title={value} style={{ color: tone ?? '#eaf6ff' }}>
        {value}
      </div>
    </div>
  )
}

/** 라벨 칩 리스트 — 모듈/화면/데이터모델/연동 (다크 홀로 테마). */
function TagList({ label, icon, items }: { label: string; icon: JSX.Element; items: string[] }): JSX.Element {
  return (
    <div className="rounded-xl border px-3 py-2" style={{ borderColor: 'rgba(103,232,249,0.18)', background: 'rgba(6,14,30,0.5)' }}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em]" style={{ color: 'rgba(150,190,235,0.6)' }}>
        {icon}
        {label}
      </div>
      {items.length === 0 ? (
        <div className="text-xs" style={{ color: 'rgba(150,190,235,0.4)' }}>—</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((item) => (
            <span key={item} className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: 'rgba(103,232,249,0.25)', color: 'rgba(200,230,255,0.85)' }}>
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
