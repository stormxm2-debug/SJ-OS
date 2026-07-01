import {
  Play,
  Pause,
  Square,
  Cpu,
  GitBranch,
  Timer,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react'
import type { KernelStateSnapshot } from '@shared/kernel'
import { ROADMAP } from '@renderer/data/productBacklog'
import { useAutonomousLoop } from '@renderer/backlog/useAutonomousLoop'
import { useBacklog } from '@renderer/backlog/useBacklog'
import { useKernel } from '@renderer/chief-of-staff/useKernel'
import { useChiefOfStaff } from '@renderer/chief-of-staff/useChiefOfStaff'
import Card from '@renderer/components/ui/Card'
import Chip from '@renderer/components/ui/Chip'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { ROLE_LABEL } from '@renderer/lib/companyMeta'

function longestChain(tasks: KernelStateSnapshot['tasks']): number {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const memo = new Map<string, number>()
  const depth = (id: string): number => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    const t = byId.get(id)
    if (!t) return 0
    const d = 1 + t.dependsOn.reduce((max, dep) => Math.max(max, depth(dep)), 0)
    memo.set(id, d)
    return d
  }
  return tasks.reduce((max, t) => Math.max(max, depth(t.id)), 0)
}

export default function AutopilotPage(): JSX.Element {
  const loop = useAutonomousLoop()
  const backlog = useBacklog()
  const kernel = useKernel()
  const { state: cos } = useChiefOfStaff()

  const total = backlog.length
  const completed = backlog.filter((b) => b.status === 'completed').length
  const planned = backlog.filter((b) => b.status === 'planned').length
  const blocked = backlog.filter((b) => b.status === 'blocked')
  const progress = total ? Math.round((completed / total) * 100) : 0

  const currentItem = loop.state.currentItemId
    ? backlog.find((b) => b.id === loop.state.currentItemId)
    : undefined
  const currentRelease = currentItem
    ? ROADMAP.find((r) => r.id === currentItem.releaseId)
    : undefined

  const busyWorkers = kernel.workers.filter((w) => w.state === 'busy')
  const criticalPath = longestChain(kernel.tasks)
  const runningTask = kernel.tasks.find((t) => t.state === 'running')

  const statusLabel = !loop.state.running
    ? 'Idle'
    : loop.state.paused
      ? 'Paused'
      : 'Running'

  const risks: string[] = []
  if (blocked.length > 0) risks.push(`${blocked.length} backlog item(s) blocked.`)
  const failed = loop.state.processed.filter((p) => p.outcome === 'blocked')
  if (failed.length > 0) risks.push(`${failed.length} item(s) failed this session.`)
  const stalled =
    backlog.filter(
      (b) =>
        b.status === 'planned' &&
        b.dependencies.some((d) => {
          const dep = backlog.find((x) => x.id === d)
          return dep && dep.status !== 'completed'
        })
    ).length
  if (stalled > 0) risks.push(`${stalled} item(s) waiting on dependencies.`)

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Autopilot</h1>
          <p className="mt-1 text-sm text-slate-400">
            The AI Company works the Product Backlog autonomously. You approve,
            pause, resume, reprioritize or cancel — never assign tasks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loop.state.running ? (
            <Control onClick={loop.start} icon={<Play className="h-3.5 w-3.5" />} label="Start" primary />
          ) : loop.state.paused ? (
            <Control onClick={loop.resume} icon={<Play className="h-3.5 w-3.5" />} label="Resume" primary />
          ) : (
            <Control onClick={loop.pause} icon={<Pause className="h-3.5 w-3.5" />} label="Pause" />
          )}
          <Control onClick={loop.cancel} icon={<Square className="h-3.5 w-3.5" />} label="Cancel" />
        </div>
      </div>

      <Card
        title="Autonomous status"
        action={
          <Chip tone={statusLabel === 'Running' ? 'emerald' : statusLabel === 'Paused' ? 'amber' : 'slate'}>
            {statusLabel}
          </Chip>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Current epic" value={currentRelease ? `${currentRelease.name} · ${currentRelease.theme}` : '—'} />
          <Field label="Current feature" value={currentItem ? currentItem.title : 'Idle'} />
          <Field label="Company is" value={cos.phase.replace('_', ' ')} />
          <Field
            label="ETA"
            value={loop.state.running ? `~${planned} item(s) remaining this session` : 'not running'}
          />
        </div>
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
            <span>Backlog progress</span>
            <span>{completed} / {total} done</span>
          </div>
          <ProgressBar value={progress} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Department load" icon={<Cpu className="h-4 w-4 text-indigo-300" />}>
          <ul className="space-y-1.5">
            {kernel.departments.map((d) => {
              const members = kernel.workers.filter((w) => w.departmentId === d.id)
              const active = members.filter((w) => w.state === 'busy').length
              return (
                <li key={d.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{d.name}</span>
                  <span className={active > 0 ? 'text-emerald-300' : 'text-slate-600'}>
                    {active}/{members.length} active
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>

        <Card title="Execution" icon={<GitBranch className="h-4 w-4 text-indigo-300" />}>
          <div className="space-y-2 text-sm">
            <Field label="Worker load" value={`${busyWorkers.length}/${kernel.workers.length} busy`} />
            <Field
              label="Critical path"
              value={criticalPath > 0 ? `${criticalPath} step(s) deep` : '—'}
            />
            <Field
              label="Running now"
              value={runningTask ? `${ROLE_LABEL[runningTask.capability]}: ${runningTask.title}` : 'idle'}
            />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Session report (daily / weekly)" icon={<Timer className="h-4 w-4 text-indigo-300" />}>
          {loop.state.processed.length === 0 ? (
            <p className="text-sm text-slate-600">No items processed yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {loop.state.processed.map((p, i) => (
                <li key={`${p.itemId}-${i}`} className="flex items-center gap-2 text-sm">
                  {p.outcome === 'completed' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                  )}
                  <span className="text-slate-300">{p.title}</span>
                  <span className="ml-auto text-xs text-slate-500">{p.outcome}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Risks" icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}>
          {risks.length === 0 ? (
            <p className="text-sm text-slate-600">No risks detected.</p>
          ) : (
            <ul className="space-y-1.5">
              {risks.map((r) => (
                <li key={r} className="flex items-start gap-2 text-sm text-slate-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  {r}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-600">{label}</div>
      <div className="mt-0.5 text-sm text-slate-200">{value}</div>
    </div>
  )
}

function Control({
  onClick,
  icon,
  label,
  primary
}: {
  onClick: () => void
  icon: JSX.Element
  label: string
  primary?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
        primary
          ? 'bg-indigo-600 text-white hover:bg-indigo-500'
          : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}
