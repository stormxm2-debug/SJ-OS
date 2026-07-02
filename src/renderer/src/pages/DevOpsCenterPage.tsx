import { useState, type ReactNode } from 'react'
import {
  Server,
  GitBranch,
  GitCommit,
  Boxes,
  ClipboardCheck,
  ShieldCheck,
  Truck,
  HeartPulse,
  Package,
  Rocket,
  RotateCcw,
  Download,
  Plus,
  History,
  Activity,
  Ban,
  Eraser,
  CheckCheck,
  XCircle,
  PlayCircle,
  Send,
  Undo2,
  AlertTriangle,
  Clock,
  User,
  Terminal
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useDevOps } from '@renderer/services/devops/useDevOps'
import { devOpsRepository } from '@renderer/services/devops/DevOpsRepository'
import type {
  ArtifactStatus,
  DeploymentEnvironment,
  DeploymentItem,
  DeploymentStatus,
  DevOpsApprovalStatus,
  DevOpsGateStatus,
  DevOpsLogType,
  DevOpsPipelineStatus,
  HealthStatus
} from '@renderer/services/devops/types'

// --- styling maps ----------------------------------------------------------

const STATUS_STYLES: Record<DeploymentStatus, string> = {
  draft: 'border-slate-600/40 bg-slate-700/20 text-slate-300',
  ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  deploying: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  deployed: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  failed: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  'rolled-back': 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  blocked: 'border-rose-500/40 bg-rose-500/15 text-rose-200'
}

const STATUS_LABELS: Record<DeploymentStatus, string> = {
  draft: 'Draft',
  ready: 'Ready',
  deploying: 'Deploying',
  deployed: 'Deployed',
  failed: 'Failed',
  'rolled-back': 'Rolled back',
  blocked: 'Blocked'
}

