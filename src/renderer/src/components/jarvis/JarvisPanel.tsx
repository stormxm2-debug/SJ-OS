import { Bot, SendHorizontal, Sparkles, Wrench, History, X, CheckCircle2, AlertCircle, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import Card from '@renderer/components/ui/Card'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'
import type { JarvisState, JarvisStatus } from '@renderer/services/jarvis/types'

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

export default function JarvisPanel(): JSX.Element | null {
  const [service] = useState(() => jarvisService)
  const [state, setState] = useState<JarvisState>(() => service.getState())
  const [draft, setDraft] = useState('')
  const [streamedResponse, setStreamedResponse] = useState('')

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

  const submitCommand = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const command = draft.trim()
    if (!command) {
      return
    }

    setDraft('')
    const result = await service.executeCommand(command)
    setState({
      ...service.getState(),
      response: result.response,
      status: result.status,
      toolCalls: result.toolCalls
    })
  }

  if (!state.isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/95 shadow-2xl shadow-black/50">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-2 text-indigo-300">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-100">SJ Jarvis Core</p>
              <p className="text-xs text-slate-500">Global AI assistant for SJ OS</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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

        <div className="grid gap-4 p-4 lg:grid-cols-[1.15fr_0.85fr]">
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
                    placeholder="예: 오늘 실적"
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2.5 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2.5 text-sm font-medium text-indigo-300 transition hover:bg-indigo-500/20"
                  >
                    <SendHorizontal className="h-4 w-4" />
                    Run
                  </button>
                </div>
                <p className="text-xs text-slate-500">Shortcut: Ctrl + Space · Mock data only for now</p>
              </form>
            </Card>

            <Card title="Assistant response" icon={<Bot className="h-4 w-4 text-indigo-300" />}>
              <div className="min-h-[180px] rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm leading-7 text-slate-300">
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
          </div>

          <div className="space-y-4">
            <Card title="Execution status" icon={<CheckCircle2 className="h-4 w-4 text-indigo-300" />}>
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
                  <div className="font-medium text-slate-200">Current status</div>
                  <div className="mt-1 text-slate-400">{statusLabel(state.status)}</div>
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
                    <div key={command} className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
                      {command}
                    </div>
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
