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
  draft: '초안',
  ready: '준비됨',
  deploying: '배포 중',
  deployed: '배포됨',
  failed: '실패',
  'rolled-back': '롤백됨',
  blocked: '차단됨'
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
  'deployment-created': { label: '생성됨', className: 'text-slate-300' },
  'artifact-ready': { label: '아티팩트 준비됨', className: 'text-emerald-300' },
  'environment-ready': { label: '환경 준비됨', className: 'text-emerald-300' },
  'deployment-started': { label: '배포 시작', className: 'text-indigo-300' },
  'deployment-succeeded': { label: '배포 성공', className: 'text-emerald-300' },
  'deployment-failed': { label: '배포 실패', className: 'text-rose-300' },
  'log-added': { label: '로그', className: 'text-slate-300' },
  'blocker-added': { label: '블로커 추가', className: 'text-rose-300' },
  'blocker-cleared': { label: '블로커 해제', className: 'text-emerald-300' },
  'rollback-updated': { label: '롤백 업데이트', className: 'text-amber-300' },
  'approval-requested': { label: '승인 요청', className: 'text-amber-300' },
  reset: { label: '초기화', className: 'text-amber-300' }
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
    if (typeof window !== 'undefined' && !window.confirm('DevOps 센터를 초기 값으로 되돌릴까요?')) {
      return
    }
    devOpsRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      <Card
        title="DevOps 센터"
        icon={<Server className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
              DevOps 리포트 내보내기
            </ActionButton>
            <ActionButton variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={handleReset}>
              데모 상태 초기화
            </ActionButton>
          </div>
        }
      >
        {current ? (
          <CurrentDeploymentPanel deployment={current} />
        ) : (
          <p className="text-sm text-slate-500">아직 배포 후보가 없습니다. 아래에서 새로 만드세요.</p>
        )}
      </Card>

      {/* Live summaries */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="릴리즈 요약" icon={<Rocket className="h-4 w-4" />} action={<span className="text-xs text-slate-500">릴리즈 센터에서</span>}>
          {release ? (
            <div className="space-y-3">
              <div className="text-sm text-slate-300">
                {release.title} <span className="text-slate-400">{release.version}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <MiniStat label="릴리즈 상태" value={release.status} />
                <MiniStat label="QA" value={release.qaStatus} />
                <MiniStat label="승인" value={release.approvalStatus} />
                <MiniStat label="배포" value={release.deploymentStatus} />
              </div>
              {release.blockers.length > 0 ? (
                <div>
                  <SectionLabel>릴리즈 블로커</SectionLabel>
                  <PlainList items={release.blockers} tone="bad" empty="없음" />
                </div>
              ) : null}
              {release.warnings.length > 0 ? (
                <div>
                  <SectionLabel>경고</SectionLabel>
                  <PlainList items={release.warnings} tone="warn" empty="없음" />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">요약할 릴리즈가 없습니다.</p>
          )}
        </Card>

        <Card title="최근 QA 요약" icon={<ClipboardCheck className="h-4 w-4" />} action={<span className="text-xs text-slate-500">QA 센터에서</span>}>
          {qa ? (
            <div className="space-y-3">
              <div className="text-sm text-slate-300">{qa.title}</div>
              <div className="grid gap-2 sm:grid-cols-3">
                <MiniStat label="타입체크" value={qa.typecheckStatus} />
                <MiniStat label="빌드" value={qa.buildStatus} />
                <MiniStat label="회귀" value={qa.regressionStatus} />
              </div>
              {qa.releaseBlockers.length > 0 ? (
                <div>
                  <SectionLabel>릴리즈 블로커</SectionLabel>
                  <PlainList items={qa.releaseBlockers} tone="bad" empty="없음" />
                </div>
              ) : null}
              {qa.warnings.length > 0 ? (
                <div>
                  <SectionLabel>경고</SectionLabel>
                  <PlainList items={qa.warnings} tone="warn" empty="없음" />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">요약할 QA 실행이 없습니다.</p>
          )}
        </Card>
      </div>

      <NewDeploymentForm />

      <Card
        title="배포 이력"
        icon={<History className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">배포 {snapshot.deployments.length}건</span>}
      >
        {snapshot.deployments.length === 0 ? (
          <p className="text-sm text-slate-500">기록된 배포가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {snapshot.deployments.map((d) => (
              <HistoryRow key={d.deploymentId} deployment={d} highlight={current?.deploymentId === d.deploymentId} />
            ))}
          </div>
        )}
      </Card>

      <Card
        title="DevOps 이벤트 로그"
        icon={<Activity className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">이벤트 {snapshot.eventLog.length}건</span>}
      >
        {snapshot.eventLog.length === 0 ? (
          <p className="text-sm text-slate-500">아직 이벤트가 없습니다. DevOps 작업으로 활동을 기록하세요.</p>
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
              시작 {formatTimestamp(deployment.startedAt)}
            </span>
            {deployment.completedAt ? <span>완료 {formatTimestamp(deployment.completedAt)}</span> : null}
          </div>
        </div>
      </div>

      {/* gates */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <GateTile icon={<Boxes className="h-4 w-4" />} label="빌드" status={deployment.buildStatus} styleMap={GATE_STYLES} />
        <GateTile icon={<ClipboardCheck className="h-4 w-4" />} label="QA" status={deployment.qaStatus} styleMap={GATE_STYLES} />
        <GateTile icon={<ShieldCheck className="h-4 w-4" />} label="승인" status={deployment.approvalStatus} styleMap={APPROVAL_STYLES} />
        <GateTile icon={<Package className="h-4 w-4" />} label="아티팩트" status={deployment.artifactStatus} styleMap={ARTIFACT_STYLES} />
        <GateTile icon={<Truck className="h-4 w-4" />} label="배포" status={deployment.deploymentStatus} styleMap={PIPELINE_STYLES} />
        <GateTile icon={<HeartPulse className="h-4 w-4" />} label="헬스" status={deployment.healthStatus} styleMap={HEALTH_STYLES} />
      </div>

      {/* checklist */}
      <div>
        <SectionLabel>배포 체크리스트</SectionLabel>
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
        <SectionLabel>블로커 ({deployment.blockers.length})</SectionLabel>
        {deployment.blockers.length === 0 ? (
          <p className="mt-1 text-xs text-emerald-300/80">블로커가 없습니다.</p>
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
                  aria-label="블로커 삭제"
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
          placeholder="블로커 추가…"
          onSubmit={() => devOpsRepository.addBlocker(id, blockerDraft).success && setBlockerDraft('')}
        />
      </div>

      {/* warnings */}
      {deployment.warnings.length > 0 ? (
        <div>
          <SectionLabel>경고 ({deployment.warnings.length})</SectionLabel>
          <PlainList items={deployment.warnings} tone="warn" empty="없음" />
        </div>
      ) : null}

      {/* rollback plan */}
      <div>
        <SectionLabel>
          <span className="inline-flex items-center gap-1">
            <Undo2 className="h-3 w-3" /> 롤백 계획
          </span>
        </SectionLabel>
        <p className="mt-1 whitespace-pre-line rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs leading-relaxed text-slate-400">
          {deployment.rollbackPlan}
        </p>
        <InlineAdd
          value={rollbackDraft}
          onChange={setRollbackDraft}
          placeholder="롤백 계획 업데이트…"
          onSubmit={() => devOpsRepository.updateRollbackPlan(id, rollbackDraft).success && setRollbackDraft('')}
        />
      </div>

      {/* deployment logs */}
      <div>
        <SectionLabel>
          <span className="inline-flex items-center gap-1">
            <Terminal className="h-3 w-3" /> 배포 로그 ({deployment.deploymentLogs.length})
          </span>
        </SectionLabel>
        {deployment.deploymentLogs.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">로그가 없습니다.</p>
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
          placeholder="배포 로그 추가…"
          onSubmit={() => devOpsRepository.addDeploymentLog(id, logDraft).success && setLogDraft('')}
        />
      </div>

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
        <MiniButton icon={<Package className="h-3 w-3" />} onClick={() => devOpsRepository.markBuildArtifactReady(id)}>
          아티팩트 준비
        </MiniButton>
        <MiniButton icon={<Server className="h-3 w-3" />} onClick={() => devOpsRepository.markEnvironmentReady(id)}>
          환경 준비
        </MiniButton>
        <MiniButton icon={<Send className="h-3 w-3" />} onClick={() => devOpsRepository.requestDeploymentApproval(id)}>
          승인 요청
        </MiniButton>
        <MiniButton
          icon={<PlayCircle className="h-3 w-3" />}
          variant="primary"
          onClick={() => devOpsRepository.markDeploymentStarted(id)}
          disabled={deployment.status === 'deploying' || deployment.status === 'deployed'}
        >
          배포 시작
        </MiniButton>
        <MiniButton
          icon={<CheckCheck className="h-3 w-3" />}
          variant="primary"
          onClick={() => devOpsRepository.markDeploymentSuccessful(id)}
          disabled={deployment.status === 'deployed'}
        >
          성공 처리
        </MiniButton>
        <MiniButton
          icon={<XCircle className="h-3 w-3" />}
          variant="danger"
          onClick={() => devOpsRepository.markDeploymentFailed(id)}
        >
          실패 처리
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
        {deployment.blockers.length > 0 ? <span className="text-rose-300">블로커 {deployment.blockers.length}건</span> : null}
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
    <Card title="새 배포 후보" icon={<Plus className="h-4 w-4" />}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="배포 제목…"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
        <input
          type="text"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="버전 (예: v0.2)"
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
          후보 생성
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
        aria-label="추가"
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
