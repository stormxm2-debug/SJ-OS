import { type ReactNode } from 'react'
import {
  Radio,
  Activity,
  Rocket,
  Layers,
  GitBranch,
  ListTree,
  Building2,
  Users,
  AlertTriangle,
  ShieldCheck,
  ClipboardCheck,
  Server,
  Gauge,
  ChevronRight,
  RefreshCw,
  Download,
  RotateCcw,
  ArrowRight,
  User,
  CircleDot
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { useLiveCompany } from '@renderer/services/live-company/useLiveCompany'
import { liveCompanyService } from '@renderer/services/live-company/LiveCompanyService'
import type { CompanyActivityEntry, DepartmentStage } from '@renderer/services/live-company/types'
import type { WorkerMemory } from '@renderer/services/devos/types'

// --- styling helpers -------------------------------------------------------

const STATUS_TONE: Record<string, { dot: string; text: string }> = {
  Working: { dot: 'bg-emerald-400', text: 'text-emerald-300' },
  'Awaiting approval': { dot: 'bg-amber-400', text: 'text-amber-300' },
  Deploying: { dot: 'bg-sky-400', text: 'text-sky-300' },
  Released: { dot: 'bg-emerald-400', text: 'text-emerald-300' },
  'Needs attention': { dot: 'bg-rose-400', text: 'text-rose-300' },
  Idle: { dot: 'bg-slate-500', text: 'text-slate-300' }
}

const SOURCE_TONE: Record<string, string> = {
  DevOS: 'text-indigo-300',
  'PM Planner': 'text-sky-300',
  'CTO Room': 'text-violet-300',
  'Approval Center': 'text-amber-300',
  'QA Center': 'text-emerald-300',
  'Release Center': 'text-teal-300',
  'DevOps Center': 'text-cyan-300'
}

const STAGE_ICON: Record<string, ReactNode> = {
  pm: <Layers className="h-3.5 w-3.5" />,
  devos: <GitBranch className="h-3.5 w-3.5" />,
  cto: <Gauge className="h-3.5 w-3.5" />,
  approvals: <ShieldCheck className="h-3.5 w-3.5" />,
  qa: <ClipboardCheck className="h-3.5 w-3.5" />,
  release: <Rocket className="h-3.5 w-3.5" />,
  devops: <Server className="h-3.5 w-3.5" />
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

/** Trigger a client-side download of the unified company snapshot as JSON. */
function exportSnapshot(): void {
  const json = liveCompanyService.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'company-snapshot.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Live Company View 2.0 — the unified command center. Reads the aggregated
 * company snapshot (via useLiveCompany) computed from the Development OS, PM
 * Planner, CTO Room, Approval Center, QA Center, Release Center and DevOps
 * Center. All mutations delegate to liveCompanyService — no business logic in
 * the component.
 */
export default function LiveCompanyPage(): JSX.Element {
  const snapshot = useLiveCompany()
  const tone = STATUS_TONE[snapshot.companyStatus] ?? STATUS_TONE.Working

  const handleReset = (): void => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Reset every module (DevOS, PM, CTO, Approval, QA, Release, DevOps) back to its seed?')
    ) {
      return
    }
    liveCompanyService.resetDemoState()
  }

  return (
    <div className="space-y-5">
      {/* Company status header */}
      <Card
        title="Live Company"
        icon={<Radio className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<RefreshCw className="h-4 w-4" />} onClick={() => liveCompanyService.refresh()}>
              Refresh
            </ActionButton>
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportSnapshot}>
              Export snapshot
            </ActionButton>
            <ActionButton variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={handleReset}>
              Reset demo state
            </ActionButton>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={['h-2.5 w-2.5 rounded-full', tone.dot, 'animate-pulse'].join(' ')} />
              <div>
                <div className="text-xs text-slate-500">Company status</div>
                <div className={['text-lg font-semibold', tone.text].join(' ')}>{snapshot.companyStatus}</div>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              Active: {snapshot.activeWorker} · {snapshot.activeDepartment} · updated {formatTimestamp(snapshot.lastUpdated)}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Overall AI Company progress</span>
              <span className={progressTone(snapshot.overallProgress)}>{snapshot.overallProgress}%</span>
            </div>
            <div className="mt-1">
              <ProgressBar value={snapshot.overallProgress} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric icon={<Gauge className="h-4 w-4" />} label="Arch health" value={`${snapshot.metrics.architectureHealth}`} />
            <Metric icon={<AlertTriangle className="h-4 w-4" />} label="Tech debt" value={`${snapshot.metrics.openTechnicalDebt}`} />
            <Metric icon={<ShieldCheck className="h-4 w-4" />} label="Approvals" value={`${snapshot.pendingApprovals}`} />
            <Metric icon={<ClipboardCheck className="h-4 w-4" />} label="QA warnings" value={`${snapshot.qaWarnings}`} />
            <Metric icon={<Rocket className="h-4 w-4" />} label="Release" value={snapshot.releaseStatus} />
            <Metric icon={<Server className="h-4 w-4" />} label="Deployment" value={snapshot.deploymentStatus} />
          </div>
        </div>
      </Card>

      {/* Active work + next recommended action */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Active Work" icon={<Activity className="h-4 w-4" />} className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Tile icon={<Rocket className="h-4 w-4" />} label="Sprint" value={snapshot.currentSprint} />
            <Tile icon={<Layers className="h-4 w-4" />} label="Epic" value={snapshot.currentEpic} />
            <Tile icon={<GitBranch className="h-4 w-4" />} label="Feature" value={snapshot.currentFeature} />
            <Tile icon={<ListTree className="h-4 w-4" />} label="Task" value={snapshot.currentTask} />
          </div>
        </Card>

        <Card title="Next Recommended Action" icon={<ArrowRight className="h-4 w-4" />}>
          <div className="flex h-full flex-col justify-between gap-3">
            <p className="text-sm leading-relaxed text-slate-300">{snapshot.nextRecommendedAction}</p>
            <ActionButton
              icon={<ArrowRight className="h-4 w-4" />}
              variant="primary"
              onClick={() => liveCompanyService.promoteNextRecommendedAction()}
            >
              Promote to DevOS
            </ActionButton>
          </div>
        </Card>
      </div>

      {/* Department timeline */}
      <Card title="Department Timeline" icon={<Building2 className="h-4 w-4" />}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
          {snapshot.departments.map((stage, i) => (
            <div key={stage.key} className="flex items-stretch gap-3 lg:flex-1">
              <StageCard stage={stage} />
              {i < snapshot.departments.length - 1 ? (
                <div className="hidden items-center lg:flex">
                  <ChevronRight className="h-4 w-4 text-slate-700" />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      {/* Bottlenecks */}
      <Card
        title="Current Bottlenecks"
        icon={<AlertTriangle className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{snapshot.bottlenecks.length} open</span>}
      >
        {snapshot.bottlenecks.length === 0 ? (
          <p className="text-sm text-emerald-300/80">No bottlenecks — the company is clear to proceed.</p>
        ) : (
          <ul className="space-y-1">
            {snapshot.bottlenecks.map((b, i) => (
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

      {/* Worker activity grid */}
      <Card
        title="Worker Activity"
        icon={<Users className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{snapshot.workers.length} workers</span>}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {snapshot.workers.map((w) => (
            <WorkerCard key={w.workerId} worker={w} />
          ))}
        </div>
      </Card>

      {/* Activity feed */}
      <Card
        title="Live Activity Feed"
        icon={<Radio className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{snapshot.activity.length} events</span>}
      >
        {snapshot.activity.length === 0 ? (
          <p className="text-sm text-slate-500">
            Quiet. Act in any module (PM, CTO, Approval, QA, Release, DevOps) to see the company move.
          </p>
        ) : (
          <ol className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {snapshot.activity.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}

// --- department stage ------------------------------------------------------

function StageCard({ stage }: { stage: DepartmentStage }): JSX.Element {
  return (
    <div className="flex-1 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-100">
          <span className="text-slate-400">{STAGE_ICON[stage.key]}</span>
          {stage.label}
        </div>
        {stage.blockerCount > 0 ? (
          <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">
            {stage.blockerCount}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 text-[11px] text-slate-500">{stage.status}</div>
      <div className="mt-2">
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span>progress</span>
          <span className={progressTone(stage.progress)}>{stage.progress}%</span>
        </div>
        <div className="mt-1">
          <ProgressBar value={stage.progress} />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-500">
        <User className="h-3 w-3" />
        {stage.owner}
      </div>
      <div className="mt-1 truncate text-[11px] text-slate-600" title={stage.latestEvent}>
        {stage.latestEvent}
      </div>
    </div>
  )
}

// --- worker card -----------------------------------------------------------

function WorkerCard({ worker }: { worker: WorkerMemory }): JSX.Element {
  const busy = worker.currentWork.trim().length > 0
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-100">{worker.name}</div>
          <div className="text-[11px] text-slate-500">
            {worker.role} · {worker.department}
          </div>
        </div>
        <span className={['h-2 w-2 shrink-0 rounded-full', busy ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'].join(' ')} />
      </div>

      <div className="mt-2 flex items-start gap-1.5 text-xs text-slate-300">
        <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-slate-500" />
        <span className="min-w-0">{busy ? worker.currentWork : 'Idle'}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span className="text-emerald-300/80">{worker.completedWork.length} done</span>
        {worker.blockedWork.length > 0 ? <span className="text-rose-300/80">{worker.blockedWork.length} blocked</span> : null}
        <span>conf {worker.confidence}%</span>
      </div>

      {worker.nextWork.length > 0 ? (
        <div className="mt-1 truncate text-[11px] text-slate-600" title={worker.nextWork[0]}>
          Next: {worker.nextWork[0]}
        </div>
      ) : null}
    </div>
  )
}

// --- activity row ----------------------------------------------------------

function ActivityRow({ entry }: { entry: CompanyActivityEntry }): JSX.Element {
  const tone = SOURCE_TONE[entry.source] ?? 'text-slate-300'
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
      <div className="min-w-0">
        <div className={['text-[11px] font-medium', tone].join(' ')}>{entry.source}</div>
        <div className="truncate text-sm text-slate-300">{entry.message}</div>
      </div>
      <span className="shrink-0 text-xs text-slate-600">{formatTimestamp(entry.createdAt)}</span>
    </li>
  )
}

// --- presentational helpers ------------------------------------------------

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-medium text-slate-200">{value}</div>
    </div>
  )
}

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
