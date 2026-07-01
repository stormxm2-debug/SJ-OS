import { useState } from 'react'
import {
  Radio,
  Activity,
  Cpu,
  GitBranch,
  Layers,
  Building2,
  ChevronRight
} from 'lucide-react'
import type { KernelStateSnapshot, KernelWorkerRecord } from '@shared/kernel'
import { useKernel } from '@renderer/chief-of-staff/useKernel'
import { useChiefOfStaff } from '@renderer/chief-of-staff/useChiefOfStaff'
import { useAutonomousLoop } from '@renderer/backlog/useAutonomousLoop'
import { describeEvent } from '@renderer/lib/kernelEvents'
import { ROLE_LABEL, ROLE_META } from '@renderer/lib/companyMeta'
import Card from '@renderer/components/ui/Card'
import Chip from '@renderer/components/ui/Chip'
import ProgressBar from '@renderer/components/ui/ProgressBar'

// Deterministic pseudo-values for signals the Kernel does not yet track
// (tokens/CPU/memory). They move with REAL activity — never random — so nothing
// flickers or fakes loading.
function seed(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0
  return Math.abs(h)
}
function fmtTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

type CompanyState = 'Sleeping' | 'Working' | 'Meeting' | 'Releasing' | 'Paused' | 'Emergency'

const STATE_TONE: Record<CompanyState, { dot: string; text: string }> = {
  Sleeping: { dot: 'bg-slate-500', text: 'text-slate-300' },
  Working: { dot: 'bg-emerald-400', text: 'text-emerald-300' },
  Meeting: { dot: 'bg-indigo-400', text: 'text-indigo-300' },
  Releasing: { dot: 'bg-sky-400', text: 'text-sky-300' },
  Paused: { dot: 'bg-amber-400', text: 'text-amber-300' },
  Emergency: { dot: 'bg-rose-400', text: 'text-rose-300' }
}

const TIMELINE = ['Meeting', 'Planning', 'Research', 'Development', 'Testing', 'Git', 'Release']

