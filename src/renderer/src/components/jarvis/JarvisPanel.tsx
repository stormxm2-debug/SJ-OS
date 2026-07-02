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
  CloudOff
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import Card from '@renderer/components/ui/Card'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'
import { voiceService } from '@renderer/services/jarvis/VoiceService'
import type { VoiceStatus } from '@renderer/services/jarvis/VoiceService'
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
  'activity', 'settings'
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
  '네이버 열어줘',
  '구글 열어줘',
  'SJ OS 깃허브 열어줘',
  '오토파일럿 열어줘',
  'FC OS에 팀별 필터 추가해'
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
  const [lastCommand, setLastCommand] = useState('')
  const recognitionSupported = voice.isRecognitionSupported()
  const synthesisSupported = voice.isSynthesisSupported()
  const gptConfig = jarvisGptBrainService.getConfig()
  const { navigate } = useNavigation()

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
  // input, after normalizing it with the shared Jarvis helper.
  const handleVoiceTranscript = async (transcript: string): Promise<void> => {
    const normalized = normalizeCommand(transcript).spaced
    if (!normalized) return
    setInterimTranscript('')
    await runCommand(normalized)
  }

  const startListening = (): void => {
    setVoiceError(null)
    setInterimTranscript('')
    voice.stopSpeaking()
    voice.startListening({
      onStatusChange: setVoiceStatus,
      onInterim: setInterimTranscript,
      onError: (message) => setVoiceError(message),
      onFinal: (text) => {
        void handleVoiceTranscript(text)
      }
    })
  }

  const stopListening = (): void => {
    voice.stopListening()
  }

  const toggleVoiceOutput = (): void => {
    const next = voice.setVoiceOutput(!voiceOutputEnabled)
    setVoiceOutputEnabled(next)
    if (!next) voice.stopSpeaking()
  }

  // Stop mic + speech when the panel closes so nothing keeps listening/speaking.
  const isOpen = state.isOpen
  useEffect(() => {
    if (!isOpen) {
      voice.stopListening()
      voice.stopSpeaking()
      setInterimTranscript('')
      setVoiceStatus('idle')
    }
  }, [isOpen, voice])

  const goToTarget = (target: string | null | undefined): void => {
    const view = toView(target)
    if (!view) return
    navigate(view)
    service.close()
    setState(service.getState())
  }

  if (!state.isOpen) {
    return null
  }

  const answer = state.answer
  const impl = state.implementation
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
                    : 'border-slate-700 bg-slate-800/70 text-slate-300'
                }`}
              >
                {state.source === 'gpt' ? <Cpu className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                {state.source === 'gpt' ? 'GPT' : 'Local'}
              </span>
            ) : null}
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
                <div className="flex flex-wrap items-center gap-2">
                  {recognitionSupported ? (
                    voiceStatus === 'listening' ? (
                      <button
                        type="button"
                        onClick={stopListening}
                        className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2.5 text-sm font-medium text-rose-200 transition hover:bg-rose-500/25"
                      >
                        <MicOff className="h-4 w-4" />
                        듣기 중지
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={startListening}
                        className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2.5 text-sm font-medium text-indigo-300 transition hover:bg-indigo-500/20"
                      >
                        <Mic className="h-4 w-4" />
                        마이크 (눌러서 말하기)
                      </button>
                    )
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/50 px-3 py-2.5 text-sm text-slate-400">
                      <MicOff className="h-4 w-4" />
                      음성 인식 미지원
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

                {voiceStatus === 'listening' ? (
                  <div className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-400" />
                    </span>
                    자비스가 듣고 있습니다…
                  </div>
                ) : null}

                {interimTranscript ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
                    <span className="text-slate-500">인식 중: </span>
                    {interimTranscript}
                  </div>
                ) : null}

                {voiceError ? (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {voiceError}
                  </div>
                ) : null}

                {!recognitionSupported ? (
                  <p className="text-xs text-slate-500">이 환경에서는 음성 인식을 사용할 수 없습니다.</p>
                ) : null}

                <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                    Voice safety
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
                    <li>· 눌러서 말하기(push-to-talk) 전용 · 상시 청취 없음</li>
                    <li>· 로컬 브라우저 음성 인식만 사용</li>
                    <li>· 음성 저장 없음 · 외부로 오디오 전송 없음</li>
                    <li>· 외부 AI/API 사용 없음</li>
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

function Field({ label, value, tone }: { label: string; value: string; tone?: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={['mt-0.5 truncate text-sm font-medium', tone ?? 'text-slate-200'].join(' ')} title={value}>{value}</div>
    </div>
  )
}
