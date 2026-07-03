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
  Layers
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
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
import type { JarvisMode, JarvisState, JarvisStatus } from '@renderer/services/jarvis/types'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { View } from '@renderer/navigation/types'

/** Simple, arg-free views a Jarvis navigation target can jump to. */
const NAV_VIEWS = new Set([
  'assistant', 'company', 'dashboard', 'fcos', 'customer', 'sales-activity', 'schedule',
  'performance', 'team-leader', 'consultation', 'insurance-analysis', 'cto', 'qa', 'release',
  'devops', 'autopilot', 'devos', 'pm', 'backlog', 'workers', 'projects', 'approvals',
  'app-builder', 'activity', 'settings'
])

function toView(target: string | null | undefined): View | null {
  if (!target || !NAV_VIEWS.has(target)) return null
  return { name: target } as View
}

const COMMAND_CHIPS = [
  '오늘 브리핑',
  '오늘 FC 출근 현황',
  '오늘 일정',
  '이번 달 실적',
  '미완료 활동',
  '클로징 예정 고객',
  '유튜브 켜줘',
  '오토파일럿 열어줘',
  'FC OS에 팀별 필터 추가해',
  '쇼핑몰 시스템 만들어',
  '학원 관리 프로그램 만들어',
  '병원 예약 시스템 만들어',
  'AI 영상 광고 제작 시스템 만들어',
  '오늘 조직 상황 브리핑 해줘',
  '우리 회사 앱 다음 기능 추천해줘'
]