export default function LiveCompanyPage(): JSX.Element {
  const kernel = useKernel()
  const { state: cos } = useChiefOfStaff()
  const loop = useAutonomousLoop()
  const [worker, setWorker] = useState<string | null>(null)
  const [epicOpen, setEpicOpen] = useState<string | null>(null)

  const busy = kernel.workers.filter((w) => w.state === 'busy')
  const runningTasks = kernel.tasks.filter((t) => t.state === 'running' || t.state === 'dispatched')
  const done = kernel.tasks.filter((t) => t.state === 'completed')
  const failed = kernel.tasks.filter((t) => t.state === 'failed')
  const activeDepts = kernel.departments.filter((d) =>
    kernel.workers.some((w) => w.departmentId === d.id && w.state === 'busy')
  )
  const companyState = deriveState(cos.phase, loop.state.paused, failed.length, kernel)

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* 7. Company status banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className={['h-2.5 w-2.5 rounded-full', STATE_TONE[companyState].dot, companyState !== 'Sleeping' ? 'animate-pulse' : ''].join(' ')} />
          <div>
            <div className="text-xs text-slate-500">Company state</div>
            <div className={['text-lg font-semibold', STATE_TONE[companyState].text].join(' ')}>{companyState}</div>
          </div>
        </div>
        <div className="text-xs text-slate-500">
          {cos.project ? `Project: ${cos.project.name}` : 'No active project'} · {busy.length}/{kernel.workers.length} workers active
        </div>
      </div>

      {/* 3. Company metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="Projects running" value={String(kernel.projects.filter((p) => p.state === 'active').length)} />
        <Metric label="Workers online" value={`${kernel.workers.length}`} />
        <Metric label="Departments active" value={`${activeDepts.length}/${kernel.departments.length}`} />
        <Metric label="Current tasks" value={String(runningTasks.length)} />
        <Metric label="Completed today" value={String(done.length)} />
        <Metric label="Files today" value={String(kernel.artifacts.length)} />
        <Metric label="Commits today" value={String(done.filter((t) => t.capability === 'git').length + Math.floor(kernel.artifacts.length / 6))} sim />
        <Metric label="QA pass rate" value={qaRate(kernel)} sim />
        <Metric label="Avg build time" value={`${8 + (done.length % 7)}s`} sim />
        <Metric label="Hours saved" value={`${(kernel.artifacts.length * 0.25 + done.length * 0.5).toFixed(1)}h`} sim />
      </div>

      {/* 4. Project timeline */}
      <Card title="Project timeline">
        <div className="flex flex-wrap items-center gap-1.5">
          {TIMELINE.map((stage, i) => {
            const idx = timelineIndex(cos.phase, kernel)
            const active = i === idx
            const doneStage = i < idx
            return (
              <div key={stage} className="flex items-center gap-1.5">
                <span className={['rounded-lg border px-2.5 py-1 text-xs font-medium', doneStage ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : active ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-100 animate-pulse' : 'border-slate-800 text-slate-500'].join(' ')}>{stage}</span>
                {i < TIMELINE.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-slate-700" />}
              </div>
            )
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Workers roster + profile */}
        <div className="space-y-4 lg:col-span-2">
          <Card title="Employees" action={<span className="text-xs text-slate-500">{busy.length} working</span>}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {kernel.workers.map((w) => (
                <WorkerCard key={w.id} worker={w} snapshot={kernel} open={worker === w.id} onToggle={() => setWorker(worker === w.id ? null : w.id)} />
              ))}
            </div>
          </Card>

          {/* 6. Department dashboard */}
          <Card title="Departments" icon={<Building2 className="h-4 w-4 text-indigo-300" />}>
            <div className="space-y-2">
              {kernel.departments.map((d) => {
                const members = kernel.workers.filter((w) => w.departmentId === d.id)
                const active = members.filter((w) => w.state === 'busy')
                const queue = kernel.tasks.filter((t) => t.capability === d.capability && t.state === 'pending')
                const completed = done.filter((t) => t.capability === d.capability)
                const current = runningTasks.find((t) => t.capability === d.capability)
                const util = members.length ? Math.round((active.length / members.length) * 100) : 0
                return (
                  <div key={d.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-200">{d.name}</span>
                      <span className="text-xs text-slate-500">util {util}% · queue {queue.length} · done {completed.length}</span>
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">{current ? `Working on: ${current.title}` : 'Idle'}</div>
                  </div>
                )
              })}
            </div>
          </Card>

          {/* 5. Epic view */}
          {cos.breakdown && (
            <Card title="Epic view" icon={<Layers className="h-4 w-4 text-indigo-300" />}>
              <div className="text-sm font-semibold text-slate-100">{cos.breakdown.epic.title}</div>
              <div className="mt-2 space-y-1">
                {cos.breakdown.epic.features.map((f) => (
                  <div key={f.id} className="rounded-lg border border-slate-800 bg-slate-900/40">
                    <button type="button" onClick={() => setEpicOpen(epicOpen === f.id ? null : f.id)} className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm">
                      <ChevronRight className={['h-3.5 w-3.5 text-slate-500 transition', epicOpen === f.id ? 'rotate-90' : ''].join(' ')} />
                      <span className="text-slate-200">{f.title}</span>
                      <span className="ml-auto text-xs text-slate-600">{f.tasks.length} tasks</span>
                    </button>
                    {epicOpen === f.id && (
                      <ul className="space-y-1 border-t border-slate-800 px-8 py-2 text-xs text-slate-400">
                        {f.tasks.map((t) => (
                          <li key={t.id}>
                            {t.title} <span className="text-slate-600">({ROLE_LABEL[t.role]})</span>
                            {t.subtasks.length > 0 && (
                              <ul className="ml-3 list-inside list-disc text-slate-600">
                                {t.subtasks.map((s) => <li key={s.id}>{s.title}</li>)}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* 1. Live activity feed */}
        <Card title="Live activity" icon={<Radio className="h-4 w-4 text-indigo-300" />}>
          {kernel.events.length === 0 ? (
            <p className="text-sm text-slate-600">Quiet. Start the company to see it work.</p>
          ) : (
            <ol className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
              {[...kernel.events].filter((e) => e.type !== 'TaskProgress').reverse().slice(0, 60).map((e) => (
                <li key={e.id} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0 font-mono text-[10px] text-slate-600">{fmtTime(e.at)}</span>
                  <span className="text-slate-300">{describeEvent(e, kernel)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  )
}

function Metric({ label, value, sim }: { label: string; value: string; sim?: boolean }): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center gap-1 text-[11px] text-slate-500">{label}{sim && <span className="text-slate-700">*</span>}</div>
      <div className="mt-0.5 text-lg font-semibold text-slate-100">{value}</div>
    </div>
  )
}

// 2. Worker profile (card + expandable full profile)
function WorkerCard({
  worker,
  snapshot,
  open,
  onToggle
}: {
  worker: KernelWorkerRecord
  snapshot: KernelStateSnapshot
  open: boolean
  onToggle: () => void
}): JSX.Element {
  const role = worker.metadata.role
  const RoleIcon = ROLE_META[role].icon
  const dept = snapshot.departments.find((d) => d.id === worker.departmentId)
  const task = worker.currentTaskId ? snapshot.tasks.find((t) => t.id === worker.currentTaskId) : undefined
  const project = task ? snapshot.projects.find((p) => p.id === task.projectId) : undefined
  const assignment = worker.currentTaskId ? snapshot.assignments.find((a) => a.taskId === worker.currentTaskId) : undefined
  const files = snapshot.artifacts.filter((a) => a.workerId === worker.id).length
  const workingMs = assignment ? Math.max(0, Date.now() - assignment.assignedAt) : 0
  const s = seed(worker.id)
  const cpu = worker.state === 'busy' ? 25 + ((task?.progress ?? 0) % 55) : 2 + (s % 4)
  const mem = 120 + (s % 260)
  const tokens = files * 640 + (task?.progress ?? 0) * 12
  const busy = worker.state === 'busy'

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <div className={['flex h-8 w-8 shrink-0 items-center justify-center rounded-md', ROLE_META[role].avatarBg].join(' ')}>
          <RoleIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-100">{worker.metadata.displayName}</div>
          <div className="text-xs text-slate-500">{ROLE_LABEL[role]}{worker.metadata.simulated ? ' · mock' : ''}</div>
        </div>
        <span className="ml-auto flex items-center gap-1.5">
          <Chip tone={busy ? 'amber' : 'slate'}>{worker.activity}</Chip>
          <span className={['h-2 w-2 rounded-full', busy ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'].join(' ')} />
        </span>
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-slate-800 px-3 py-3 text-xs">
          <Row label="Department" value={dept?.name ?? '—'} />
          <Row label="Status" value={worker.activity} />
          <Row label="Project" value={project?.name ?? '—'} />
          <Row label="Feature / Task" value={task?.title ?? 'idle'} />
          <Row label="Working time" value={busy ? `${Math.round(workingMs / 1000)}s` : '—'} />
          <Row label="Today’s files" value={String(files)} />
          <Row label="Today’s commits*" value={String(role === 'git' ? files : Math.floor(files / 3))} />
          <Row label="Today’s tokens*" value={tokens.toLocaleString()} />
          <Row label="CPU*" value={`${cpu}%`} />
          <Row label="Memory*" value={`${mem} MB`} />
          <Row label="Last activity" value={lastFor(worker.id, snapshot)} />
          <Row label="Performance*" value={`${90 + (s % 10)}% on-time`} />
          <div className="col-span-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-600">Conversation history</div>
            <div className="mt-0.5 text-slate-400">
              {task ? `Acknowledged “${task.title}”, executing.` : 'Awaiting assignment.'}
            </div>
          </div>
          <div className="col-span-2 text-[10px] text-slate-700">* derived/simulated — not yet tracked by the Kernel.</div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-600">{label}</span>
      <span className="truncate text-slate-300">{value}</span>
    </div>
  )
}

function lastFor(workerId: string, snapshot: KernelStateSnapshot): string {
  for (let i = snapshot.events.length - 1; i >= 0; i -= 1) {
    const e = snapshot.events[i]
    if ((e.type === 'WorkerAssigned' || e.type === 'TaskStarted' || e.type === 'TaskCompleted' || e.type === 'WorkerFailed') && e.workerId === workerId) {
      return `${e.type} · ${fmtTime(e.at)}`
    }
  }
  return '—'
}

function deriveState(phase: string, paused: boolean, failedCount: number, kernel: KernelStateSnapshot): CompanyState {
  if (paused) return 'Paused'
  if (failedCount > 0) return 'Emergency'
  if (phase === 'meeting') return 'Meeting'
  if (kernel.tasks.some((t) => (t.state === 'running' || t.state === 'dispatched') && t.capability === 'release')) return 'Releasing'
  if (phase !== 'idle' && phase !== 'done' && phase !== 'failed') return 'Working'
  return 'Sleeping'
}

function timelineIndex(phase: string, kernel: KernelStateSnapshot): number {
  if (phase === 'meeting') return 0
  if (phase === 'classifying' || phase === 'creating_project' || phase === 'planning' || phase === 'queuing' || phase === 'assigning') return 1
  const running = (cap: string): boolean => kernel.tasks.some((t) => (t.state === 'running' || t.state === 'dispatched') && t.capability === cap)
  const anyDone = (cap: string): boolean => kernel.tasks.some((t) => t.state === 'completed' && t.capability === cap)
  if (running('research')) return 2
  if (running('release') || anyDone('release')) return 6
  if (running('git') || anyDone('git')) return 5
  if (running('qa') || anyDone('qa')) return 4
  if (running('cto') || running('backend') || running('frontend') || running('developer')) return 3
  if (kernel.tasks.length > 0) return 3
  return 0
}

function qaRate(kernel: KernelStateSnapshot): string {
  const qaDone = kernel.tasks.filter((t) => t.capability === 'qa' && t.state === 'completed').length
  const qaFail = kernel.tasks.filter((t) => t.capability === 'qa' && t.state === 'failed').length
  const total = qaDone + qaFail
  if (total === 0) return '100%'
  return `${Math.round((qaDone / total) * 100)}%`
}
