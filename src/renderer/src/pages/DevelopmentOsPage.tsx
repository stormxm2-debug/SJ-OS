import { useState, type ReactNode } from 'react'
import {
  Cpu,
  GitBranch,
  Layers,
  ListChecks,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Clock,
  CheckCheck,
  Plus,
  Ban,
  Eraser,
  RotateCcw,
  Download,
  TrendingUp,
  History,
  ChevronUp,
  ChevronDown,
  RefreshCw
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useDevOs } from '@renderer/services/devos/useDevOs'
import { devOsRepository } from '@renderer/services/devos/DevOsRepository'
import type {
  DevOsLogType,
  DevSessionStatus,
  WorkerMemory
} from '@renderer/services/devos/types'

const SESSION_STATUS_STYLES: Record<DevSessionStatus, string> = {
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  blocked: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  paused: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  completed: 'border-sky-500/30 bg-sky-500/10 text-sky-300'
}

const LOG_STYLES: Record<DevOsLogType, { label: string; className: string }> = {
  'task-completed': { label: 'Task completed', className: 'text-emerald-300' },
  'worker-updated': { label: 'Worker updated', className: 'text-slate-300' },
  'blocker-added': { label: 'Blocker added', className: 'text-rose-300' },
  'blocker-cleared': { label: 'Blocker cleared', className: 'text-emerald-300' },
  'progress-changed': { label: 'Progress changed', className: 'text-indigo-300' },
  'next-action-changed': { label: 'Next action changed', className: 'text-indigo-300' },
  reset: { label: 'Reset', className: 'text-amber-300' }
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** Trigger a client-side download of the current DevOS snapshot as JSON. */
function exportSnapshot(): void {
  const json = devOsRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'devos-snapshot.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Development OS / Worker Memory view. Reads the persisted memory snapshot from
 * the devos repository (via useDevOs) and renders it. All mutations delegate to
 * devOsRepository — no business logic in the component. Local state is used only
 * for ephemeral form inputs.
 */
export default function DevelopmentOsPage(): JSX.Element {
  const { session, workers, eventLog } = useDevOs()
  const [nextActionDraft, setNextActionDraft] = useState('')
  const [blockerDraft, setBlockerDraft] = useState('')

  const handleAddBlocker = (): void => {
    if (devOsRepository.addBlocker(blockerDraft).success) {
      setBlockerDraft('')
    }
  }

  const handleSetNextAction = (): void => {
    if (devOsRepository.setNextAction(nextActionDraft).success) {
      setNextActionDraft('')
    }
  }

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('Reset DevOS demo state to the seed?')) {
      return
    }
    devOsRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      <Card
        title="Current Sprint"
        icon={<Cpu className="h-4 w-4" />}
        action={
          <span
            className={[
              'rounded-full border px-3 py-1 text-xs font-medium capitalize',
              SESSION_STATUS_STYLES[session.status]
            ].join(' ')}
          >
            {session.status}
          </span>
        }
      >
        <div className="space-y-4">
          <div>
            <div className="text-base font-semibold text-slate-100">{session.currentSprint}</div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5" />
              Updated {formatTimestamp(session.updatedAt)}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <FocusTile icon={<Layers className="h-4 w-4" />} label="Active Epic" value={session.currentEpic} />
            <FocusTile icon={<GitBranch className="h-4 w-4" />} label="Active Feature" value={session.currentFeature} />
            <FocusTile icon={<ListChecks className="h-4 w-4" />} label="Active Task" value={session.currentTask} />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
              <span>Progress</span>
              <span>{session.progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${Math.min(100, Math.max(0, session.progress))}%` }}
              />
            </div>
          </div>

          {session.status === 'blocked' && session.blockedReason && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{session.blockedReason}</span>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-200">
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-medium">Next action:</span> {session.nextAction}
            </span>
          </div>
        </div>
      </Card>

      <Card title="Quick Actions" icon={<TrendingUp className="h-4 w-4" />}>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <ActionButton
              icon={<CheckCheck className="h-4 w-4" />}
              onClick={() => devOsRepository.completeCurrentTask()}
            >
              Complete current task
            </ActionButton>
            <ActionButton
              icon={<ArrowRight className="h-4 w-4" />}
              onClick={() => devOsRepository.moveToNextAction()}
            >
              Move to next action
            </ActionButton>
            <ActionButton
              icon={<TrendingUp className="h-4 w-4" />}
              onClick={() => devOsRepository.increaseProgress(10)}
            >
              +10% progress
            </ActionButton>
            <ActionButton
              icon={<Eraser className="h-4 w-4" />}
              onClick={() => devOsRepository.clearBlocker()}
            >
              Clear blocker
            </ActionButton>
            <ActionButton
              variant="danger"
              icon={<RotateCcw className="h-4 w-4" />}
              onClick={handleReset}
            >
              Reset DevOS demo state
            </ActionButton>
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportSnapshot}>
              Export snapshot JSON
            </ActionButton>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <InlineForm
              value={blockerDraft}
              onChange={setBlockerDraft}
              onSubmit={handleAddBlocker}
              placeholder="Describe a blocker…"
              buttonLabel="Add blocker"
              buttonIcon={<Ban className="h-4 w-4" />}
              variant="danger"
            />
            <InlineForm
              value={nextActionDraft}
              onChange={setNextActionDraft}
              onSubmit={handleSetNextAction}
              placeholder="Set next action…"
              buttonLabel="Update next action"
              buttonIcon={<ArrowRight className="h-4 w-4" />}
              variant="primary"
            />
          </div>
        </div>
      </Card>

      <Card
        title="Sprint Event Log"
        icon={<History className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{eventLog.length} events</span>}
      >
        {eventLog.length === 0 ? (
          <p className="text-sm text-slate-500">No events yet. Use the controls above to record activity.</p>
        ) : (
          <ol className="space-y-2">
            {eventLog.map((entry) => {
              const meta = LOG_STYLES[entry.type]
              return (
                <li
                  key={entry.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className={['text-xs font-medium', meta.className].join(' ')}>{meta.label}</div>
                    <div className="truncate text-sm text-slate-300">{entry.message}</div>
                  </div>
                  <span className="shrink-0 text-xs text-slate-600">{formatTimestamp(entry.createdAt)}</span>
                </li>
              )
            })}
          </ol>
        )}
      </Card>

      <Card
        title="Worker Memory"
        icon={<Cpu className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{workers.length} workers</span>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          {workers.map((worker) => (
            <WorkerMemoryCard key={worker.workerId} worker={worker} />
          ))}
        </div>
      </Card>
    </div>
  )
}

function FocusTile({
  icon,
  label,
  value
}: {
  icon: ReactNode
  label: string
  value: string
}): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-slate-200">{value}</div>
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
  variant = 'default'
}: {
  children: ReactNode
  onClick: () => void
  icon?: ReactNode
  variant?: ButtonVariant
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition',
        BUTTON_VARIANTS[variant]
      ].join(' ')}
    >
      {icon}
      {children}
    </button>
  )
}

function InlineForm({
  value,
  onChange,
  onSubmit,
  placeholder,
  buttonLabel,
  buttonIcon,
  variant = 'default'
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder: string
  buttonLabel: string
  buttonIcon?: ReactNode
  variant?: ButtonVariant
}): JSX.Element {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit()
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
      />
      <ActionButton icon={buttonIcon} onClick={onSubmit} variant={variant}>
        {buttonLabel}
      </ActionButton>
    </div>
  )
}

function WorkerMemoryCard({ worker }: { worker: WorkerMemory }): JSX.Element {
  const [completedDraft, setCompletedDraft] = useState('')
  const [blockedDraft, setBlockedDraft] = useState('')

  const addCompleted = (): void => {
    if (devOsRepository.addCompletedWork(worker.workerId, completedDraft).success) {
      setCompletedDraft('')
    }
  }
  const addBlocked = (): void => {
    if (devOsRepository.addBlockedWork(worker.workerId, blockedDraft).success) {
      setBlockedDraft('')
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-100">{worker.name}</div>
          <div className="text-xs text-slate-500">
            {worker.role} · {worker.department}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-sm font-semibold text-slate-200">{worker.confidence}%</div>
            <div className="text-[11px] text-slate-500">confidence</div>
          </div>
          <div className="flex flex-col">
            <button
              type="button"
              aria-label="Increase confidence"
              onClick={() => devOsRepository.setWorkerConfidence(worker.workerId, worker.confidence + 5)}
              className="rounded border border-slate-700 bg-slate-800/60 px-1 text-slate-300 hover:bg-slate-700/60"
            >
              <ChevronUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label="Decrease confidence"
              onClick={() => devOsRepository.setWorkerConfidence(worker.workerId, worker.confidence - 5)}
              className="mt-0.5 rounded border border-slate-700 bg-slate-800/60 px-1 text-slate-300 hover:bg-slate-700/60"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">Current work</div>
        <div className="mt-0.5 text-sm text-slate-200">
          {worker.currentWork || <span className="text-slate-500">Idle</span>}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <WorkList
          icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
          label="Completed"
          items={worker.completedWork}
        />
        <WorkList
          icon={<AlertTriangle className="h-3.5 w-3.5 text-rose-400" />}
          label="Blocked"
          items={worker.blockedWork}
        />
        <WorkList
          icon={<ArrowRight className="h-3.5 w-3.5 text-indigo-400" />}
          label="Next"
          items={worker.nextWork}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <MiniButton
          icon={<CheckCheck className="h-3 w-3" />}
          onClick={() => devOsRepository.completeWorkerCurrentWork(worker.workerId)}
        >
          Complete current
        </MiniButton>
        <MiniButton
          icon={<Eraser className="h-3 w-3" />}
          onClick={() => devOsRepository.clearBlockedWork(worker.workerId)}
        >
          Clear blocked
        </MiniButton>
        <MiniButton
          icon={<RefreshCw className="h-3 w-3" />}
          onClick={() => devOsRepository.touchWorker(worker.workerId)}
        >
          Refresh
        </MiniButton>
      </div>

      <div className="mt-2 space-y-1.5">
        <MiniForm
          value={completedDraft}
          onChange={setCompletedDraft}
          onSubmit={addCompleted}
          placeholder="Add completed work…"
          icon={<Plus className="h-3 w-3" />}
        />
        <MiniForm
          value={blockedDraft}
          onChange={setBlockedDraft}
          onSubmit={addBlocked}
          placeholder="Add blocked work…"
          icon={<Ban className="h-3 w-3" />}
        />
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-600">
        <Clock className="h-3 w-3" />
        Updated {formatTimestamp(worker.lastUpdated)}
      </div>
    </div>
  )
}

function MiniButton({
  children,
  onClick,
  icon
}: {
  children: ReactNode
  onClick: () => void
  icon?: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700/60"
    >
      {icon}
      {children}
    </button>
  )
}

function MiniForm({
  value,
  onChange,
  onSubmit,
  placeholder,
  icon
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder: string
  icon?: ReactNode
}): JSX.Element {
  return (
    <div className="flex gap-1.5">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit()
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950/40 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
      />
      <button
        type="button"
        onClick={onSubmit}
        className="inline-flex items-center rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300 transition hover:bg-slate-700/60"
      >
        {icon}
      </button>
    </div>
  )
}

function WorkList({
  icon,
  label,
  items
}: {
  icon: ReactNode
  label: string
  items: string[]
}): JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {icon}
        {label}
        <span className="text-slate-600">({items.length})</span>
      </div>
      {items.length === 0 ? (
        <div className="ml-5 text-xs text-slate-600">—</div>
      ) : (
        <ul className="ml-5 mt-0.5 list-disc space-y-0.5 text-xs text-slate-400 marker:text-slate-700">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
