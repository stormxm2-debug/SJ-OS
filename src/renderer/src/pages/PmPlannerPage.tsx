import { useMemo, useState, type ReactNode } from 'react'
import {
  FolderKanban,
  Layers,
  GitBranch,
  ListChecks,
  Sparkles,
  Download,
  RotateCcw,
  CheckCheck,
  Ban,
  Eraser,
  Rocket,
  Link2,
  ClipboardList,
  History,
  AlertTriangle
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { usePm } from '@renderer/services/pm/usePm'
import { pmRepository } from '@renderer/services/pm/PmRepository'
import { useDevOs } from '@renderer/services/devos/useDevOs'
import type {
  PmBacklogItem,
  PmEpic,
  PmFeature,
  PmLogType,
  PmPriority,
  PmSnapshot,
  PmStatus,
  PmTask
} from '@renderer/services/pm/types'
import type { WorkerMemory } from '@renderer/services/devos/types'

const PRIORITY_STYLES: Record<PmPriority, string> = {
  P0: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  P1: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  P2: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  P3: 'border-slate-600/40 bg-slate-700/20 text-slate-300'
}

const STATUS_STYLES: Record<PmStatus, string> = {
  planned: 'border-slate-600/40 bg-slate-700/20 text-slate-300',
  in_progress: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  blocked: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
}

const STATUS_LABELS: Record<PmStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  blocked: 'Blocked',
  completed: 'Completed'
}

const LOG_STYLES: Record<PmLogType, { label: string; className: string }> = {
  'backlog-added': { label: 'Backlog added', className: 'text-sky-300' },
  'plan-generated': { label: 'Plan generated', className: 'text-indigo-300' },
  'task-completed': { label: 'Task completed', className: 'text-emerald-300' },
  'task-assigned': { label: 'Task assigned', className: 'text-sky-300' },
  'blocker-added': { label: 'Blocker added', className: 'text-rose-300' },
  'blocker-cleared': { label: 'Blocker cleared', className: 'text-emerald-300' },
  'feature-promoted': { label: 'Feature promoted', className: 'text-indigo-300' },
  reset: { label: 'Reset', className: 'text-amber-300' }
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** Trigger a client-side download of the current PM plan as JSON. */
function exportPlan(): void {
  const json = pmRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'pm-plan.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Build a lookup from any plan node id to its display title. */
function buildTitleMap(snapshot: PmSnapshot): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of [
    ...snapshot.backlogItems,
    ...snapshot.epics,
    ...snapshot.features,
    ...snapshot.tasks
  ]) {
    map.set(node.id, node.title)
  }
  return map
}

/**
 * PM Planner view. Reads the persisted plan from the pm repository (via usePm)
 * and renders the backlogItem → epic → feature → task hierarchy. All mutations
 * delegate to pmRepository — no business logic in the component. Worker names
 * come from DevOS memory so ownership reads well.
 */
