import type { ReactNode } from 'react'
import {
  Cpu,
  GitBranch,
  Layers,
  ListChecks,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Clock
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useDevOs } from '@renderer/services/devos/useDevOs'
import type { DevSessionStatus, WorkerMemory } from '@renderer/services/devos/types'

const SESSION_STATUS_STYLES: Record<DevSessionStatus, string> = {
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  blocked: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  paused: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  completed: 'border-sky-500/30 bg-sky-500/10 text-sky-300'
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/**
 * Development OS / Worker Memory view. Reads the persisted memory snapshot from
 * the devos repository (via useDevOs) and renders it. No business logic here.
 */
export default function DevelopmentOsPage(): JSX.Element {
  const { session, workers } = useDevOs()

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

function WorkerMemoryCard({ worker }: { worker: WorkerMemory }): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-100">{worker.name}</div>
          <div className="text-xs text-slate-500">
            {worker.role} · {worker.department}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-slate-200">{worker.confidence}%</div>
          <div className="text-[11px] text-slate-500">confidence</div>
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

      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-600">
        <Clock className="h-3 w-3" />
        Updated {formatTimestamp(worker.lastUpdated)}
      </div>
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
