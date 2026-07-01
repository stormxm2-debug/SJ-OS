import {
  Users,
  ClipboardList,
  Compass,
  ListChecks,
  Search,
  Code2,
  ShieldCheck,
  GitBranch,
  Rocket,
  AlertTriangle,
  CheckCircle2,
  Loader2
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {
  Meeting,
  MeetingPhase,
  MeetingRole,
  ParticipantOpinion
} from '@shared/kernel'
import { useKernel } from '@renderer/chief-of-staff/useKernel'
import Card from '@renderer/components/ui/Card'
import Chip from '@renderer/components/ui/Chip'

/**
 * The CEO's window into the AI Meeting. Reads the meeting straight from the
 * Kernel snapshot (the single source of truth) — every line shown here was
 * produced by the Meeting Engine, and the decision it reaches drives the plan.
 */

const ROLE_META: Record<MeetingRole, { label: string; icon: LucideIcon }> = {
  chief_of_staff: { label: 'Chief of Staff', icon: ClipboardList },
  cto: { label: 'CTO', icon: Compass },
  project_manager: { label: 'Project Manager', icon: ListChecks },
  research: { label: 'Research', icon: Search },
  developer: { label: 'Developer', icon: Code2 },
  qa: { label: 'QA', icon: ShieldCheck },
  git: { label: 'Git Manager', icon: GitBranch },
  release: { label: 'Release Manager', icon: Rocket }
}

const PHASES: { phase: MeetingPhase; label: string }[] = [
  { phase: 'planning', label: 'Planning' },
  { phase: 'discussion', label: 'Discussion' },
  { phase: 'voting', label: 'Voting' },
  { phase: 'approved', label: 'Approved' }
]

const VOTE_TONE = { approve: 'emerald', revise: 'amber', reject: 'rose' } as const

export default function MeetingView(): JSX.Element | null {
  const kernel = useKernel()
  const meeting = kernel.meetings[kernel.meetings.length - 1]
  if (!meeting) return null
  return (
    <Card
      title="AI Meeting"
      icon={<Users className="h-4 w-4 text-indigo-300" />}
      action={<MeetingStatus phase={meeting.phase} />}
    >
      <PhaseBar phase={meeting.phase} />

      <ul className="mt-4 space-y-3">
        {meeting.opinions.map((op) => (
          <OpinionRow key={op.role} opinion={op} />
        ))}
        {meeting.opinions.length === 0 && (
          <li className="text-sm text-slate-600">Gathering the team…</li>
        )}
      </ul>

      {meeting.decision && <Decision meeting={meeting} />}
    </Card>
  )
}

function MeetingStatus({ phase }: { phase: MeetingPhase }): JSX.Element {
  const running = phase !== 'approved' && phase !== 'failed'
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      {running && <Loader2 className="h-3 w-3 animate-spin" />}
      {PHASES.find((p) => p.phase === phase)?.label ?? phase}
    </span>
  )
}

function PhaseBar({ phase }: { phase: MeetingPhase }): JSX.Element {
  const currentIndex = PHASES.findIndex((p) => p.phase === phase)
  return (
    <div className="flex flex-wrap gap-2">
      {PHASES.map((p, i) => {
        const done = phase === 'approved' || i < currentIndex
        const active = i === currentIndex
        const tone = done
          ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5'
          : active
            ? 'text-indigo-200 border-indigo-500/40 bg-indigo-500/10'
            : 'text-slate-500 border-slate-800'
        return (
          <span
            key={p.phase}
            className={['rounded-lg border px-2.5 py-1 text-xs font-medium', tone].join(' ')}
          >
            {p.label}
          </span>
        )
      })}
    </div>
  )
}

function OpinionRow({ opinion }: { opinion: ParticipantOpinion }): JSX.Element {
  const meta = ROLE_META[opinion.role]
  const Icon = meta.icon
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-sm font-semibold text-slate-100">{meta.label}</span>
        <Chip tone={VOTE_TONE[opinion.vote]}>{opinion.vote}</Chip>
        <span className="ml-auto truncate text-xs text-slate-500">{opinion.decision}</span>
      </div>
      <p className="mt-1 text-sm text-slate-300">{opinion.opinion}</p>
      {opinion.concerns.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {opinion.concerns.map((c) => (
            <span key={c} className="flex items-center gap-1 text-xs text-amber-300/80">
              <AlertTriangle className="h-3 w-3" />
              {c}
            </span>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs text-slate-600">Next: {opinion.nextAction}</p>
    </li>
  )
}

function Decision({ meeting }: { meeting: Meeting }): JSX.Element {
  const d = meeting.decision
  if (!d) return <></>
  return (
    <div className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
        <CheckCircle2 className="h-4 w-4" />
        Consensus reached
      </div>
      <p className="mt-1 text-sm text-slate-300">{d.consensus}</p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Architecture" value={d.architecture} />
        <Field label="Strategy" value={d.strategy} />
      </div>
      {d.risks.length > 0 && (
        <div className="mt-2">
          <div className="text-xs uppercase tracking-wide text-slate-600">Risks</div>
          <ul className="mt-1 space-y-0.5">
            {d.risks.map((r) => (
              <li key={r} className="flex items-start gap-1.5 text-xs text-slate-400">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-600">Engaging:</span>
        {d.requiredCapabilities.map((c) => (
          <Chip key={c} tone="slate">{c}</Chip>
        ))}
        <Chip tone="indigo">priority: {d.priority}</Chip>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-600">{label}</div>
      <p className="mt-0.5 text-sm text-slate-300">{value}</p>
    </div>
  )
}
