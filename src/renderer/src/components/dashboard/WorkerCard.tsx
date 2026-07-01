import type { Worker } from '@shared/types'
import Avatar from '@renderer/components/ui/Avatar'
import StatusBadge from '@renderer/components/ui/StatusBadge'
import ProgressBar from '@renderer/components/ui/ProgressBar'

interface WorkerCardProps {
  worker: Worker
}

/** One AI worker: avatar, status, current task, progress, last activity. */
export default function WorkerCard({ worker }: WorkerCardProps): JSX.Element {
  const { name, title, role, avatar, status, currentTask, progress, lastActivity } =
    worker

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition hover:border-slate-700">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar role={role} label={avatar} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-100">
              {name}
            </div>
            <div className="truncate text-xs text-slate-500">{title}</div>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="mt-4 min-h-[2.5rem]">
        <div className="text-xs uppercase tracking-wide text-slate-600">
          Current task
        </div>
        <div className="mt-1 text-sm text-slate-300">
          {currentTask ?? <span className="text-slate-600">No active task</span>}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
          <span>Progress</span>
          <span className="tabular-nums">{progress}%</span>
        </div>
        <ProgressBar value={progress} />
      </div>

      <div className="mt-3 text-xs text-slate-600">Updated {lastActivity}</div>
    </div>
  )
}