const ENV_STYLES: Record<DeploymentEnvironment, string> = {
  local: 'border-slate-600/40 bg-slate-700/20 text-slate-300',
  development: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  staging: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  production: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const GATE_STYLES: Record<DevOpsGateStatus, string> = {
  pending: 'border-slate-600/40 bg-slate-700/20 text-slate-300',
  passed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  failed: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300'
}

const APPROVAL_STYLES: Record<DevOpsApprovalStatus, string> = {
  'not-required': 'border-slate-600/40 bg-slate-700/20 text-slate-300',
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  rejected: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const PIPELINE_STYLES: Record<DevOpsPipelineStatus, string> = {
  pending: 'border-slate-600/40 bg-slate-700/20 text-slate-300',
  'in-progress': 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  deployed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  failed: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  'rolled-back': 'border-amber-500/30 bg-amber-500/10 text-amber-300'
}

const ARTIFACT_STYLES: Record<ArtifactStatus, string> = {
  pending: 'border-slate-600/40 bg-slate-700/20 text-slate-300',
  building: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  failed: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const HEALTH_STYLES: Record<HealthStatus, string> = {
  unknown: 'border-slate-600/40 bg-slate-700/20 text-slate-300',
  healthy: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  degraded: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  down: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const LOG_STYLES: Record<DevOpsLogType, { label: string; className: string }> = {
  'deployment-created': { label: 'Created', className: 'text-slate-300' },
  'artifact-ready': { label: 'Artifact ready', className: 'text-emerald-300' },
  'environment-ready': { label: 'Environment ready', className: 'text-emerald-300' },
  'deployment-started': { label: 'Deploy started', className: 'text-indigo-300' },
  'deployment-succeeded': { label: 'Deploy succeeded', className: 'text-emerald-300' },
  'deployment-failed': { label: 'Deploy failed', className: 'text-rose-300' },
  'log-added': { label: 'Log', className: 'text-slate-300' },
  'blocker-added': { label: 'Blocker added', className: 'text-rose-300' },
  'blocker-cleared': { label: 'Blocker cleared', className: 'text-emerald-300' },
  'rollback-updated': { label: 'Rollback updated', className: 'text-amber-300' },
  'approval-requested': { label: 'Approval requested', className: 'text-amber-300' },
  reset: { label: 'Reset', className: 'text-amber-300' }
}

const ENVIRONMENTS: DeploymentEnvironment[] = ['local', 'development', 'staging', 'production']

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** Trigger a client-side download of the current DevOps Center as JSON. */
function exportReport(): void {
  const json = devOpsRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'devops-report.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * DevOps Center view. Reads the persisted deployment state from the devops
 * repository (via useDevOps) and shows the current candidate in detail (git,
 * gates, artifact, health, checklist, logs, blockers, rollback) plus the
 * deployment history, a live Release summary and a live QA summary. All
 * mutations delegate to devOpsRepository — no business logic in the component.
 */
export default function DevOpsCenterPage(): JSX.Element {
  const snapshot = useDevOps()
  const current = snapshot.deployments[0] ?? null
  const release = devOpsRepository.getReleaseSummary()
  const qa = devOpsRepository.getLatestQaSummary()

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('Reset the DevOps Center back to the seed?')) {
      return
    }
    devOpsRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      <Card
        title="DevOps Center"
        icon={<Server className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
              Export DevOps report
            </ActionButton>
            <ActionButton variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={handleReset}>
              Reset demo state
            </ActionButton>
          </div>
        }
      >
        {current ? (
          <CurrentDeploymentPanel deployment={current} />
        ) : (
          <p className="text-sm text-slate-500">No deployment candidate yet. Create one below.</p>
        )}
      </Card>

      {/* Live summaries */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Release Summary" icon={<Rocket className="h-4 w-4" />} action={<span className="text-xs text-slate-500">from Release Center</span>}>
          {release ? (
            <div className="space-y-3">
              <div className="text-sm text-slate-300">
                {release.title} <span className="text-slate-400">{release.version}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <MiniStat label="Release status" value={release.status} />
                <MiniStat label="QA" value={release.qaStatus} />
                <MiniStat label="Approval" value={release.approvalStatus} />
                <MiniStat label="Deployment" value={release.deploymentStatus} />
              </div>
              {release.blockers.length > 0 ? (
                <div>
                  <SectionLabel>Release blockers</SectionLabel>
                  <PlainList items={release.blockers} tone="bad" empty="None" />
                </div>
              ) : null}
              {release.warnings.length > 0 ? (
                <div>
                  <SectionLabel>Warnings</SectionLabel>
                  <PlainList items={release.warnings} tone="warn" empty="None" />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No release to summarise.</p>
          )}
        </Card>

        <Card title="Latest QA Summary" icon={<ClipboardCheck className="h-4 w-4" />} action={<span className="text-xs text-slate-500">from QA Center</span>}>
          {qa ? (
            <div className="space-y-3">
              <div className="text-sm text-slate-300">{qa.title}</div>
              <div className="grid gap-2 sm:grid-cols-3">
                <MiniStat label="Typecheck" value={qa.typecheckStatus} />
                <MiniStat label="Build" value={qa.buildStatus} />
                <MiniStat label="Regression" value={qa.regressionStatus} />
              </div>
              {qa.releaseBlockers.length > 0 ? (
                <div>
                  <SectionLabel>Release blockers</SectionLabel>
                  <PlainList items={qa.releaseBlockers} tone="bad" empty="None" />
                </div>
              ) : null}
              {qa.warnings.length > 0 ? (
                <div>
                  <SectionLabel>Warnings</SectionLabel>
                  <PlainList items={qa.warnings} tone="warn" empty="None" />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No QA run to summarise.</p>
          )}
        </Card>
      </div>

      <NewDeploymentForm />

      <Card
        title="Deployment History"
        icon={<History className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{snapshot.deployments.length} deployments</span>}
      >
        {snapshot.deployments.length === 0 ? (
          <p className="text-sm text-slate-500">No deployments recorded.</p>
        ) : (
          <div className="space-y-2">
            {snapshot.deployments.map((d) => (
              <HistoryRow key={d.deploymentId} deployment={d} highlight={current?.deploymentId === d.deploymentId} />
            ))}
          </div>
        )}
      </Card>

      <Card
        title="DevOps Event Log"
        icon={<Activity className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{snapshot.eventLog.length} events</span>}
      >
        {snapshot.eventLog.length === 0 ? (
          <p className="text-sm text-slate-500">No events yet. Use the DevOps actions to record activity.</p>
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

// --- current deployment ----------------------------------------------------

function CurrentDeploymentPanel({ deployment }: { deployment: DeploymentItem }): JSX.Element {
  const [blockerDraft, setBlockerDraft] = useState('')
  const [logDraft, setLogDraft] = useState('')
  const [rollbackDraft, setRollbackDraft] = useState('')
  const id = deployment.deploymentId

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">
              {deployment.title} <span className="text-slate-400">{deployment.version}</span>
            </span>
            <StatusBadge status={deployment.status} />
            <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', ENV_STYLES[deployment.environment]].join(' ')}>
              {deployment.environment}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {deployment.ownerWorkerId}
            </span>
            <span className="flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {deployment.gitBranch}
            </span>
            <span className="flex items-center gap-1">
              <GitCommit className="h-3 w-3" />
              {deployment.gitCommit}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Started {formatTimestamp(deployment.startedAt)}
            </span>
            {deployment.completedAt ? <span>Completed {formatTimestamp(deployment.completedAt)}</span> : null}
          </div>
        </div>
      </div>

      {/* gates */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <GateTile icon={<Boxes className="h-4 w-4" />} label="Build" status={deployment.buildStatus} styleMap={GATE_STYLES} />
        <GateTile icon={<ClipboardCheck className="h-4 w-4" />} label="QA" status={deployment.qaStatus} styleMap={GATE_STYLES} />
        <GateTile icon={<ShieldCheck className="h-4 w-4" />} label="Approval" status={deployment.approvalStatus} styleMap={APPROVAL_STYLES} />
        <GateTile icon={<Package className="h-4 w-4" />} label="Artifact" status={deployment.artifactStatus} styleMap={ARTIFACT_STYLES} />
        <GateTile icon={<Truck className="h-4 w-4" />} label="Deployment" status={deployment.deploymentStatus} styleMap={PIPELINE_STYLES} />
        <GateTile icon={<HeartPulse className="h-4 w-4" />} label="Health" status={deployment.healthStatus} styleMap={HEALTH_STYLES} />
      </div>

      {/* checklist */}
      <div>
        <SectionLabel>Deployment checklist</SectionLabel>
        <ul className="mt-1 space-y-1">
          {deployment.checklist.map((c, i) => (
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
        <SectionLabel>Blockers ({deployment.blockers.length})</SectionLabel>
        {deployment.blockers.length === 0 ? (
          <p className="mt-1 text-xs text-emerald-300/80">No blockers.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {deployment.blockers.map((b, i) => (
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
                  onClick={() => devOpsRepository.clearBlocker(id, b)}
                  className="shrink-0 text-rose-300/70 transition hover:text-rose-200"
                  aria-label="Clear blocker"
                >
                  <Eraser className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <InlineAdd
          value={blockerDraft}
          onChange={setBlockerDraft}
          placeholder="Add a blocker…"
          onSubmit={() => devOpsRepository.addBlocker(id, blockerDraft).success && setBlockerDraft('')}
        />
      </div>

      {/* warnings */}
      {deployment.warnings.length > 0 ? (
        <div>
          <SectionLabel>Warnings ({deployment.warnings.length})</SectionLabel>
          <PlainList items={deployment.warnings} tone="warn" empty="None" />
        </div>
      ) : null}

      {/* rollback plan */}
      <div>
        <SectionLabel>
          <span className="inline-flex items-center gap-1">
            <Undo2 className="h-3 w-3" /> Rollback plan
          </span>
        </SectionLabel>
        <p className="mt-1 whitespace-pre-line rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs leading-relaxed text-slate-400">
          {deployment.rollbackPlan}
        </p>
        <InlineAdd
          value={rollbackDraft}
          onChange={setRollbackDraft}
          placeholder="Update rollback plan…"
          onSubmit={() => devOpsRepository.updateRollbackPlan(id, rollbackDraft).success && setRollbackDraft('')}
        />
      </div>

      {/* deployment logs */}
      <div>
        <SectionLabel>
          <span className="inline-flex items-center gap-1">
            <Terminal className="h-3 w-3" /> Deployment logs ({deployment.deploymentLogs.length})
          </span>
        </SectionLabel>
        {deployment.deploymentLogs.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">No logs.</p>
        ) : (
          <ol className="mt-1 space-y-1">
            {deployment.deploymentLogs.map((log) => (
              <li key={log.id} className="flex items-start justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/40 px-2.5 py-1.5 text-xs">
                <span className="text-slate-300">{log.message}</span>
                <span className="shrink-0 text-slate-600">{formatTimestamp(log.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
        <InlineAdd
          value={logDraft}
          onChange={setLogDraft}
          placeholder="Add a deployment log…"
          onSubmit={() => devOpsRepository.addDeploymentLog(id, logDraft).success && setLogDraft('')}
        />
      </div>

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
        <MiniButton icon={<Package className="h-3 w-3" />} onClick={() => devOpsRepository.markBuildArtifactReady(id)}>
          Artifact ready
        </MiniButton>
        <MiniButton icon={<Server className="h-3 w-3" />} onClick={() => devOpsRepository.markEnvironmentReady(id)}>
          Environment ready
        </MiniButton>
        <MiniButton icon={<Send className="h-3 w-3" />} onClick={() => devOpsRepository.requestDeploymentApproval(id)}>
          Request approval
        </MiniButton>
        <MiniButton
          icon={<PlayCircle className="h-3 w-3" />}
          variant="primary"
          onClick={() => devOpsRepository.markDeploymentStarted(id)}
          disabled={deployment.status === 'deploying' || deployment.status === 'deployed'}
        >
          Start deployment
        </MiniButton>
        <MiniButton
          icon={<CheckCheck className="h-3 w-3" />}
          variant="primary"
          onClick={() => devOpsRepository.markDeploymentSuccessful(id)}
          disabled={deployment.status === 'deployed'}
        >
          Mark successful
        </MiniButton>
        <MiniButton
          icon={<XCircle className="h-3 w-3" />}
          variant="danger"
          onClick={() => devOpsRepository.markDeploymentFailed(id)}
        >
          Mark failed
        </MiniButton>
      </div>
    </div>
  )
}

function HistoryRow({ deployment, highlight }: { deployment: DeploymentItem; highlight: boolean }): JSX.Element {
  return (
    <div
      className={[
        'flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5',
        highlight ? 'border-indigo-500/30 bg-indigo-500/5' : 'border-slate-800 bg-slate-900/40'
      ].join(' ')}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Server className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span className="truncate text-sm text-slate-200">
          {deployment.title} {deployment.version}
        </span>
        <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', ENV_STYLES[deployment.environment]].join(' ')}>
          {deployment.environment}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {deployment.blockers.length > 0 ? <span className="text-rose-300">{deployment.blockers.length} blocker(s)</span> : null}
        <StatusBadge status={deployment.status} />
      </div>
    </div>
  )
}

// --- new deployment form ---------------------------------------------------

function NewDeploymentForm(): JSX.Element {
  const [title, setTitle] = useState('')
  const [version, setVersion] = useState('')
  const [environment, setEnvironment] = useState<DeploymentEnvironment>('development')

  const submit = (): void => {
    if (devOpsRepository.createDeploymentCandidate({ title, version, environment }).success) {
      setTitle('')
      setVersion('')
      setEnvironment('development')
    }
  }

  return (
    <Card title="New Deployment Candidate" icon={<Plus className="h-4 w-4" />}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Deployment title…"
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
          value={environment}
          onChange={(e) => setEnvironment(e.target.value as DeploymentEnvironment)}
          className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200 focus:border-indigo-500/50 focus:outline-none"
        >
          {ENVIRONMENTS.map((env) => (
            <option key={env} value={env}>
              {env}
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
  styleMap
}: {
  icon?: ReactNode
  label: string
  status: string
  styleMap: Record<string, string>
}): JSX.Element {
  const className = styleMap[status] ?? 'border-slate-600/40 bg-slate-700/20 text-slate-300'
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

function MiniStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm text-slate-200">{value}</div>
    </div>
  )
}

function InlineAdd({
  value,
  onChange,
  placeholder,
  onSubmit
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  onSubmit: () => void
}): JSX.Element {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit()
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
      />
      <button
        type="button"
        onClick={onSubmit}
        className="inline-flex items-center rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300 transition hover:bg-slate-700/60"
        aria-label="Add"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
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

function StatusBadge({ status }: { status: DeploymentStatus }): JSX.Element {
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_STYLES[status]].join(' ')}>
      {STATUS_LABELS[status]}
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
