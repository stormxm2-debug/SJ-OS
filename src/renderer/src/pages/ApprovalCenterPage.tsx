import { useMemo, useState, type ReactNode } from 'react'
import {
  ShieldCheck,
  Check,
  X,
  Clock,
  Timer,
  Download,
  RotateCcw,
  Plus,
  History,
  MessageSquarePlus,
  Eraser,
  DownloadCloud,
  Layers,
  GitBranch,
  ListTree,
  User
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useApprovals } from '@renderer/services/approvals/useApprovals'
import { approvalRepository } from '@renderer/services/approvals/ApprovalRepository'
import type {
  ApprovalCategory,
  ApprovalItem,
  ApprovalLogType,
  ApprovalPriority,
  ApprovalRiskLevel,
  ApprovalStatus
} from '@renderer/services/approvals/types'

// --- styling maps ----------------------------------------------------------

const STATUS_STYLES: Record<ApprovalStatus, string> = {
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  rejected: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  deferred: 'border-sky-500/30 bg-sky-500/10 text-sky-300'
}

const STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  deferred: 'Deferred'
}

const PRIORITY_STYLES: Record<ApprovalPriority, string> = {
  P0: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  P1: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  P2: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  P3: 'border-slate-600/40 bg-slate-700/20 text-slate-300'
}

const RISK_STYLES: Record<ApprovalRiskLevel, string> = {
  low: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  high: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  critical: 'border-rose-500/40 bg-rose-500/15 text-rose-200'
}

const LOG_STYLES: Record<ApprovalLogType, { label: string; className: string }> = {
  created: { label: 'Created', className: 'text-slate-300' },
  approved: { label: 'Approved', className: 'text-emerald-300' },
  rejected: { label: 'Rejected', className: 'text-rose-300' },
  deferred: { label: 'Deferred', className: 'text-sky-300' },
  'reason-added': { label: 'Reason added', className: 'text-indigo-300' },
  'reason-cleared': { label: 'Reason cleared', className: 'text-amber-300' },
  imported: { label: 'Imported', className: 'text-indigo-300' },
  reset: { label: 'Reset', className: 'text-amber-300' }
}

const CATEGORIES: ApprovalCategory[] = [
  'architecture',
  'product',
  'release',
  'customer-data',
  'finance',
  'insurance-analysis',
  'automation',
  'legal-risk',
  'external-api',
  'destructive-operation'
]

const PRIORITIES: ApprovalPriority[] = ['P0', 'P1', 'P2', 'P3']
const RISKS: ApprovalRiskLevel[] = ['low', 'medium', 'high', 'critical']

