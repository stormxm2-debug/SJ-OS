import { type ReactNode } from 'react'
import {
  Rocket,
  Play,
  StepForward,
  Pause,
  Square,
  RotateCcw,
  Download,
  ShieldOff,
  Activity,
  ListChecks,
  AlertTriangle,
  AlertCircle,
  ArrowRight,
  Building2,
  User,
  CheckCircle2,
  Circle,
  Loader2,
  Ban
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { useAutopilot } from '@renderer/services/autopilot/useAutopilot'
import { autopilotService } from '@renderer/services/autopilot/AutopilotService'
import type {
  AutopilotState,
  AutopilotStatus,
  AutopilotStepStatus,
  AutopilotTimelineEntry
} from '@renderer/services/autopilot/types'

// --- styling helpers -------------------------------------------------------

const STATUS_TONE: Record<AutopilotStatus, { dot: string; text: string; label: string }> = {
  idle: { dot: 'bg-slate-500', text: 'text-slate-300', label: 'Idle' },
  running: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Running' },
  paused: { dot: 'bg-amber-400', text: 'text-amber-300', label: 'Paused' },
  blocked: { dot: 'bg-rose-400', text: 'text-rose-300', label: 'Blocked' },
  'waiting-for-approval': { dot: 'bg-amber-400', text: 'text-amber-300', label: 'Waiting for approval' },
  completed: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Completed' },
  failed: { dot: 'bg-rose-400', text: 'text-rose-300', label: 'Failed' }
}

const STEP_ICON: Record<AutopilotStepStatus, ReactNode> = {
  pending: <Circle className="h-3.5 w-3.5 text-slate-600" />,
  active: <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-300" />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
  blocked: <Ban className="h-3.5 w-3.5 text-rose-400" />,
  skipped: <Circle className="h-3.5 w-3.5 text-slate-700" />
}

function progressTone(value: number): string {
  if (value >= 80) return 'text-emerald-300'
  if (value >= 50) return 'text-amber-300'
  return 'text-rose-300'
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** Trigger a client-side download of the current run as JSON. */
function exportReport(): void {
  const json = autopilotService.serializeReport()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'autopilot-report.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Autopilot — the AI Company Operating Loop. Reads the operating-loop state (via
 * useAutopilot) and drives it through autopilotService. The loop walks the whole
 * company one safe, local step at a time: Approval Center → PM Planner →
 * Development OS → Worker Memory → CTO Room → QA → Release → DevOps → Live
 * Company. No business logic lives in this component.
 */
export default function AutopilotPage(): JSX.Element {
  const state = useAutopilot()
  const tone = STATUS_TONE[state.status]

  const running = state.status === 'running'
  const paused = state.status === 'paused'
  const active = running || state.status === 'waiting-for-approval' || state.status === 'blocked'
  const canStep = active
  const activeStep = markActiveStep(state)

  const handleReset = (): void => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Reset the Autopilot run? Other modules are left untouched.')
    ) {
      return
    }
    autopilotService.resetDemoState()
  }

  return (
    <div className="space-y-5">
      {/* Operating-loop header + controls */}
      <Card
        title="Autopilot — Operating Loop"
        icon={<Rocket className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Play className="h-4 w-4" />} variant="primary" onClick={() => autopilotService.start()}>
              Start Company
            </ActionButton>
            <ActionButton icon={<StepForward className="h-4 w-4" />} onClick={() => autopilotService.runStep()} disabled={!canStep}>
              Run one step
            </ActionButton>
            {paused ? (
              <ActionButton icon={<Play className="h-4 w-4" />} onClick={() => autopilotService.resume()}>
                Resume
              </ActionButton>
            ) : (
              <ActionButton icon={<Pause className="h-4 w-4" />} onClick={() => autopilotService.pause()} disabled={!active}>
                Pause
              </ActionButton>
            )}
            <ActionButton icon={<Square className="h-4 w-4" />} onClick={() => autopilotService.stop()} disabled={state.status === 'idle'}>
              Stop
            </ActionButton>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={['h-2.5 w-2.5 rounded-full', tone.dot, active ? 'animate-pulse' : ''].join(' ')} />
              <div>
                <div className="text-xs text-slate-500">Operating loop status</div>
                <div className={['text-lg font-semibold', tone.text].join(' ')}>{tone.label}</div>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              {state.autopilotRunId ? `Run ${state.autopilotRunId}` : 'No run yet'} · step {state.currentStep}/9 · updated{' '}
              {formatTimestamp(state.updatedAt)}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Operating-loop progress</span>
              <span className={progressTone(state.progress)}>{state.progress}%</span>
            </div>
            <div className="mt-1">
              <ProgressBar value={state.progress} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile icon={<Building2 className="h-4 w-4" />} label="Current department" value={state.currentDepartment} />
            <Tile icon={<User className="h-4 w-4" />} label="Current worker" value={state.currentWorker} />
            <Tile icon={<Activity className="h-4 w-4" />} label="Current action" value={state.currentAction} />
            <Tile icon={<ArrowRight className="h-4 w-4" />} label="Next action" value={state.nextAction} />
          </div>
        </div>
      </Card>

      {/* Quick actions */}
      <Card title="Quick Actions" icon={<ListChecks className="h-4 w-4" />}>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton icon={<Play className="h-4 w-4" />} variant="primary" onClick={() => autopilotService.start()}>
            Start Company
          </ActionButton>
          <ActionButton icon={<StepForward className="h-4 w-4" />} onClick={() => autopilotService.runStep()} disabled={!canStep}>
            Run one loop step
          </ActionButton>
          <ActionButton icon={<Pause className="h-4 w-4" />} onClick={() => autopilotService.pause()} disabled={!active}>
            Pause loop
          </ActionButton>
          <ActionButton icon={<Play className="h-4 w-4" />} onClick={() => autopilotService.resume()} disabled={!paused}>
            Resume loop
          </ActionButton>
          <ActionButton icon={<Square className="h-4 w-4" />} onClick={() => autopilotService.stop()} disabled={state.status === 'idle'}>
            Stop loop
          </ActionButton>
          <ActionButton icon={<ShieldOff className="h-4 w-4" />} onClick={() => autopilotService.clearBlocker()} disabled={state.blockers.length === 0}>
            Clear autopilot blocker
          </ActionButton>
          <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
            Export autopilot report JSON
          </ActionButton>
          <ActionButton icon={<RotateCcw className="h-4 w-4" />} variant="danger" onClick={handleReset}>
            Reset autopilot demo state
          </ActionButton>
        </div>
      </Card>

      {/* Blockers + warnings */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Blockers"
          icon={<AlertTriangle className="h-4 w-4" />}
          action={<span className="text-xs text-slate-500">{state.blockers.length} open</span>}
        >
          {state.blockers.length === 0 ? (
            <p className="text-sm text-emerald-300/80">No blockers — the loop is clear to proceed.</p>
          ) : (
            <ul className="space-y-1">
              {state.blockers.map((b, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-200"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {b}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Warnings"
          icon={<AlertCircle className="h-4 w-4" />}
          action={<span className="text-xs text-slate-500">{state.warnings.length} noted</span>}
        >
          {state.warnings.length === 0 ? (
            <p className="text-sm text-slate-500">No warnings surfaced this run.</p>
          ) : (
            <ul className="space-y-1">
              {state.warnings.map((w, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Step-by-step timeline */}
      <Card
        title="Operating-Loop Timeline"
        icon={<ListChecks className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{state.currentStep}/9 steps</span>}
      >
        {activeStep.length === 0 ? (
          <p className="text-sm text-slate-500">
            No run yet. Press <span className="text-slate-300">Start Company</span> to walk the operating loop.
          </p>
        ) : (
          <ol className="space-y-2">
            {activeStep.map((entry) => (
              <TimelineRow key={entry.step} entry={entry} />
            ))}
          </ol>
        )}
      </Card>

      {/* Live activity log */}
      <Card
        title="Live Activity Log"
        icon={<Activity className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{state.activity.length} events</span>}
      >
        {state.activity.length === 0 ? (
          <p className="text-sm text-slate-500">Quiet. Start the company to see the operating loop move.</p>
        ) : (
          <ol className="max-h-[24rem] space-y-2 overflow-y-auto pr-1">
            {state.activity.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
              >
                <div className="truncate text-sm text-slate-300">{entry.message}</div>
                <span className="shrink-0 text-xs text-slate-600">{formatTimestamp(entry.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}

/** Mark the current step 'active' in a copy of the timeline for display. */
function markActiveStep(state: AutopilotState): AutopilotTimelineEntry[] {
  if (state.timeline.length === 0) return []
  const showActive = state.status === 'running' || state.status === 'paused'
  return state.timeline.map((entry) =>
    showActive && entry.step === state.currentStep + 1 && entry.status === 'pending'
      ? { ...entry, status: 'active' as AutopilotStepStatus }
      : entry
  )
}

// --- timeline row ----------------------------------------------------------

function TimelineRow({ entry }: { entry: AutopilotTimelineEntry }): JSX.Element {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
      <span className="mt-0.5">{STEP_ICON[entry.status]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-slate-100">
            {entry.step}. {entry.title}
          </div>
          <span className="shrink-0 text-[11px] text-slate-500">{entry.department}</span>
        </div>
        {entry.detail ? <div className="mt-0.5 truncate text-xs text-slate-400">{entry.detail}</div> : null}
      </div>
    </li>
  )
}

// --- presentational helpers ------------------------------------------------

function Tile({ icon, label, value }: { icon: ReactNode; label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-sm text-slate-200">{value}</div>
    </div>
  )
}

type ButtonVariant = 'default' | 'primary' | 'danger'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default: 'border-slate-700 bg-slate-800/60 text-slate-200 hover:bg-slate-700/60',
  primary: 'border-indigo-500/30 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25',
  danger: 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
}

function ActionButton({
  children,
  onClick,
  icon,
  variant = 'default',
  disabled = false
}: {
  children: ReactNode
  onClick: () => void
  icon?: ReactNode
  variant?: ButtonVariant
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition',
        BUTTON_VARIANTS[variant],
        disabled ? 'cursor-not-allowed opacity-40' : ''
      ].join(' ')}
    >
      {icon}
      {children}
    </button>
  )
}
