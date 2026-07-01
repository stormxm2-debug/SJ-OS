import type {
  ExecutionStatus,
  KernelStateSnapshot,
  KernelWorkerRecord
} from '@shared/kernel'
import { useKernel } from '@renderer/chief-of-staff/useKernel'
import Card from '@renderer/components/ui/Card'
import Chip from '@renderer/components/ui/Chip'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import type { ChipTone } from '@renderer/components/ui/Chip'
import { ROLE_LABEL, ROLE_META } from '@renderer/lib/companyMeta'
import { lastEventForWorker } from '@renderer/lib/kernelEvents'

/**
 * The Company Floor — every worker as a live employee card. Every field comes
 * straight from the Kernel snapshot (the single source of truth): no animation,
 * no random timers, no placeholder progress. When the Kernel is quiet the floor
 * is quiet; when it works, the floor comes alive.
 */

const ACTIVITY_META: Record<
  ExecutionStatus,
  { label: string; tone: ChipTone; dot: string }
> = {
  idle: { label: 'Idle', tone: 'slate', dot: 'bg-slate-500' },
  meeting: { label: 'Meeting', tone: 'indigo', dot: 'bg-indigo-400' },
  planning: { label: 'Planning', tone: 'sky', dot: 'bg-sky-400' },
  researching: { label: 'Researching', tone: 'sky', dot: 'bg-cyan-400' },
  coding: { label: 'Coding', tone: 'violet', dot: 'bg-violet-400' },
  testing: { label: 'Testing', tone: 'amber', dot: 'bg-amber-400' },
  review: { label: 'Review', tone: 'sky', dot: 'bg-sky-400' },
  waiting: { label: 'Waiting', tone: 'amber', dot: 'bg-amber-400' },
  completed: { label: 'Completed', tone: 'emerald', dot: 'bg-emerald-400' },
  failed: { label: 'Failed', tone: 'rose', dot: 'bg-rose-400' }
}

export default function CompanyFloor(): JSX.Element {
  const kernel = useKernel()
  const activeCount = kernel.workers.filter((w) => w.state === 'busy').length
  return (
    <Card
      title="Company Floor"
      action={
        <span className="text-xs text-slate-500">
          {kernel.departments.length} departments · {activeCount} working
        </span>
      }
    >
      <div className="space-y-4">
        {kernel.departments.map((dept) => {
          const members = dept.workerIds
            .map((id) => kernel.workers.find((w) => w.id === id))
            .filter((w): w is KernelWorkerRecord => Boolean(w))
          const active = members.filter((w) => w.state === 'busy').length
          return (
            <div key={dept.id}>
              <div className="mb-1.5 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                {dept.name}
                <span className="text-slate-600">
                  · {members.length} worker{members.length === 1 ? '' : 's'}
                  {active > 0 ? ` · ${active} active` : ''}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {members.map((worker) => (
                  <EmployeeCard key={worker.id} worker={worker} snapshot={kernel} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function EmployeeCard({
  worker,
  snapshot
}: {
  worker: KernelWorkerRecord
  snapshot: KernelStateSnapshot
}): JSX.Element {
  const role = worker.metadata.role
  const RoleIcon = ROLE_META[role].icon
  const activity = ACTIVITY_META[worker.activity]
  const task = worker.currentTaskId
    ? snapshot.tasks.find((t) => t.id === worker.currentTaskId) ?? null
    : null
  const project = task
    ? snapshot.projects.find((p) => p.id === task.projectId) ?? null
    : null
  const working = worker.state === 'busy'
  const lastEvent = lastEventForWorker(worker.id, snapshot)
  const waitingReason = worker.activity === 'waiting' ? task?.note ?? null : null

  return (
    <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center gap-2">
        <div
          className={[
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
            ROLE_META[role].avatarBg
          ].join(' ')}
        >
          <RoleIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-100">
            {worker.metadata.displayName}
          </div>
          <div className="text-xs text-slate-500">{ROLE_LABEL[role]}</div>
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {worker.metadata.simulated && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
              mock
            </span>
          )}
          <span className={['h-2 w-2 rounded-full', activity.dot].join(' ')} />
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Chip tone={activity.tone}>{activity.label}</Chip>
        {project && (
          <span className="truncate text-xs text-slate-500">{project.name}</span>
        )}
      </div>

      <div className="mt-2 min-h-[1.25rem] text-xs text-slate-400">
        {task ? (
          <span className="line-clamp-1">{task.title}</span>
        ) : (
          <span className="text-slate-600">No current task</span>
        )}
      </div>

      {working && task && (
        <div className="mt-1.5 flex items-center gap-2">
          <ProgressBar value={task.progress} />
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-500">
            {task.progress}%
          </span>
        </div>
      )}

      {waitingReason && (
        <div className="mt-1.5 text-xs text-amber-300/80">Waiting: {waitingReason}</div>
      )}

      <div className="mt-auto pt-2 text-[11px] text-slate-600">
        {lastEvent ? `Last: ${lastEvent}` : 'No activity yet'}
      </div>
    </div>
  )
}
