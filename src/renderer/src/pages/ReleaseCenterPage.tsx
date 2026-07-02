import { useState, type ReactNode } from 'react'
import {
  Rocket,
  Package,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  ClipboardCheck,
  Boxes,
  Truck,
  Download,
  RotateCcw,
  Plus,
  History,
  Layers,
  Ban,
  CheckCheck,
  Eraser,
  Send,
  FileText,
  Clock,
  User,
  Activity
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useRelease } from '@renderer/services/release/useRelease'
import { releaseRepository } from '@renderer/services/release/ReleaseRepository'
import type {
  ReleaseApprovalStatus,
  ReleaseDeploymentStatus,
  ReleaseGateStatus,
  ReleaseItem,
  ReleaseLogType,
  ReleaseStatus,
  ReleaseType
} from '@renderer/services/release/types'

// --- styling maps ----------------------------------------------------------

const STATUS_STYLES: Record<ReleaseStatus, string> = {
  draft: 'border-slate-600/40 bg-slate-700/20 text-slate-300',
  'qa-review': 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  'approval-required': 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  released: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  blocked: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
  cancelled: 'border-slate-600/40 bg-slate-800/40 text-slate-400'
}

const STATUS_LABELS: Record<ReleaseStatus, string> = {
  draft: 'Draft',
  'qa-review': 'QA review',
  'approval-required': 'Approval required',
  ready: 'Ready',
  released: 'Released',
  blocked: 'Blocked',
  cancelled: 'Cancelled'
}

const GATE_STYLES: Record<ReleaseGateStatus, string> = {
  pending: 'border-slate-600/40 bg-slate-700/20 text-slate-300',
  passed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  failed: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300'
}