function statusLabel(status: JarvisStatus): string {
  switch (status) {
    case 'thinking':
      return 'Thinking'
    case 'running':
      return 'Running'
    case 'completed':
      return 'Completed'
    case 'error':
      return 'Error'
    default:
      return 'Idle'
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
  answer: { label: 'Answer', classes: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  briefing: { label: 'Briefing', classes: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' },
  'implementation-request': { label: 'Implementation', classes: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  'universal-build': { label: 'App Builder', classes: 'border-violet-500/30 bg-violet-500/10 text-violet-300' },
  navigation: { label: 'Navigation', classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  'external-action': { label: 'External', classes: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  gpt: { label: 'GPT Brain', classes: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300' },
  unknown: { label: 'Unknown', classes: 'border-slate-700 bg-slate-800/70 text-slate-300' }
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
  const recognitionSupported = voice.isRecognitionSupported()
  const synthesisSupported = voice.isSynthesisSupported()

  // Voice engines: recorder (gateway + proxy) + per-engine status + record state.
  const [recorder] = useState(() => new AudioRecorder(10))
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
  const gptConfig = jarvisGptBrainService.getConfig()
  const { navigate } = useNavigation()

  // Persistent GPT status badge: Ready / Disabled / Proxy Error / Local Only.
  const gptStatus = ((): { label: string; classes: string } => {
    if (!gptConfig.enabled) {
      return { label: 'GPT Disabled', classes: 'border-slate-700 bg-slate-800/70 text-slate-300' }
    }
    if (state.gpt?.source === 'backend') {
      return { label: 'Key Missing', classes: 'border-amber-500/30 bg-amber-500/10 text-amber-300' }
    }
    if (state.gpt?.source === 'error') {
      return { label: 'Proxy Error', classes: 'border-rose-500/30 bg-rose-500/10 text-rose-300' }
    }
    if (state.source === 'local') {
      return { label: 'Local Only', classes: 'border-slate-700 bg-slate-800/70 text-slate-300' }
    }
    return { label: 'GPT Ready', classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' }
  })()

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
    // Read the Jarvis answer aloud when voice output is on.
    if (voiceOutputEnabled) {
      voice.speak(result.response)
    }
  }

  const runCommand = async (command: string): Promise<void> => {
    const trimmed = command.trim()
    if (!trimmed) return
    setDraft('')
    setLastCommand(trimmed)
    const result = await service.executeCommand(trimmed)
    applyResult(result)
  }

  // Explicitly route a command to the GPT brain (bypasses the local router).
  const askGpt = async (command: string): Promise<void> => {
    const trimmed = command.trim()
    if (!trimmed) return
    setLastCommand(trimmed)
    setState({ ...service.getState(), status: 'running', mode: 'gpt', response: 'GPT 브레인에 질의하는 중입니다…' })
    const result = await service.askGpt(trimmed)
    applyResult(result)
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

  // Refresh the Electron Main AI Gateway status (main-process readiness).
  const refreshGatewayStatus = (): void => {
    void electronAiGateway.checkStatus().then(setGatewayStatus)
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
    setInterimTranscript('')
    voice.stopSpeaking()
    void recorder.start({
      onStart: () => {
        setRecording(true)
        setVoiceStatus('listening')
      },
      onError: (message) => {
        setRecording(false)
        setVoiceStatus('error')
        setVoiceError(message)
      },
      onStop: (blob) => {
        setRecording(false)
        setVoiceStatus('idle')
        void transcribeAndRoute(blob)
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
  const transcribeAndRoute = async (blob: Blob): Promise<void> => {
    setTranscribing(true)
    const usingGateway = voiceEngine === 'electron-gateway'
    const result = usingGateway
      ? await electronAiGateway.transcribeAudio(blob)
      : await sttProxyClient.transcribeAudio(blob)
    setTranscribing(false)
    if (usingGateway) refreshGatewayStatus()
    else refreshSttStatus()
    if (!result.success) {
      setVoiceError(result.errorMessage ?? 'STT 전사에 실패했습니다. 텍스트 입력을 사용해 주세요.')
      return
    }
    if (!result.transcript) {
      setVoiceError('음성에서 명령을 인식하지 못했습니다. 다시 시도해 주세요.')
      return
    }
    await handleVoiceTranscript(result.transcript)
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

  const toggleVoiceOutput = (): void => {
    const next = voice.setVoiceOutput(!voiceOutputEnabled)
    setVoiceOutputEnabled(next)
    if (!next) voice.stopSpeaking()
  }

  // Stop mic + speech + recording when the panel closes so nothing keeps running.
  const isOpen = state.isOpen
  useEffect(() => {
    if (!isOpen) {
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
  // to selecting the textarea when the Clipboard API is unavailable.
  const copyPrompt = (prompt: string): void => {
    const done = (): void => {
      setPromptCopied(true)
      window.setTimeout(() => setPromptCopied(false), 2000)
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(prompt).then(done).catch(() => {
        const field = document.getElementById('jarvis-build-prompt') as HTMLTextAreaElement | null
        field?.select()
      })
      return
    }
    const field = document.getElementById('jarvis-build-prompt') as HTMLTextAreaElement | null
    field?.select()
  }

  if (!state.isOpen) {
    return null
  }

  const answer = state.answer
  const impl = state.implementation
  const build = state.universalBuild
  const external = state.external
  const gpt = state.gpt

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/95 shadow-2xl shadow-black/50">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-2 text-indigo-300">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-100">SJ Jarvis Core</p>
              <p className="text-xs text-slate-500">CEO control layer · Answer & Implementation modes</p>
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
                {state.source === 'gpt' ? 'GPT' : state.source === 'fallback' ? 'Fallback' : 'Local'}
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
            <Card title="Command input" icon={<Sparkles className="h-4 w-4 text-indigo-300" />}>
              <form onSubmit={submitCommand} className="space-y-3">
                <label htmlFor="jarvis-command-input" className="text-sm text-slate-400">
                  Send a command to SJ Jarvis
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
                    Run
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
                  {COMMAND_CHIPS.map((chip) => (
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
                <p className="text-xs text-slate-500">Shortcut: Ctrl + Space · Local data only · no external AI/API</p>
              </form>
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
                    voiceActive ? (
                      <button
                        type="button"
                        onClick={stopVoice}
                        className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2.5 text-sm font-medium text-rose-200 transition hover:bg-rose-500/25"
                      >
                        <MicOff className="h-4 w-4" />
                        {usesRecorder ? '녹음 중지' : '듣기 중지'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={startVoice}
                        disabled={transcribing}
                        className={[
                          'inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition',
                          transcribing
                            ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600'
                            : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'
                        ].join(' ')}
                      >
                        {usesRecorder ? <AudioLines className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
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
                </div>

                {voiceActive ? (
                  <div className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-400" />
                    </span>
                    {usesRecorder
                      ? `녹음 중입니다… (최대 ${recorder.getMaxSeconds()}초 · 눌러서 중지)`
                      : '자비스가 듣고 있습니다…'}
                  </div>
                ) : null}

                {transcribing ? (
                  <div className="flex items-center gap-2 rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    음성을 텍스트로 변환하는 중입니다…
                  </div>
                ) : null}

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

            <Card title="Assistant response" icon={<Bot className="h-4 w-4 text-indigo-300" />}>
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
              <Card title="Answer" icon={<Compass className="h-4 w-4 text-sky-300" />}>
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
              <Card title="External action" icon={<ExternalLink className="h-4 w-4 text-sky-300" />}>
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
              <Card title="GPT brain" icon={<Brain className="h-4 w-4 text-fuchsia-300" />}>
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
              <Card title="Implementation request created" icon={<Hammer className="h-4 w-4 text-amber-300" />}>
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
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Routing</div>
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
                  <button
                    type="button"
                    onClick={() => goToTarget('pm')}
                    className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                    PM Planner에서 확인
                  </button>
                </div>
              </Card>
            ) : null}

            {/* Universal App Builder result */}
            {build ? (
              <Card title="Universal App Builder" icon={<Boxes className="h-4 w-4 text-violet-300" />}>
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
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">AI Tool Plan</div>
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
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Sprint Plan</div>
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
                        onClick={() => copyPrompt(build.generatedDeveloperPrompt)}
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
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Routing</div>
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
                  </div>
                </div>
              </Card>
            ) : null}

            {/* Suggested next commands */}
            {state.suggestedCommands.length > 0 ? (
              <Card title="Suggested commands" icon={<Sparkles className="h-4 w-4 text-indigo-300" />}>
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
            <Card title="Execution status" icon={<CheckCircle2 className="h-4 w-4 text-indigo-300" />}>
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
                  <div className="font-medium text-slate-200">Mode · Status</div>
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
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Tool calls</div>
                  {state.toolCalls.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-800 p-3 text-sm text-slate-500">
                      No tool calls yet.
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

            <Card title="Recent commands" icon={<History className="h-4 w-4 text-indigo-300" />}>
              <div className="space-y-2">
                {state.recentCommands.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-800 p-3 text-sm text-slate-500">
                    No recent commands yet.
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

            <Card title="Conversation history" icon={<History className="h-4 w-4 text-indigo-300" />}>
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {state.history.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-800 p-3 text-sm text-slate-500">
                    No conversation yet.
                  </div>
                ) : (
                  state.history.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm">
                      <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                        {entry.role === 'user' ? 'User' : 'Jarvis'} · {entry.timestamp}
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