export default function PmPlannerPage(): JSX.Element {
  const snapshot = usePm()
  const { workers } = useDevOs()
  const titleMap = useMemo(() => buildTitleMap(snapshot), [snapshot])

  const workerName = (workerId: string): string =>
    workers.find((w) => w.workerId === workerId)?.name ?? workerId

  const counts = {
    backlogItems: snapshot.backlogItems.length,
    epics: snapshot.epics.length,
    features: snapshot.features.length,
    tasks: snapshot.tasks.length,
    completedTasks: snapshot.tasks.filter((t) => t.status === 'completed').length
  }

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('Reset the PM plan back to the seed?')) {
      return
    }
    pmRepository.resetPlan()
  }

  return (
    <div className="space-y-5">
      <Card
        title="PM Planner"
        icon={<FolderKanban className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportPlan}>
              Export plan JSON
            </ActionButton>
            <ActionButton variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={handleReset}>
              Reset plan
            </ActionButton>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <StatTile icon={<ClipboardList className="h-4 w-4" />} label="Backlog items" value={counts.backlogItems} />
          <StatTile icon={<Layers className="h-4 w-4" />} label="Epics" value={counts.epics} />
          <StatTile icon={<GitBranch className="h-4 w-4" />} label="Features" value={counts.features} />
          <StatTile
            icon={<ListChecks className="h-4 w-4" />}
            label="Tasks"
            value={`${counts.completedTasks}/${counts.tasks} done`}
          />
        </div>
      </Card>

      {snapshot.backlogItems.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">No backlog items yet.</p>
        </Card>
      ) : (
        snapshot.backlogItems.map((item) => (
          <BacklogItemSection
            key={item.id}
            item={item}
            snapshot={snapshot}
            titleMap={titleMap}
            workers={workers}
            workerName={workerName}
          />
        ))
      )}

      <Card
        title="Planner Event Log"
        icon={<History className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{snapshot.eventLog.length} events</span>}
      >
        {snapshot.eventLog.length === 0 ? (
          <p className="text-sm text-slate-500">No events yet. Use the planner actions to record activity.</p>
        ) : (
          <ol className="space-y-2">
            {snapshot.eventLog.map((entry) => {
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
    </div>
  )
}

function BacklogItemSection({
  item,
  snapshot,
  titleMap,
  workers,
  workerName
}: {
  item: PmBacklogItem
  snapshot: PmSnapshot
  titleMap: Map<string, string>
  workers: WorkerMemory[]
  workerName: (workerId: string) => string
}): JSX.Element {
  const epics = snapshot.epics.filter((e) => e.backlogItemId === item.id)

  return (
    <Card
      title={item.title}
      icon={<ClipboardList className="h-4 w-4" />}
      action={
        <div className="flex items-center gap-2">
          <PriorityBadge priority={item.priority} />
          <StatusBadge status={item.status} />
          <ActionButton
            icon={<Sparkles className="h-4 w-4" />}
            variant="primary"
            onClick={() => pmRepository.generatePlanFromBacklogItem(item.id)}
          >
            Generate plan
          </ActionButton>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-400">{item.description}</p>
        <MetaRow owner={workerName(item.ownerWorkerId)} complexity={item.estimatedComplexity} />
        <AcceptanceCriteria items={item.acceptanceCriteria} />

        {epics.length === 0 ? (
          <p className="text-sm text-slate-500">
            No epics yet — use “Generate plan” to break this item down.
          </p>
        ) : (
          <div className="space-y-4">
            {epics.map((epic) => (
              <EpicBlock
                key={epic.id}
                epic={epic}
                snapshot={snapshot}
                titleMap={titleMap}
                workers={workers}
                workerName={workerName}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function EpicBlock({
  epic,
  snapshot,
  titleMap,
  workers,
  workerName
}: {
  epic: PmEpic
  snapshot: PmSnapshot
  titleMap: Map<string, string>
  workers: WorkerMemory[]
  workerName: (workerId: string) => string
}): JSX.Element {
  const features = snapshot.features.filter((f) => f.epicId === epic.id)

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-indigo-300" />
          <span className="text-sm font-semibold text-slate-100">{epic.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <PriorityBadge priority={epic.priority} />
          <StatusBadge status={epic.status} />
          <span className="text-xs text-slate-500">Owner: {workerName(epic.ownerWorkerId)}</span>
        </div>
      </div>
      <div className="mt-2">
        <AcceptanceCriteria items={epic.acceptanceCriteria} />
      </div>

      <div className="mt-3 space-y-3">
        {features.map((feature) => (
          <FeatureCard
            key={feature.id}
            feature={feature}
            snapshot={snapshot}
            titleMap={titleMap}
            workers={workers}
            workerName={workerName}
          />
        ))}
      </div>
    </div>
  )
}

function FeatureCard({
  feature,
  snapshot,
  titleMap,
  workers,
  workerName
}: {
  feature: PmFeature
  snapshot: PmSnapshot
  titleMap: Map<string, string>
  workers: WorkerMemory[]
  workerName: (workerId: string) => string
}): JSX.Element {
  const tasks = snapshot.tasks.filter((t) => t.featureId === feature.id)

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-100">{feature.title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={feature.priority} />
          <StatusBadge status={feature.status} />
          <span className="text-xs text-slate-500">Owner: {workerName(feature.ownerWorkerId)}</span>
          <ActionButton
            icon={<Rocket className="h-4 w-4" />}
            variant="primary"
            onClick={() => pmRepository.promoteFeatureToActive(feature.id)}
          >
            Promote to active
          </ActionButton>
        </div>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <AcceptanceCriteria items={feature.acceptanceCriteria} />
        <Dependencies ids={feature.dependencies} titleMap={titleMap} />
      </div>

      <div className="mt-3 space-y-2">
        {tasks.length === 0 ? (
          <div className="text-xs text-slate-600">No tasks.</div>
        ) : (
          tasks.map((task) => (
            <TaskRow key={task.id} task={task} workers={workers} workerName={workerName} />
          ))
        )}
      </div>
    </div>
  )
}

function TaskRow({
  task,
  workers,
  workerName
}: {
  task: PmTask
  workers: WorkerMemory[]
  workerName: (workerId: string) => string
}): JSX.Element {
  const [blockerDraft, setBlockerDraft] = useState('')

  const handleAddBlocker = (): void => {
    if (pmRepository.addBlocker(task.id, blockerDraft).success) {
      setBlockerDraft('')
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ListChecks className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <span className="truncate text-sm text-slate-200">{task.title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={task.priority} />
          <StatusBadge status={task.status} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          Owner:
          <select
            value={task.ownerWorkerId}
            onChange={(e) => pmRepository.assignTaskToWorker(task.id, e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 focus:border-indigo-500/50 focus:outline-none"
          >
            {workers.every((w) => w.workerId !== task.ownerWorkerId) && (
              <option value={task.ownerWorkerId}>{workerName(task.ownerWorkerId)}</option>
            )}
            {workers.map((w) => (
              <option key={w.workerId} value={w.workerId}>
                {w.name}
              </option>
            ))}
          </select>
        </label>

        <MiniButton
          icon={<CheckCheck className="h-3 w-3" />}
          onClick={() => pmRepository.markTaskComplete(task.id)}
        >
          Complete
        </MiniButton>
        {task.status === 'blocked' ? (
          <MiniButton
            icon={<Eraser className="h-3 w-3" />}
            onClick={() => pmRepository.clearBlocker(task.id)}
          >
            Clear blocker
          </MiniButton>
        ) : null}
      </div>

      {task.status === 'blocked' && task.blocker ? (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{task.blocker}</span>
        </div>
      ) : (
        <div className="mt-2 flex gap-1.5">
          <input
            type="text"
            value={blockerDraft}
            onChange={(e) => setBlockerDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddBlocker()
            }}
            placeholder="Add a blocker…"
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAddBlocker}
            className="inline-flex items-center rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300 transition hover:bg-slate-700/60"
            aria-label="Add blocker"
          >
            <Ban className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}

// --- presentational helpers ------------------------------------------------

function StatTile({
  icon,
  label,
  value
}: {
  icon: ReactNode
  label: string
  value: ReactNode
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

function PriorityBadge({ priority }: { priority: PmPriority }): JSX.Element {
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', PRIORITY_STYLES[priority]].join(' ')}>
      {priority}
    </span>
  )
}

function StatusBadge({ status }: { status: PmStatus }): JSX.Element {
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_STYLES[status]].join(' ')}>
      {STATUS_LABELS[status]}
    </span>
  )
}

function MetaRow({ owner, complexity }: { owner: string; complexity: string }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
      <span>Owner: {owner}</span>
      <span>Complexity: {complexity}</span>
    </div>
  )
}

function AcceptanceCriteria({ items }: { items: string[] }): JSX.Element {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        Acceptance criteria
      </div>
      {items.length === 0 ? (
        <div className="ml-4 text-xs text-slate-600">—</div>
      ) : (
        <ul className="ml-4 mt-0.5 list-disc space-y-0.5 text-xs text-slate-400 marker:text-slate-700">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Dependencies({
  ids,
  titleMap
}: {
  ids: string[]
  titleMap: Map<string, string>
}): JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        <Link2 className="h-3 w-3" />
        Dependencies
      </div>
      {ids.length === 0 ? (
        <div className="ml-4 text-xs text-slate-600">None</div>
      ) : (
        <ul className="ml-4 mt-0.5 list-disc space-y-0.5 text-xs text-slate-400 marker:text-slate-700">
          {ids.map((id) => (
            <li key={id}>{titleMap.get(id) ?? id}</li>
          ))}
        </ul>
      )}
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