const APPROVAL_STYLES: Record<ReleaseApprovalStatus, string> = {
  'not-required': 'border-slate-600/40 bg-slate-700/20 text-slate-300',
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  rejected: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const DEPLOYMENT_STYLES: Record<ReleaseDeploymentStatus, string> = {
  pending: 'border-slate-600/40 bg-slate-700/20 text-slate-300',
  'in-progress': 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  deployed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  failed: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const LOG_STYLES: Record<ReleaseLogType, { label: string; className: string }> = {
  'release-created': { label: 'Created', className: 'text-slate-300' },
  'qa-reviewed': { label: 'QA reviewed', className: 'text-indigo-300' },
  'approval-requested': { label: 'Approval requested', className: 'text-amber-300' },
  'approval-received': { label: 'Approval received', className: 'text-emerald-300' },
  'blocker-added': { label: 'Blocker added', className: 'text-rose-300' },
  'blocker-cleared': { label: 'Blocker cleared', className: 'text-emerald-300' },
  'marked-ready': { label: 'Marked ready', className: 'text-emerald-300' },
  released: { label: 'Released', className: 'text-emerald-300' },
  cancelled: { label: 'Cancelled', className: 'text-slate-400' },
  reset: { label: 'Reset', className: 'text-amber-300' }
}

const RELEASE_TYPES: ReleaseType[] = ['internal', 'demo', 'beta', 'production', 'hotfix']

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** Trigger a client-side download of the current Release Center as JSON. */
function exportReport(): void {
  const json = releaseRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'release-report.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Release Center view. Reads the persisted release state from the release
 * repository (via useRelease) and shows the current candidate in detail (gates,
 * features, checklist, blockers, warnings, notes) plus the release history and a
 * live QA summary. All mutations delegate to releaseRepository — no business
 * logic in the component.
 */
export default function ReleaseCenterPage(): JSX.Element {
  const snapshot = useRelease()
  const current = snapshot.releases[0] ?? null
  const qa = releaseRepository.getLatestQaSummary()

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('Reset the Release Center back to the seed?')) {
      return
    }
    releaseRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      <Card
        title="Release Center"
        icon={<Rocket className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
              Export release report
            </ActionButton>
            <ActionButton variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={handleReset}>
              Reset demo state
            </ActionButton>
          </div>
        }
      >
        {current ? <CurrentReleasePanel release={current} /> : <p className="text-sm text-slate-500">No release candidate yet. Create one below.</p>}
      </Card>

      {/* Live QA summary from the QA Center */}
      <Card title="Latest QA Summary" icon={<ClipboardCheck className="h-4 w-4" />} action={<span className="text-xs text-slate-500">from QA Center</span>}>
        {qa ? (
          <div className="space-y-3">
            <div className="text-sm text-slate-300">{qa.title}</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <GateTile label="Typecheck" status={qa.typecheckStatus} />
              <GateTile label="Build" status={qa.buildStatus} />
              <GateTile label="Regression" status={qa.regressionStatus} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <SectionLabel>Release blockers ({qa.releaseBlockers.length})</SectionLabel>
                <PlainList items={qa.releaseBlockers} tone="bad" empty="None" />
              </div>
              <div>
                <SectionLabel>Warnings ({qa.warnings.length})</SectionLabel>
                <PlainList items={qa.warnings} tone="warn" empty="None" />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No QA run available to summarise.</p>
        )}
      </Card>

      <NewReleaseForm />

      <Card
        title="Release History"
        icon={<History className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{snapshot.releases.length} releases</span>}
      >
        {snapshot.releases.length === 0 ? (
          <p className="text-sm text-slate-500">No releases recorded.</p>
        ) : (
          <div className="space-y-2">
            {snapshot.releases.map((r) => (
              <HistoryRow key={r.releaseId} release={r} highlight={current?.releaseId === r.releaseId} />
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Release Event Log"
        icon={<Activity className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{snapshot.eventLog.length} events</span>}
      >
        {snapshot.eventLog.length === 0 ? (
          <p className="text-sm text-slate-500">No events yet. Use the release actions to record activity.</p>
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

// --- current release -------------------------------------------------------

function CurrentReleasePanel({ release }: { release: ReleaseItem }): JSX.Element {
  const [blockerDraft, setBlockerDraft] = useState('')
  const id = release.releaseId

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">
              {release.title} <span className="text-slate-400">{release.version}</span>
            </span>
            <StatusBadge status={release.status} />
            <Chip>{release.releaseType}</Chip>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {release.ownerWorkerId}
            </span>
            {release.relatedSprint ? <span>Sprint: {release.relatedSprint}</span> : null}
            {release.relatedEpic ? (
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                {release.relatedEpic}
              </span>
            ) : null}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Created {formatTimestamp(release.createdAt)}
            </span>
            {release.releasedAt ? <span>Released {formatTimestamp(release.releasedAt)}</span> : null}
          </div>
        </div>
      </div>

      {/* gates */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <GateTile icon={<Boxes className="h-4 w-4" />} label="Build" status={release.buildStatus} />
        <GateTile icon={<ClipboardCheck className="h-4 w-4" />} label="QA" status={release.qaStatus} />
        <GateTile icon={<ShieldCheck className="h-4 w-4" />} label="Approval" status={release.approvalStatus} styleMap={APPROVAL_STYLES} />
        <GateTile icon={<Truck className="h-4 w-4" />} label="Deployment" status={release.deploymentStatus} styleMap={DEPLOYMENT_STYLES} />
      </div>

      {/* included features */}
      <div>
        <SectionLabel>Included features ({release.relatedFeatures.length})</SectionLabel>
        {release.relatedFeatures.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">None listed.</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {release.relatedFeatures.map((f, i) => (
              <span key={i} className="flex items-center gap-1 rounded-md border border-slate-800 bg-slate-950/40 px-2 py-0.5 text-xs text-slate-300">
                <Package className="h-3 w-3 text-slate-500" />
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* checklist */}
      <div>
        <SectionLabel>Release checklist</SectionLabel>
        <ul className="mt-1 space-y-1">
          {release.checklist.map((c, i) => (
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

      {/* blockers */}
      <div>
        <SectionLabel>Blockers ({release.blockers.length})</SectionLabel>
        {release.blockers.length === 0 ? (
          <p className="mt-1 text-xs text-emerald-300/80">No blockers.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {release.blockers.map((b, i) => (
              <li
                key={i}
                className="flex items-start justify-between gap-2 rounded-md border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-200"
              >
                <span className="flex items-start gap-1.5">
                  <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {b}
                </span>
                <button
                  type="button"
                  onClick={() => releaseRepository.clearBlocker(id, b)}
                  className="shrink-0 text-rose-300/70 transition hover:text-rose-200"
                  aria-label="Clear blocker"
                >
                  <Eraser className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <input
            type="text"
            value={blockerDraft}
            onChange={(e) => setBlockerDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && releaseRepository.addBlocker(id, blockerDraft).success) setBlockerDraft('')
            }}
            placeholder="Add a blocker…"
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => releaseRepository.addBlocker(id, blockerDraft).success && setBlockerDraft('')}
            className="inline-flex items-center rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300 transition hover:bg-slate-700/60"
            aria-label="Add blocker"
          >
            <Ban className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* warnings */}
      {release.warnings.length > 0 ? (
        <div>
          <SectionLabel>Warnings ({release.warnings.length})</SectionLabel>
          <PlainList items={release.warnings} tone="warn" empty="None" />
        </div>
      ) : null}

      {/* release notes */}
      {release.releaseNotes ? (
        <div>
          <SectionLabel>
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3 w-3" /> Release notes
            </span>
          </SectionLabel>
          <p className="mt-1 whitespace-pre-line rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs leading-relaxed text-slate-400">
            {release.releaseNotes}
          </p>
        </div>
      ) : null}

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
        <MiniButton icon={<ClipboardCheck className="h-3 w-3" />} onClick={() => releaseRepository.markQaReviewed(id)}>
          Mark QA reviewed
        </MiniButton>
        <MiniButton icon={<Send className="h-3 w-3" />} onClick={() => releaseRepository.requestApproval(id)}>
          Request approval
        </MiniButton>
        <MiniButton icon={<ShieldCheck className="h-3 w-3" />} onClick={() => releaseRepository.markApprovalReceived(id)}>
          Approval received
        </MiniButton>
        <MiniButton
          icon={<CheckCheck className="h-3 w-3" />}
          variant="primary"
          onClick={() => releaseRepository.markReadyForRelease(id)}
          disabled={release.status === 'ready' || release.status === 'released'}
        >
          Mark ready
        </MiniButton>
        <MiniButton
          icon={<Rocket className="h-3 w-3" />}
          variant="primary"
          onClick={() => releaseRepository.markReleased(id)}
          disabled={release.status === 'released'}
        >
          Mark released
        </MiniButton>
        <MiniButton
          icon={<XCircle className="h-3 w-3" />}
          variant="danger"
          onClick={() => releaseRepository.cancelRelease(id)}
          disabled={release.status === 'released' || release.status === 'cancelled'}
        >
          Cancel
        </MiniButton>
      </div>
    </div>
  )
}

function HistoryRow({ release, highlight }: { release: ReleaseItem; highlight: boolean }): JSX.Element {
  return (
    <div
      className={[
        'flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5',
        highlight ? 'border-indigo-500/30 bg-indigo-500/5' : 'border-slate-800 bg-slate-900/40'
      ].join(' ')}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Rocket className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span className="truncate text-sm text-slate-200">
          {release.title} {release.version}
        </span>
        <Chip>{release.releaseType}</Chip>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {release.blockers.length > 0 ? <span className="text-rose-300">{release.blockers.length} blocker(s)</span> : null}
        <StatusBadge status={release.status} />
      </div>
    </div>
  )
}

// --- new release form ------------------------------------------------------

function NewReleaseForm(): JSX.Element {
  const [title, setTitle] = useState('')
  const [version, setVersion] = useState('')
  const [releaseType, setReleaseType] = useState<ReleaseType>('internal')

  const submit = (): void => {
    if (releaseRepository.createReleaseCandidate({ title, version, releaseType }).success) {
      setTitle('')
      setVersion('')
      setReleaseType('internal')
    }
  }

  return (
    <Card title="New Release Candidate" icon={<Plus className="h-4 w-4" />}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Release title…"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
        <input
          type="text"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Version (e.g. v0.2)"
          className="w-36 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
        <select
          value={releaseType}
          onChange={(e) => setReleaseType(e.target.value as ReleaseType)}
          className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200 focus:border-indigo-500/50 focus:outline-none"
        >
          {RELEASE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <ActionButton icon={<Plus className="h-4 w-4" />} variant="primary" onClick={submit}>
          Create candidate
        </ActionButton>
      </div>
    </Card>
  )
}

// --- presentational helpers ------------------------------------------------

function GateTile({
  icon,
  label,
  status,
  styleMap = GATE_STYLES
}: {
  icon?: ReactNode
  label: string
  status: string
  styleMap?: Record<string, string>
}): JSX.Element {
  const className = styleMap[status] ?? GATE_STYLES.pending
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        {icon ? <span className="text-slate-400">{icon}</span> : null}
        {label}
      </div>
      <div className="mt-1.5">
        <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', className].join(' ')}>{status}</span>
      </div>
    </div>
  )
}

function PlainList({ items, tone, empty }: { items: string[]; tone: 'bad' | 'warn'; empty: string }): JSX.Element {
  if (items.length === 0) return <div className="ml-1 mt-1 text-xs text-slate-500">{empty}</div>
  const Icon = tone === 'bad' ? Ban : AlertTriangle
  const color = tone === 'bad' ? 'text-rose-300/80' : 'text-amber-300/80'
  return (
    <ul className="mt-1 space-y-1">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs text-slate-300">
          <Icon className={['mt-0.5 h-3.5 w-3.5 shrink-0', color].join(' ')} />
          {item}
        </li>
      ))}
    </ul>
  )
}

function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{children}</div>
}

function StatusBadge({ status }: { status: ReleaseStatus }): JSX.Element {
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_STYLES[status]].join(' ')}>
      {STATUS_LABELS[status]}
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
