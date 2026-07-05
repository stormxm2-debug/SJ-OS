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
import ReleaseApprovalPanel from '@renderer/components/release/ReleaseApprovalPanel'
import DeploymentPanel from '@renderer/components/release/DeploymentPanel'
import DeploymentProfilePanel from '@renderer/components/release/DeploymentProfilePanel'
import ElectronPackagePanel from '@renderer/components/release/ElectronPackagePanel'
import PackagingConfigPanel from '@renderer/components/release/PackagingConfigPanel'
import ReleaseSnapshotPanel from '@renderer/components/release/ReleaseSnapshotPanel'
import DistributionPackagePanel from '@renderer/components/release/DistributionPackagePanel'
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
  draft: '초안',
  'qa-review': 'QA 검토',
  'approval-required': '승인 필요',
  ready: '준비됨',
  released: '릴리즈됨',
  blocked: '차단됨',
  cancelled: '취소됨'
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
  'release-created': { label: '생성됨', className: 'text-slate-300' },
  'qa-reviewed': { label: 'QA 검토 완료', className: 'text-indigo-300' },
  'approval-requested': { label: '승인 요청', className: 'text-amber-300' },
  'approval-received': { label: '승인 받음', className: 'text-emerald-300' },
  'blocker-added': { label: '블로커 추가', className: 'text-rose-300' },
  'blocker-cleared': { label: '블로커 해제', className: 'text-emerald-300' },
  'marked-ready': { label: '준비 완료 처리', className: 'text-emerald-300' },
  released: { label: '릴리즈됨', className: 'text-emerald-300' },
  cancelled: { label: '취소됨', className: 'text-slate-400' },
  reset: { label: '초기화', className: 'text-amber-300' }
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
    if (typeof window !== 'undefined' && !window.confirm('릴리즈 센터를 초기 값으로 되돌릴까요?')) {
      return
    }
    releaseRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      {/* Claude 릴리즈 승인 센터 (approval + readiness) */}
      <ReleaseApprovalPanel />

      {/* Release snapshot / Git tag center (two-step approved tag + push) */}
      <ReleaseSnapshotPanel />

      {/* Approved deployment runner (release-ready only; two-step; fixed npm run deploy) */}
      <DeploymentPanel />

      {/* Deployment profile / deploy-script manager (approved package.json write) */}
      <DeploymentProfilePanel />

      {/* Electron packaging configuration center (approved package.json script/metadata) */}
      <PackagingConfigPanel />

      {/* Electron installer package center (existing package scripts only; no publish) */}
      <ElectronPackagePanel />

      {/* Staff distribution package registry (folder inspect + SHA-256; no upload) */}
      <DistributionPackagePanel />

      <Card
        title="릴리즈 센터"
        icon={<Rocket className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
              릴리즈 리포트 내보내기
            </ActionButton>
            <ActionButton variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={handleReset}>
              데모 상태 초기화
            </ActionButton>
          </div>
        }
      >
        {current ? <CurrentReleasePanel release={current} /> : <p className="text-sm text-slate-500">아직 릴리즈 후보가 없습니다. 아래에서 새로 만드세요.</p>}
      </Card>

      {/* Live QA summary from the QA Center */}
      <Card title="최근 QA 요약" icon={<ClipboardCheck className="h-4 w-4" />} action={<span className="text-xs text-slate-500">QA 센터에서</span>}>
        {qa ? (
          <div className="space-y-3">
            <div className="text-sm text-slate-300">{qa.title}</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <GateTile label="타입체크" status={qa.typecheckStatus} />
              <GateTile label="빌드" status={qa.buildStatus} />
              <GateTile label="회귀" status={qa.regressionStatus} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <SectionLabel>릴리즈 블로커 ({qa.releaseBlockers.length})</SectionLabel>
                <PlainList items={qa.releaseBlockers} tone="bad" empty="없음" />
              </div>
              <div>
                <SectionLabel>경고 ({qa.warnings.length})</SectionLabel>
                <PlainList items={qa.warnings} tone="warn" empty="없음" />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">요약할 QA 실행이 없습니다.</p>
        )}
      </Card>

      <NewReleaseForm />

      <Card
        title="릴리즈 이력"
        icon={<History className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">릴리즈 {snapshot.releases.length}건</span>}
      >
        {snapshot.releases.length === 0 ? (
          <p className="text-sm text-slate-500">기록된 릴리즈가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {snapshot.releases.map((r) => (
              <HistoryRow key={r.releaseId} release={r} highlight={current?.releaseId === r.releaseId} />
            ))}
          </div>
        )}
      </Card>

      <Card
        title="릴리즈 이벤트 로그"
        icon={<Activity className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">이벤트 {snapshot.eventLog.length}건</span>}
      >
        {snapshot.eventLog.length === 0 ? (
          <p className="text-sm text-slate-500">아직 이벤트가 없습니다. 릴리즈 작업으로 활동을 기록하세요.</p>
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
            {release.relatedSprint ? <span>스프린트: {release.relatedSprint}</span> : null}
            {release.relatedEpic ? (
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                {release.relatedEpic}
              </span>
            ) : null}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              생성 {formatTimestamp(release.createdAt)}
            </span>
            {release.releasedAt ? <span>릴리즈 {formatTimestamp(release.releasedAt)}</span> : null}
          </div>
        </div>
      </div>

      {/* gates */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <GateTile icon={<Boxes className="h-4 w-4" />} label="빌드" status={release.buildStatus} />
        <GateTile icon={<ClipboardCheck className="h-4 w-4" />} label="QA" status={release.qaStatus} />
        <GateTile icon={<ShieldCheck className="h-4 w-4" />} label="승인" status={release.approvalStatus} styleMap={APPROVAL_STYLES} />
        <GateTile icon={<Truck className="h-4 w-4" />} label="배포" status={release.deploymentStatus} styleMap={DEPLOYMENT_STYLES} />
      </div>

      {/* included features */}
      <div>
        <SectionLabel>포함된 기능 ({release.relatedFeatures.length})</SectionLabel>
        {release.relatedFeatures.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">나열된 항목이 없습니다.</p>
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
        <SectionLabel>릴리즈 체크리스트</SectionLabel>
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
        <SectionLabel>블로커 ({release.blockers.length})</SectionLabel>
        {release.blockers.length === 0 ? (
          <p className="mt-1 text-xs text-emerald-300/80">블로커가 없습니다.</p>
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
                  aria-label="블로커 삭제"
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
            placeholder="블로커 추가…"
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => releaseRepository.addBlocker(id, blockerDraft).success && setBlockerDraft('')}
            className="inline-flex items-center rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300 transition hover:bg-slate-700/60"
            aria-label="블로커 추가"
          >
            <Ban className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* warnings */}
      {release.warnings.length > 0 ? (
        <div>
          <SectionLabel>경고 ({release.warnings.length})</SectionLabel>
          <PlainList items={release.warnings} tone="warn" empty="없음" />
        </div>
      ) : null}

      {/* release notes */}
      {release.releaseNotes ? (
        <div>
          <SectionLabel>
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3 w-3" /> 릴리즈 노트
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
          QA 검토 완료 처리
        </MiniButton>
        <MiniButton icon={<Send className="h-3 w-3" />} onClick={() => releaseRepository.requestApproval(id)}>
          승인 요청
        </MiniButton>
        <MiniButton icon={<ShieldCheck className="h-3 w-3" />} onClick={() => releaseRepository.markApprovalReceived(id)}>
          승인 받음
        </MiniButton>
        <MiniButton
          icon={<CheckCheck className="h-3 w-3" />}
          variant="primary"
          onClick={() => releaseRepository.markReadyForRelease(id)}
          disabled={release.status === 'ready' || release.status === 'released'}
        >
          준비 완료 처리
        </MiniButton>
        <MiniButton
          icon={<Rocket className="h-3 w-3" />}
          variant="primary"
          onClick={() => releaseRepository.markReleased(id)}
          disabled={release.status === 'released'}
        >
          릴리즈 처리
        </MiniButton>
        <MiniButton
          icon={<XCircle className="h-3 w-3" />}
          variant="danger"
          onClick={() => releaseRepository.cancelRelease(id)}
          disabled={release.status === 'released' || release.status === 'cancelled'}
        >
          취소
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
        {release.blockers.length > 0 ? <span className="text-rose-300">블로커 {release.blockers.length}건</span> : null}
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
    <Card title="새 릴리즈 후보" icon={<Plus className="h-4 w-4" />}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="릴리즈 제목…"
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
