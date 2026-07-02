import { useMemo, useState, type ReactNode } from 'react'
import {
  ShieldCheck,
  Activity,
  Gauge,
  Rocket,
  AlertTriangle,
  Wrench,
  ShieldAlert,
  Lock,
  ListTree,
  Download,
  RotateCcw,
  CheckCheck,
  Plus,
  History,
  GitBranch,
  ClipboardCheck,
  Server,
  Layers,
  KanbanSquare
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useCto } from '@renderer/services/cto/useCto'
import { ctoRepository } from '@renderer/services/cto/CtoRepository'
import { usePm } from '@renderer/services/pm/usePm'
import type {
  CtoLikelihood,
  CtoLogType,
  CtoPriority,
  CtoSeverity,
  CtoSignal,
  ReleaseReadinessLevel
} from '@renderer/services/cto/types'

// --- shared styling maps ---------------------------------------------------

const SEVERITY_STYLES: Record<CtoSeverity, string> = {
  critical: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
  high: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  low: 'border-sky-500/30 bg-sky-500/10 text-sky-300'
}

const PRIORITY_STYLES: Record<CtoPriority, string> = {
  P0: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  P1: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  P2: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  P3: 'border-slate-600/40 bg-slate-700/20 text-slate-300'
}

const SIGNAL_STYLES: Record<CtoSignal, string> = {
  green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  yellow: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  red: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const SIGNAL_LABELS: Record<CtoSignal, string> = {
  green: 'Healthy',
  yellow: 'Watch',
  red: 'At risk'
}

const RELEASE_STYLES: Record<ReleaseReadinessLevel, { label: string; className: string }> = {
  ready: { label: 'Ready', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  at_risk: { label: 'At risk', className: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  not_ready: { label: 'Not ready', className: 'border-rose-500/30 bg-rose-500/10 text-rose-300' }
}

const LOG_STYLES: Record<CtoLogType, { label: string; className: string }> = {
  'debt-added': { label: 'Debt added', className: 'text-amber-300' },
  'debt-resolved': { label: 'Debt resolved', className: 'text-emerald-300' },
  'risk-added': { label: 'Risk added', className: 'text-rose-300' },
  'risk-mitigated': { label: 'Risk mitigated', className: 'text-emerald-300' },
  'decision-blocked': { label: 'Decision blocked', className: 'text-rose-300' },
  'decision-cleared': { label: 'Decision cleared', className: 'text-emerald-300' },
  'priority-promoted': { label: 'Priority promoted', className: 'text-indigo-300' },
  reset: { label: 'Reset', className: 'text-amber-300' }
}

const SEVERITIES: CtoSeverity[] = ['low', 'medium', 'high', 'critical']
const LIKELIHOODS: CtoLikelihood[] = ['low', 'medium', 'high']

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** Colour the architecture health score by band. */
function scoreClass(score: number): string {
  if (score >= 80) return 'text-emerald-300'
  if (score >= 60) return 'text-amber-300'
  return 'text-rose-300'
}

/** Trigger a client-side download of the current CTO Room as JSON. */
function exportReport(): void {
  const json = ctoRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'cto-report.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * CTO Room view. Reads the persisted CTO state from the cto repository (via
 * useCto) and summarises technical health, sprint direction, debt, risks,
 * blocked decisions, next priorities, and QA / DevOps / release readiness. It
 * also summarises the live PM Planner plan (via usePm). All mutations delegate
 * to ctoRepository — no business logic in the component.
 */
export default function CtoRoomPage(): JSX.Element {
  const cto = useCto()
  const pm = usePm()

  const pmSummary = useMemo(
    () => ({
      backlogItems: pm.backlogItems.length,
      activeEpics: pm.epics.filter((e) => e.status === 'in_progress').length,
      openTasks: pm.tasks.filter((t) => t.status !== 'completed').length,
      blockedTasks: pm.tasks.filter((t) => t.status === 'blocked').length,
      completedTasks: pm.tasks.filter((t) => t.status === 'completed').length
    }),
    [pm]
  )

  const openDebt = cto.technicalDebtItems.filter((d) => d.status === 'open').length
  const openRisks = cto.riskItems.filter((r) => r.status === 'open').length
  const openDecisions = cto.blockedDecisions.filter((d) => d.status === 'blocked').length

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('Reset the CTO Room back to the seed?')) {
      return
    }
    ctoRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      {/* Header + executive summary */}
      <Card
        title="CTO Room"
        icon={<ShieldCheck className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
              Export CTO report
            </ActionButton>
            <ActionButton variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={handleReset}>
              Reset demo state
            </ActionButton>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Gauge className="h-4 w-4 text-slate-400" />
                Architecture health
              </div>
              <div className={['mt-1 text-2xl font-semibold', scoreClass(cto.architectureHealth.score)].join(' ')}>
                {cto.architectureHealth.score}
                <span className="text-sm text-slate-500">/100</span>
              </div>
            </div>
            <StatTile icon={<Wrench className="h-4 w-4" />} label="Open debt" value={openDebt} />
            <StatTile icon={<ShieldAlert className="h-4 w-4" />} label="Open risks" value={openRisks} />
            <StatTile icon={<Lock className="h-4 w-4" />} label="Blocked decisions" value={openDecisions} />
          </div>

          <div>
            <SectionLabel>Executive technical summary</SectionLabel>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">{cto.architectureHealth.summary}</p>
          </div>

          <div className="text-xs text-slate-500">Last CTO review: {formatTimestamp(cto.lastReviewAt)}</div>
        </div>
      </Card>

      {/* Current sprint + active work */}
      <Card title="Current Sprint" icon={<Activity className="h-4 w-4" />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile icon={<Rocket className="h-4 w-4" />} label="Sprint" value={cto.currentSprint} />
          <StatTile icon={<Layers className="h-4 w-4" />} label="Active epic" value={cto.activeEpic} />
          <StatTile icon={<GitBranch className="h-4 w-4" />} label="Active feature" value={cto.activeFeature} />
          <StatTile icon={<ListTree className="h-4 w-4" />} label="Active task" value={cto.activeTask} />
        </div>
      </Card>

      {/* Architecture health detail */}
      <Card title="Architecture Health" icon={<Gauge className="h-4 w-4" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <SectionLabel>Strengths</SectionLabel>
            <BulletList items={cto.architectureHealth.strengths} tone="good" />
          </div>
          <div>
            <SectionLabel>Concerns</SectionLabel>
            <BulletList items={cto.architectureHealth.concerns} tone="warn" />
          </div>
        </div>
      </Card>

      {/* QA / DevOps / Release readiness */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="QA Status" icon={<ClipboardCheck className="h-4 w-4" />}>
          <div className="space-y-3">
            <SignalBadge signal={cto.qaStatus.signal} />
            <p className="text-sm text-slate-300">{cto.qaStatus.summary}</p>
            <div className="flex flex-wrap gap-4 text-xs text-slate-500">
              <span>
                Checks: {cto.qaStatus.passingChecks}/{cto.qaStatus.totalChecks} passing
              </span>
              <span>Open issues: {cto.qaStatus.openIssues}</span>
            </div>
          </div>
        </Card>

        <Card title="DevOps Status" icon={<Server className="h-4 w-4" />}>
          <div className="space-y-3">
            <SignalBadge signal={cto.devOpsStatus.signal} />
            <p className="text-sm text-slate-300">{cto.devOpsStatus.summary}</p>
            <div className="space-y-1 text-xs text-slate-500">
              <div>Typecheck: {cto.devOpsStatus.typecheckPassing ? 'passing' : 'failing'}</div>
              <div>Build: {cto.devOpsStatus.buildPassing ? 'passing' : 'failing'}</div>
              <div>Pipeline: {cto.devOpsStatus.pipeline}</div>
              <div>Last deploy: {cto.devOpsStatus.lastDeploy}</div>
            </div>
          </div>
        </Card>

        <Card title="Release Readiness" icon={<Rocket className="h-4 w-4" />}>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ReleaseBadge level={cto.releaseReadiness.level} />
              <span className="text-xs text-slate-500">{cto.releaseReadiness.score}/100</span>
            </div>
            <p className="text-sm text-slate-300">{cto.releaseReadiness.summary}</p>
            <ul className="space-y-1">
              {cto.releaseReadiness.checklist.map((c, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span
                    className={[
                      'inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px]',
                      c.done
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-slate-700 bg-slate-800/40 text-slate-600'
                    ].join(' ')}
                  >
                    {c.done ? '✓' : ''}
                  </span>
                  <span className={c.done ? 'text-slate-400' : 'text-slate-300'}>{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      {/* PM Planner summary */}
      <Card
        title="PM Planner Summary"
        icon={<KanbanSquare className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">Live from the PM Planner</span>}
      >
        <div className="grid gap-3 sm:grid-cols-5">
          <StatTile icon={<ClipboardCheck className="h-4 w-4" />} label="Backlog items" value={pmSummary.backlogItems} />
          <StatTile icon={<Layers className="h-4 w-4" />} label="Active epics" value={pmSummary.activeEpics} />
          <StatTile icon={<ListTree className="h-4 w-4" />} label="Open tasks" value={pmSummary.openTasks} />
          <StatTile icon={<AlertTriangle className="h-4 w-4" />} label="Blocked tasks" value={pmSummary.blockedTasks} />
          <StatTile icon={<CheckCheck className="h-4 w-4" />} label="Completed tasks" value={pmSummary.completedTasks} />
        </div>
      </Card>

      {/* Next priorities */}
      <Card
        title="Next CTO Priorities"
        icon={<Rocket className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{cto.nextPriorities.length} queued</span>}
      >
        {cto.nextPriorities.length === 0 ? (
          <p className="text-sm text-slate-500">No priorities queued. Promote work from the PM Planner or add one.</p>
        ) : (
          <div className="space-y-3">
            {cto.nextPriorities.map((p) => (
              <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <PriorityBadge priority={p.priority} />
                    <span className="text-sm font-medium text-slate-100">{p.title}</span>
                  </div>
                  <ActionButton
                    icon={<Rocket className="h-4 w-4" />}
                    variant="primary"
                    onClick={() => ctoRepository.promoteNextPriority(p.id)}
                  >
                    Promote to active
                  </ActionButton>
                </div>
                <p className="mt-2 text-sm text-slate-400">{p.rationale}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>Epic: {p.epic}</span>
                  <span>Feature: {p.feature}</span>
                  <span>Task: {p.task}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Technical debt */}
      <Card
        title="Technical Debt"
        icon={<Wrench className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{openDebt} open</span>}
      >
        <div className="space-y-3">
          <AddDebtForm />
          {cto.technicalDebtItems.length === 0 ? (
            <p className="text-sm text-slate-500">No technical debt tracked.</p>
          ) : (
            cto.technicalDebtItems.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Wrench className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span
                    className={[
                      'truncate text-sm',
                      item.status === 'resolved' ? 'text-slate-500 line-through' : 'text-slate-200'
                    ].join(' ')}
                  >
                    {item.title}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip>{item.area}</Chip>
                  <SeverityBadge severity={item.severity} />
                  {item.status === 'resolved' ? (
                    <Chip tone="good">Resolved</Chip>
                  ) : (
                    <MiniButton
                      icon={<CheckCheck className="h-3 w-3" />}
                      onClick={() => ctoRepository.resolveTechnicalDebt(item.id)}
                    >
                      Resolve
                    </MiniButton>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Risks */}
      <Card
        title="Technical Risks"
        icon={<ShieldAlert className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{openRisks} open</span>}
      >
        <div className="space-y-3">
          <AddRiskForm />
          {cto.riskItems.length === 0 ? (
            <p className="text-sm text-slate-500">No risks tracked.</p>
          ) : (
            cto.riskItems.map((risk) => (
              <div key={risk.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span
                      className={[
                        'text-sm',
                        risk.status === 'mitigated' ? 'text-slate-500 line-through' : 'text-slate-200'
                      ].join(' ')}
                    >
                      {risk.title}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip>{risk.area}</Chip>
                    <SeverityBadge severity={risk.severity} />
                    <Chip>Likelihood: {risk.likelihood}</Chip>
                    {risk.status === 'mitigated' ? (
                      <Chip tone="good">Mitigated</Chip>
                    ) : (
                      <MiniButton
                        icon={<CheckCheck className="h-3 w-3" />}
                        onClick={() => ctoRepository.mitigateRisk(risk.id)}
                      >
                        Mitigate
                      </MiniButton>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  <span className="text-slate-500">Mitigation: </span>
                  {risk.mitigation}
                </p>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Blocked decisions */}
      <Card
        title="Blocked Decisions"
        icon={<Lock className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{openDecisions} awaiting</span>}
      >
        <div className="space-y-3">
          <AddDecisionForm />
          {cto.blockedDecisions.length === 0 ? (
            <p className="text-sm text-slate-500">No blocked decisions.</p>
          ) : (
            cto.blockedDecisions.map((decision) => (
              <div key={decision.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Lock className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span
                      className={[
                        'text-sm',
                        decision.status === 'cleared' ? 'text-slate-500 line-through' : 'text-slate-200'
                      ].join(' ')}
                    >
                      {decision.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Chip>Owner: {decision.owner}</Chip>
                    {decision.status === 'cleared' ? (
                      <Chip tone="good">Cleared</Chip>
                    ) : (
                      <MiniButton
                        icon={<CheckCheck className="h-3 w-3" />}
                        onClick={() => ctoRepository.clearBlockedDecision(decision.id)}
                      >
                        Clear
                      </MiniButton>
                    )}
                  </div>
                </div>
                {decision.context ? <p className="mt-2 text-xs text-slate-400">{decision.context}</p> : null}
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Event log */}
      <Card
        title="CTO Room Event Log"
        icon={<History className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{cto.eventLog.length} events</span>}
      >
        {cto.eventLog.length === 0 ? (
          <p className="text-sm text-slate-500">No events yet. Use the CTO actions to record activity.</p>
        ) : (
          <ol className="space-y-2">
            {cto.eventLog.map((entry) => {
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

// --- action forms ----------------------------------------------------------

function AddDebtForm(): JSX.Element {
  const [title, setTitle] = useState('')
  const [area, setArea] = useState('')
  const [severity, setSeverity] = useState<CtoSeverity>('medium')

  const submit = (): void => {
    if (ctoRepository.addTechnicalDebt({ title, area, severity }).success) {
      setTitle('')
      setArea('')
      setSeverity('medium')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-800 bg-slate-950/30 p-2.5">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Add technical debt…"
        className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
      />
      <input
        type="text"
        value={area}
        onChange={(e) => setArea(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Area"
        className="w-28 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
      />
      <SeveritySelect value={severity} onChange={setSeverity} />
      <MiniButton icon={<Plus className="h-3 w-3" />} onClick={submit}>
        Add
      </MiniButton>
    </div>
  )
}

function AddRiskForm(): JSX.Element {
  const [title, setTitle] = useState('')
  const [area, setArea] = useState('')
  const [severity, setSeverity] = useState<CtoSeverity>('medium')
  const [likelihood, setLikelihood] = useState<CtoLikelihood>('medium')
  const [mitigation, setMitigation] = useState('')

  const submit = (): void => {
    if (ctoRepository.addRisk({ title, area, severity, likelihood, mitigation }).success) {
      setTitle('')
      setArea('')
      setSeverity('medium')
      setLikelihood('medium')
      setMitigation('')
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-slate-800 bg-slate-950/30 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add risk…"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
        <input
          type="text"
          value={area}
          onChange={(e) => setArea(e.target.value)}
          placeholder="Area"
          className="w-28 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
        <SeveritySelect value={severity} onChange={setSeverity} />
        <LikelihoodSelect value={likelihood} onChange={setLikelihood} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={mitigation}
          onChange={(e) => setMitigation(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Mitigation (optional)"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
        <MiniButton icon={<Plus className="h-3 w-3" />} onClick={submit}>
          Add risk
        </MiniButton>
      </div>
    </div>
  )
}

function AddDecisionForm(): JSX.Element {
  const [title, setTitle] = useState('')
  const [owner, setOwner] = useState('CEO')
  const [context, setContext] = useState('')

  const submit = (): void => {
    if (ctoRepository.addBlockedDecision({ title, owner, context }).success) {
      setTitle('')
      setOwner('CEO')
      setContext('')
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-slate-800 bg-slate-950/30 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add blocked decision…"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
        <input
          type="text"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="Owner"
          className="w-24 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Context (optional)"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
        <MiniButton icon={<Plus className="h-3 w-3" />} onClick={submit}>
          Add decision
        </MiniButton>
      </div>
    </div>
  )
}

// --- presentational helpers ------------------------------------------------

function SeveritySelect({
  value,
  onChange
}: {
  value: CtoSeverity
  onChange: (value: CtoSeverity) => void
}): JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CtoSeverity)}
      className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 focus:border-indigo-500/50 focus:outline-none"
    >
      {SEVERITIES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}

function LikelihoodSelect({
  value,
  onChange
}: {
  value: CtoLikelihood
  onChange: (value: CtoLikelihood) => void
}): JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CtoLikelihood)}
      className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 focus:border-indigo-500/50 focus:outline-none"
    >
      {LIKELIHOODS.map((l) => (
        <option key={l} value={l}>
          likelihood: {l}
        </option>
      ))}
    </select>
  )
}

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }): JSX.Element {
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

function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{children}</div>
  )
}

function BulletList({ items, tone }: { items: string[]; tone: 'good' | 'warn' }): JSX.Element {
  const marker = tone === 'good' ? 'marker:text-emerald-500/60' : 'marker:text-amber-500/60'
  if (items.length === 0) return <div className="ml-4 mt-1 text-xs text-slate-600">—</div>
  return (
    <ul className={['ml-4 mt-1 list-disc space-y-0.5 text-xs text-slate-400', marker].join(' ')}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

function SeverityBadge({ severity }: { severity: CtoSeverity }): JSX.Element {
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', SEVERITY_STYLES[severity]].join(' ')}>
      {severity}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: CtoPriority }): JSX.Element {
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', PRIORITY_STYLES[priority]].join(' ')}>
      {priority}
    </span>
  )
}

function SignalBadge({ signal }: { signal: CtoSignal }): JSX.Element {
  return (
    <span className={['inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', SIGNAL_STYLES[signal]].join(' ')}>
      {SIGNAL_LABELS[signal]}
    </span>
  )
}

function ReleaseBadge({ level }: { level: ReleaseReadinessLevel }): JSX.Element {
  const meta = RELEASE_STYLES[level]
  return (
    <span className={['inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.className].join(' ')}>
      {meta.label}
    </span>
  )
}

function Chip({ children, tone }: { children: ReactNode; tone?: 'good' }): JSX.Element {
  const className =
    tone === 'good'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : 'border-slate-700 bg-slate-800/40 text-slate-400'
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', className].join(' ')}>{children}</span>
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

function MiniButton({ children, onClick, icon }: { children: ReactNode; onClick: () => void; icon?: ReactNode }): JSX.Element {
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
