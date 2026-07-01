import { useState } from 'react'
import {
  Sparkles,
  Send,
  Crown,
  Cpu,
  CheckCircle2,
  Loader2,
  Circle,
  RotateCcw,
  Info,
  ClipboardList,
  Inbox,
  Tags,
  FolderPlus,
  ListTree,
  ListOrdered,
  UsersRound,
  Users,
  PlayCircle,
  FileText,
  AlertTriangle,
  XCircle
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {
  ChiefOfStaffState,
  CosPhase,
  CosLogActor,
  WorkItem,
  WorkItemState,
  Priority
} from '@shared/chief-of-staff'
import { useChiefOfStaff } from '@renderer/chief-of-staff/useChiefOfStaff'
import CompanyFloor from '@renderer/components/kernel/CompanyFloor'
import ProjectPipeline from '@renderer/components/kernel/ProjectPipeline'
import ProjectWorkspace from '@renderer/components/kernel/ProjectWorkspace'
import EpicView from '@renderer/components/kernel/EpicView'
import DomainArchitecture from '@renderer/components/kernel/DomainArchitecture'
import AssetStore from '@renderer/components/kernel/AssetStore'
import EventStream from '@renderer/components/kernel/EventStream'
import MeetingView from '@renderer/components/kernel/MeetingView'
import Card from '@renderer/components/ui/Card'
import Chip from '@renderer/components/ui/Chip'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { ROLE_LABEL, ROLE_META } from '@renderer/lib/companyMeta'

const EXAMPLES = [
  'Start SJ Insurance Platform',
  'Build SJ Insurance Login',
  'Create an internal expense tracker'
]

/** The Chief of Staff's workflow, phase by phase — its nine actions. */
const STEPS: { phase: CosPhase; label: string; icon: LucideIcon }[] = [
  { phase: 'receiving', label: 'Receive request', icon: Inbox },
  { phase: 'classifying', label: 'Classify & size', icon: Tags },
  { phase: 'meeting', label: 'AI meeting', icon: Users },
  { phase: 'creating_project', label: 'Create project', icon: FolderPlus },
  { phase: 'planning', label: 'Break down work', icon: ListTree },
  { phase: 'queuing', label: 'Build work queue', icon: ListOrdered },
  { phase: 'assigning', label: 'Assign workers', icon: UsersRound },
  { phase: 'executing', label: 'Track progress', icon: PlayCircle },
  { phase: 'reporting', label: 'Report to CEO', icon: FileText }
]

const PHASE_ORDER: CosPhase[] = [
  'idle',
  'receiving',
  'classifying',
  'meeting',
  'creating_project',
  'planning',
  'queuing',
  'assigning',
  'executing',
  'reporting',
  'done'
]

const PHASE_TEXT: Record<CosPhase, string> = {
  idle: 'Idle',
  receiving: 'Receiving your request…',
  classifying: 'Classifying and estimating size…',
  meeting: 'The team is meeting to agree a strategy…',
  creating_project: 'Creating the project…',
  planning: 'Breaking work into epics, features and tasks…',
  queuing: 'Building the work queue…',
  assigning: 'Assigning work to available workers…',
  executing: 'Workers are executing; tracking progress…',
  reporting: 'Compiling your status report…',
  done: 'Delivered',
  failed: 'Stopped'
}

const PRIORITY_TONE: Record<Priority, 'slate' | 'sky' | 'amber' | 'rose'> = {
  low: 'slate',
  medium: 'sky',
  high: 'amber',
  critical: 'rose'
}

const WORK_STATE_META: Record<
  WorkItemState,
  { label: string; text: string }
> = {
  queued: { label: 'Queued', text: 'text-slate-400' },
  assigned: { label: 'Assigned', text: 'text-indigo-300' },
  in_progress: { label: 'In progress', text: 'text-emerald-300' },
  blocked: { label: 'Blocked', text: 'text-amber-300' },
  done: { label: 'Done', text: 'text-sky-300' },
  failed: { label: 'Failed', text: 'text-rose-300' }
}

export default function CommandCenterPage(): JSX.Element {
  const { state, submit, reset } = useChiefOfStaff()
  const [draft, setDraft] = useState('')

  if (state.phase === 'idle') {
    return (
      <Hero
        draft={draft}
        setDraft={setDraft}
        onSubmit={() => {
          submit(draft)
          setDraft('')
        }}
      />
    )
  }

  const busy = !['idle', 'done', 'failed'].includes(state.phase)

  return (
    <div className="space-y-6">
      {/* Header — the request + live phase */}
      <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-300">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-500">
              Chief of Staff · your instruction
            </div>
            <p className="text-sm font-medium text-slate-100">
              “{state.request?.text}”
            </p>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {PHASE_TEXT[state.phase]}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={reset}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
        >
          <RotateCcw className="h-3.5 w-3.5" /> New request
        </button>
      </div>

      <WorkflowStepper phase={state.phase} />

      <ProjectPipeline />

      <ProjectWorkspace />

      <EpicView />

      <DomainArchitecture />

      <AssetStore />

      {state.classification && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-3">
          <span className="text-xs text-slate-500">Classification</span>
          <Chip tone="indigo">{state.classification.type.replace('_', ' ')}</Chip>
          <Chip tone={PRIORITY_TONE[state.classification.priority]}>
            {state.classification.priority} priority
          </Chip>
          <Chip tone="slate">Size {state.classification.size}</Chip>
          <Chip tone="slate">{state.classification.featureCount} feature area(s)</Chip>
        </div>
      )}

      <MeetingView />

      {state.report && <ReportCard state={state} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {state.project && (
            <Card title="Project">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-100">
                  {state.project.name}
                </span>
                {state.progress && (
                  <span className="text-xs tabular-nums text-slate-500">
                    {state.progress.overall}%
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-slate-500">
                {state.project.description}
              </p>
              <div className="mt-2 text-xs text-slate-600">
                Repository:{' '}
                {state.project.repository ?? 'not bound yet (GitHub backend pending)'}
              </div>
              {state.progress && (
                <div className="mt-3">
                  <ProgressBar value={state.progress.overall} />
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>{state.progress.done} done</span>
                    <span>{state.progress.inProgress} in progress</span>
                    <span>{state.progress.queued} queued</span>
                    {state.progress.blocked > 0 && (
                      <span className="text-amber-400">
                        {state.progress.blocked} blocked
                      </span>
                    )}
                    {state.progress.failed > 0 && (
                      <span className="text-rose-400">
                        {state.progress.failed} failed
                      </span>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )}

          {state.breakdown && (
            <Card
              title="Work breakdown"
              action={
                <span className="text-xs text-slate-500">
                  {state.breakdown.featureCount} features · {state.breakdown.taskCount}{' '}
                  tasks · {state.breakdown.subtaskCount} subtasks
                </span>
              }
            >
              <ul className="space-y-2">
                {state.breakdown.epic.features.map((f) => (
                  <li key={f.id} className="text-sm">
                    <span className="font-medium text-slate-200">{f.title}</span>
                    <span className="text-slate-600">
                      {' '}
                      · {f.tasks.length} task(s)
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card
            title="Work queue"
            action={
              <span className="text-xs text-slate-500">
                {state.queue.items.filter((i) => i.state === 'done').length}/
                {state.queue.items.length} done
              </span>
            }
          >
            {state.queue.items.length === 0 ? (
              <p className="text-sm text-slate-600">Building the queue…</p>
            ) : (
              <ul className="space-y-4">
                {state.queue.items.map((item) => (
                  <WorkItemRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title="Action log">
          <ol className="relative space-y-3 pl-6">
            <span className="absolute left-[7px] top-1 h-[calc(100%-0.5rem)] w-px bg-slate-800" />
            {state.log.map((entry) => {
              const meta = logActorMeta(entry.actor)
              const Icon = meta.icon
              return (
                <li key={entry.id} className="relative">
                  <span className="absolute -left-6 top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-slate-700 bg-slate-900">
                    <Icon className="h-2.5 w-2.5 text-slate-400" />
                  </span>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-300">
                      {meta.label}
                    </span>
                    <span className="shrink-0 text-xs text-slate-600">{entry.at}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">{entry.message}</p>
                </li>
              )
            })}
          </ol>
        </Card>
      </div>

      <CompanyFloor />
      <EventStream />
    </div>
  )
}

function WorkflowStepper({ phase }: { phase: CosPhase }): JSX.Element {
  const currentIndex = PHASE_ORDER.indexOf(phase)
  const failed = phase === 'failed'
  return (
    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      {STEPS.map((step) => {
        const stepIndex = PHASE_ORDER.indexOf(step.phase)
        const done = phase === 'done' || currentIndex > stepIndex
        const active = currentIndex === stepIndex && !failed
        const Icon = active ? Loader2 : done ? CheckCircle2 : step.icon
        const tone = done
          ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5'
          : active
            ? 'text-indigo-200 border-indigo-500/40 bg-indigo-500/10'
            : 'text-slate-500 border-slate-800'
        return (
          <div
            key={step.phase}
            className={[
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium',
              tone
            ].join(' ')}
          >
            <Icon className={['h-3.5 w-3.5', active ? 'animate-spin' : ''].join(' ')} />
            {step.label}
          </div>
        )
      })}
    </div>
  )
}

function WorkItemRow({ item }: { item: WorkItem }): JSX.Element {
  const RoleIcon = ROLE_META[item.role].icon
  const meta = WORK_STATE_META[item.state]
  return (
    <li>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-slate-200">
          {item.title}
        </span>
        <span className={['shrink-0 text-xs', meta.text].join(' ')}>
          {meta.label}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
        <RoleIcon className="h-3 w-3" />
        {ROLE_LABEL[item.role]}
        {item.note && <span className="text-slate-600">· {item.note}</span>}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <ProgressBar value={item.progress} />
        <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-500">
          {item.progress}%
        </span>
      </div>
    </li>
  )
}

function ReportCard({ state }: { state: ChiefOfStaffState }): JSX.Element {
  const report = state.report
  if (!report) return <></>
  return (
    <Card
      title="Status report to the CEO"
      icon={<Sparkles className="h-4 w-4 text-indigo-300" />}
      action={<span className="text-xs text-slate-500">{report.progress}% complete</span>}
    >
      <div className="text-base font-semibold text-slate-100">{report.headline}</div>
      <p className="mt-1 text-sm text-slate-400">{report.summary}</p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {report.completed.length > 0 && (
          <ReportList
            title="Completed"
            items={report.completed}
            icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
          />
        )}
        {report.outstanding.length > 0 && (
          <ReportList
            title="Outstanding"
            items={report.outstanding}
            icon={<XCircle className="h-3.5 w-3.5 text-rose-400" />}
          />
        )}
        {report.risks.length > 0 && (
          <ReportList
            title="Risks"
            items={report.risks}
            icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
          />
        )}
        {report.nextActions.length > 0 && (
          <ReportList
            title="Next actions"
            items={report.nextActions}
            icon={<Circle className="h-3.5 w-3.5 text-slate-400" />}
          />
        )}
      </div>
    </Card>
  )
}

function ReportList({
  title,
  items,
  icon
}: {
  title: string
  items: string[]
  icon: JSX.Element
}): JSX.Element {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-600">{title}</div>
      <ul className="mt-1 space-y-1">
        {items.map((it) => (
          <li key={it} className="flex items-start gap-2 text-sm text-slate-300">
            <span className="mt-0.5 shrink-0">{icon}</span>
            {it}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Hero({
  draft,
  setDraft,
  onSubmit
}: {
  draft: string
  setDraft: (v: string) => void
  onSubmit: () => void
}): JSX.Element {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center pt-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600/20 text-indigo-300">
        <ClipboardList className="h-6 w-6" />
      </div>
      <h1 className="mt-5 text-2xl font-semibold text-slate-100">
        Give your Chief of Staff a request
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        One instruction. The Chief of Staff classifies it, creates a project,
        breaks down the work, assigns the team, tracks progress, and reports back.
      </p>

      <div className="mt-6 w-full rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit()
          }}
          rows={3}
          placeholder="Describe what you want done…"
          className="w-full resize-none bg-transparent px-2 py-1 text-sm text-slate-200 outline-none placeholder:text-slate-600"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-slate-600">⌘/Ctrl + Enter to send</span>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!draft.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-4 w-4" /> Send to Chief of Staff
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setDraft(ex)}
            className="rounded-full border border-slate-800 px-3 py-1 text-xs text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200"
          >
            {ex}
          </button>
        ))}
      </div>

      <p className="mt-6 flex items-center gap-1.5 text-xs text-slate-600">
        <Info className="h-3.5 w-3.5" />
        Mock backends — every action is behind a swappable interface, ready for
        Claude Code, OpenAI, GitHub, Playwright, Computer Use and Python workers.
      </p>
    </div>
  )
}

function logActorMeta(actor: CosLogActor): { label: string; icon: LucideIcon } {
  if (actor === 'ceo') return { label: 'CEO', icon: Crown }
  if (actor === 'system') return { label: 'System', icon: Cpu }
  if (actor === 'chief_of_staff') return { label: 'Chief of Staff', icon: ClipboardList }
  return { label: ROLE_LABEL[actor], icon: ROLE_META[actor].icon }
}