const STATUS_ORDER: ApprovalStatus[] = ['pending', 'approved', 'rejected', 'deferred']
const STATUS_SECTION_ICON: Record<ApprovalStatus, ReactNode> = {
  pending: <Clock className="h-4 w-4" />,
  approved: <Check className="h-4 w-4" />,
  rejected: <X className="h-4 w-4" />,
  deferred: <Timer className="h-4 w-4" />
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** Trigger a client-side download of the current Approval Center as JSON. */
function exportReport(): void {
  const json = approvalRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'approval-report.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Approval Center view. Reads the persisted approval queue from the approvals
 * repository (via useApprovals) and groups it by status: pending, approved,
 * rejected, deferred. All mutations delegate to approvalRepository — no business
 * logic in the component. CTO Room blocked decisions can be imported as pending
 * requests; deciding an item drives the DevOS event log via the repository.
 */
export default function ApprovalCenterPage(): JSX.Element {
  const snapshot = useApprovals()

  const grouped = useMemo(() => {
    const map: Record<ApprovalStatus, ApprovalItem[]> = {
      pending: [],
      approved: [],
      rejected: [],
      deferred: []
    }
    for (const item of snapshot.approvals) map[item.status].push(item)
    return map
  }, [snapshot])

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('Reset the Approval Center back to the seed?')) {
      return
    }
    approvalRepository.resetDemoState()
  }

  const handleImport = (): void => {
    const result = approvalRepository.importFromCtoRoom()
    if (typeof window !== 'undefined') {
      const n = result.data?.imported ?? 0
      window.alert(n === 0 ? 'No new CTO blocked decisions to import.' : `Imported ${n} CTO decision(s).`)
    }
  }

  return (
    <div className="space-y-5">
      <Card
        title="Approval Center"
        icon={<ShieldCheck className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<DownloadCloud className="h-4 w-4" />} onClick={handleImport}>
              Import CTO decisions
            </ActionButton>
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
              Export report JSON
            </ActionButton>
            <ActionButton variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={handleReset}>
              Reset demo state
            </ActionButton>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-4">
          {STATUS_ORDER.map((status) => (
            <StatTile
              key={status}
              icon={STATUS_SECTION_ICON[status]}
              label={STATUS_LABELS[status]}
              value={grouped[status].length}
            />
          ))}
        </div>
      </Card>

      <NewApprovalForm />

      {STATUS_ORDER.map((status) => (
        <Card
          key={status}
          title={`${STATUS_LABELS[status]} approvals`}
          icon={STATUS_SECTION_ICON[status]}
          action={<span className="text-xs text-slate-500">{grouped[status].length} items</span>}
        >
          {grouped[status].length === 0 ? (
            <p className="text-sm text-slate-500">Nothing {STATUS_LABELS[status].toLowerCase()}.</p>
          ) : (
            <div className="space-y-3">
              {grouped[status].map((item) => (
                <ApprovalCard key={item.approvalId} item={item} />
              ))}
            </div>
          )}
        </Card>
      ))}

      <Card
        title="Decision History"
        icon={<History className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{snapshot.eventLog.length} events</span>}
      >
        {snapshot.eventLog.length === 0 ? (
          <p className="text-sm text-slate-500">No decisions yet. Approve, reject or defer an item to record history.</p>
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

// --- approval card ---------------------------------------------------------

function ApprovalCard({ item }: { item: ApprovalItem }): JSX.Element {
  const [reasonDraft, setReasonDraft] = useState('')

  const submitReason = (): void => {
    if (approvalRepository.addDecisionReason(item.approvalId, reasonDraft).success) {
      setReasonDraft('')
    }
  }

  const related = [
    item.relatedEpic ? { icon: <Layers className="h-3 w-3" />, label: item.relatedEpic } : null,
    item.relatedFeature ? { icon: <GitBranch className="h-3 w-3" />, label: item.relatedFeature } : null,
    item.relatedTask ? { icon: <ListTree className="h-3 w-3" />, label: item.relatedTask } : null
  ].filter(Boolean) as Array<{ icon: ReactNode; label: string }>

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">{item.title}</span>
            <StatusBadge status={item.status} />
            <PriorityBadge priority={item.priority} />
            <RiskBadge risk={item.riskLevel} />
            <Chip>{item.category}</Chip>
          </div>
          {item.description ? <p className="mt-1 text-sm text-slate-400">{item.description}</p> : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <User className="h-3 w-3" />
          {item.requestedByRole} · {item.source}
        </span>
        <span>Created: {formatTimestamp(item.createdAt)}</span>
        {item.decidedAt ? <span>Decided: {formatTimestamp(item.decidedAt)}</span> : null}
      </div>

      {item.impactSummary ? (
        <p className="mt-2 text-xs text-slate-400">
          <span className="text-slate-500">Impact: </span>
          {item.impactSummary}
        </p>
      ) : null}

      {related.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {related.map((r, i) => (
            <span key={i} className="flex items-center gap-1 rounded-md border border-slate-800 bg-slate-950/40 px-2 py-0.5">
              {r.icon}
              {r.label}
            </span>
          ))}
        </div>
      ) : null}

      {/* Decision reason */}
      {item.decisionReason ? (
        <div className="mt-2 flex items-start justify-between gap-2 rounded-md border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1.5 text-xs text-indigo-200">
          <span>
            <span className="text-indigo-300/70">Reason: </span>
            {item.decisionReason}
          </span>
          <button
            type="button"
            onClick={() => approvalRepository.clearDecisionReason(item.approvalId)}
            className="shrink-0 text-indigo-300/70 transition hover:text-indigo-200"
            aria-label="Clear decision reason"
          >
            <Eraser className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="mt-2 flex gap-1.5">
          <input
            type="text"
            value={reasonDraft}
            onChange={(e) => setReasonDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitReason()}
            placeholder="Add a decision reason…"
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={submitReason}
            className="inline-flex items-center rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300 transition hover:bg-slate-700/60"
            aria-label="Add decision reason"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Decision actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <MiniButton
          icon={<Check className="h-3 w-3" />}
          variant="primary"
          onClick={() => approvalRepository.approve(item.approvalId)}
          disabled={item.status === 'approved'}
        >
          Approve
        </MiniButton>
        <MiniButton
          icon={<X className="h-3 w-3" />}
          variant="danger"
          onClick={() => approvalRepository.reject(item.approvalId)}
          disabled={item.status === 'rejected'}
        >
          Reject
        </MiniButton>
        <MiniButton
          icon={<Timer className="h-3 w-3" />}
          onClick={() => approvalRepository.defer(item.approvalId)}
          disabled={item.status === 'deferred'}
        >
          Defer
        </MiniButton>
      </div>
    </div>
  )
}

// --- new approval form -----------------------------------------------------

function NewApprovalForm(): JSX.Element {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<ApprovalCategory>('product')
  const [priority, setPriority] = useState<ApprovalPriority>('P2')
  const [riskLevel, setRiskLevel] = useState<ApprovalRiskLevel>('medium')
  const [impactSummary, setImpactSummary] = useState('')

  const submit = (): void => {
    if (
      approvalRepository.createApproval({
        title,
        description,
        category,
        priority,
        riskLevel,
        impactSummary,
        source: 'Manual',
        requestedByRole: 'CEO'
      }).success
    ) {
      setTitle('')
      setDescription('')
      setCategory('product')
      setPriority('P2')
      setRiskLevel('medium')
      setImpactSummary('')
    }
  }

  return (
    <Card title="New Approval Request" icon={<Plus className="h-4 w-4" />}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Approval title…"
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
          />
          <Select value={category} onChange={(v) => setCategory(v as ApprovalCategory)} options={CATEGORIES} />
          <Select value={priority} onChange={(v) => setPriority(v as ApprovalPriority)} options={PRIORITIES} />
          <Select
            value={riskLevel}
            onChange={(v) => setRiskLevel(v as ApprovalRiskLevel)}
            options={RISKS}
            prefix="risk: "
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
          />
          <input
            type="text"
            value={impactSummary}
            onChange={(e) => setImpactSummary(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Impact summary (optional)"
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
          />
          <ActionButton icon={<Plus className="h-4 w-4" />} variant="primary" onClick={submit}>
            Create request
          </ActionButton>
        </div>
      </div>
    </Card>
  )
}

// --- presentational helpers ------------------------------------------------

function Select({
  value,
  onChange,
  options,
  prefix
}: {
  value: string
  onChange: (value: string) => void
  options: readonly string[]
  prefix?: string
}): JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200 focus:border-indigo-500/50 focus:outline-none"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {prefix ?? ''}
          {o}
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
      <div className="mt-1 text-lg font-semibold text-slate-200">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: ApprovalStatus }): JSX.Element {
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_STYLES[status]].join(' ')}>
      {STATUS_LABELS[status]}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: ApprovalPriority }): JSX.Element {
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', PRIORITY_STYLES[priority]].join(' ')}>
      {priority}
    </span>
  )
}

function RiskBadge({ risk }: { risk: ApprovalRiskLevel }): JSX.Element {
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', RISK_STYLES[risk]].join(' ')}>
      {risk} risk
    </span>
  )
}

function Chip({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span className="rounded-full border border-slate-700 bg-slate-800/40 px-2 py-0.5 text-[11px] font-medium text-slate-400">
      {children}
    </span>
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
  icon,
  variant = 'default',
  disabled = false
}: {
  children: ReactNode
  onClick: () => void
  icon?: ReactNode
  variant?: ButtonVariant
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        BUTTON_VARIANTS[variant]
      ].join(' ')}
    >
      {icon}
      {children}
    </button>
  )
}
