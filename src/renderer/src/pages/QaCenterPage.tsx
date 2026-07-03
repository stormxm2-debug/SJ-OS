import { useMemo, useState, type ReactNode } from 'react'
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  Gauge,
  Boxes,
  ShieldAlert,
  Activity,
  Download,
  RotateCcw,
  Plus,
  History,
  Layers,
  GitBranch,
  ListTree,
  Ban,
  CheckCheck,
  Eraser,
  DownloadCloud,
  Clock,
  User
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useQa } from '@renderer/services/qa/useQa'
import { qaRepository } from '@renderer/services/qa/QaRepository'
import type { QaRun, QaScope, QaStatus, QaLogType } from '@renderer/services/qa/types'

// --- styling maps ----------------------------------------------------------

const STATUS_STYLES: Record<QaStatus, string> = {
  pending: 'border-slate-600/40 bg-slate-700/20 text-slate-300',
  running: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  passed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  failed: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  blocked: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300'
}

const STATUS_LABELS: Record<QaStatus, string> = {
  pending: '대기',
  running: '실행 중',
  passed: '통과',
  failed: '실패',
  blocked: '차단됨',
  warning: '경고'
}

const LOG_STYLES: Record<QaLogType, { label: string; className: string }> = {
  'run-created': { label: '실행 생성', className: 'text-slate-300' },
  'run-passed': { label: '실행 통과', className: 'text-emerald-300' },
  'run-failed': { label: '실행 실패', className: 'text-rose-300' },
  'check-passed': { label: '검사 통과', className: 'text-emerald-300' },
  'check-failed': { label: '검사 실패', className: 'text-rose-300' },
  'warning-added': { label: '경고 추가', className: 'text-amber-300' },
  'warning-cleared': { label: '경고 삭제', className: 'text-emerald-300' },
  'blocker-added': { label: '블로커 추가', className: 'text-rose-300' },
  'blocker-cleared': { label: '블로커 해제', className: 'text-emerald-300' },
  escalated: { label: '에스컬레이션', className: 'text-indigo-300' },
  reset: { label: '초기화', className: 'text-amber-300' }
}

const SCOPES: QaScope[] = [
  'full-app',
  'frontend',
  'backend',
  'jarvis',
  'devos',
  'pm-planner',
  'cto-room',
  'approval-center',
  'insurance-platform',
  'release-candidate'
]

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** Trigger a client-side download of the current QA Center as JSON. */
function exportReport(): void {
  const json = qaRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'qa-report.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * QA Center view. Reads the persisted QA state from the qa repository (via useQa)
 * and shows the latest run in detail (all verification dimensions, blockers,
 * warnings, checks) plus the run history. All mutations delegate to
 * qaRepository — no business logic in the component. Finishing a run drives the
 * DevOS event log; release blockers can be escalated to the Approval Center.
 */
export default function QaCenterPage(): JSX.Element {
  const snapshot = useQa()
  const latest = snapshot.runs[0] ?? null

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('QA 센터를 초기 값으로 되돌릴까요?')) {
      return
    }
    qaRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      <Card
        title="QA 센터"
        icon={<ClipboardCheck className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
              QA 리포트 내보내기
            </ActionButton>
            <ActionButton variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={handleReset}>
              데모 상태 초기화
            </ActionButton>
          </div>
        }
      >
        {latest ? (
          <LatestRunPanel run={latest} />
        ) : (
          <p className="text-sm text-slate-500">아직 QA 실행이 없습니다. 아래에서 새로 만드세요.</p>
        )}
      </Card>

      <NewRunForm />

      <Card
        title="QA 이력"
        icon={<History className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">실행 {snapshot.runs.length}건</span>}
      >
        {snapshot.runs.length === 0 ? (
          <p className="text-sm text-slate-500">기록된 실행이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {snapshot.runs.map((run) => (
              <HistoryRow key={run.qaRunId} run={run} highlight={latest?.qaRunId === run.qaRunId} />
            ))}
          </div>
        )}
      </Card>

      <Card
        title="QA 이벤트 로그"
        icon={<Activity className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">이벤트 {snapshot.eventLog.length}건</span>}
      >
        {snapshot.eventLog.length === 0 ? (
          <p className="text-sm text-slate-500">아직 이벤트가 없습니다. QA 작업으로 활동을 기록하세요.</p>
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

// --- latest run ------------------------------------------------------------

function LatestRunPanel({ run }: { run: QaRun }): JSX.Element {
  const [checkDraft, setCheckDraft] = useState('')
  const [warningDraft, setWarningDraft] = useState('')
  const [blockerDraft, setBlockerDraft] = useState('')

  const related = [
    run.relatedEpic ? { icon: <Layers className="h-3 w-3" />, label: run.relatedEpic } : null,
    run.relatedFeature ? { icon: <GitBranch className="h-3 w-3" />, label: run.relatedFeature } : null,
    run.relatedTask ? { icon: <ListTree className="h-3 w-3" />, label: run.relatedTask } : null
  ].filter(Boolean) as Array<{ icon: ReactNode; label: string }>

  const handleEscalate = (): void => {
    const result = qaRepository.escalateBlockersToApproval(run.qaRunId)
    if (typeof window !== 'undefined') {
      window.alert(result.data?.created ? '승인 센터에 릴리즈 검토를 생성했습니다.' : '에스컬레이션할 릴리즈 블로커가 없습니다.')
    }
  }

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">최근 실행 · {run.title}</span>
            <StatusBadge status={run.status} />
            <Chip>{run.scope}</Chip>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {run.ownerWorkerId}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              시작 {formatTimestamp(run.startedAt)}
            </span>
            {run.completedAt ? <span>완료 {formatTimestamp(run.completedAt)}</span> : null}
          </div>
        </div>
      </div>

      {/* dimension statuses */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <DimensionTile icon={<CheckCircle2 className="h-4 w-4" />} label="타입체크" status={run.typecheckStatus} />
        <DimensionTile icon={<Boxes className="h-4 w-4" />} label="빌드" status={run.buildStatus} />
        <DimensionTile icon={<Activity className="h-4 w-4" />} label="회귀" status={run.regressionStatus} />
        <DimensionTile icon={<ShieldCheck className="h-4 w-4" />} label="보안" status={run.securityStatus} />
        <DimensionTile icon={<Gauge className="h-4 w-4" />} label="성능" status={run.performanceStatus} />
        <DimensionTile icon={<ShieldAlert className="h-4 w-4" />} label="커버리지" status={run.coverageStatus} />
      </div>

      {related.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {related.map((r, i) => (
            <span key={i} className="flex items-center gap-1 rounded-md border border-slate-800 bg-slate-950/40 px-2 py-0.5">
              {r.icon}
              {r.label}
            </span>
          ))}
        </div>
      ) : null}

      {/* release blockers */}
      <div>
        <div className="flex items-center justify-between">
          <SectionLabel>릴리즈 블로커 ({run.releaseBlockers.length})</SectionLabel>
          {run.releaseBlockers.length > 0 ? (
            <MiniButton icon={<DownloadCloud className="h-3 w-3" />} onClick={handleEscalate}>
              CEO 검토 요청
            </MiniButton>
          ) : null}
        </div>
        {run.releaseBlockers.length === 0 ? (
          <p className="mt-1 text-xs text-emerald-300/80">릴리즈 블로커가 없습니다.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {run.releaseBlockers.map((b, i) => (
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
                  onClick={() => qaRepository.clearReleaseBlocker(run.qaRunId, b)}
                  className="shrink-0 text-rose-300/70 transition hover:text-rose-200"
                  aria-label="릴리즈 블로커 삭제"
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
          placeholder="릴리즈 블로커 추가…"
          onSubmit={() => qaRepository.addReleaseBlocker(run.qaRunId, blockerDraft).success && setBlockerDraft('')}
        />
      </div>

      {/* warnings */}
      <div>
        <SectionLabel>경고 ({run.warnings.length})</SectionLabel>
        {run.warnings.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">경고가 없습니다.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {run.warnings.map((w, i) => (
              <li
                key={i}
                className="flex items-start justify-between gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200"
              >
                <span className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {w}
                </span>
                <button
                  type="button"
                  onClick={() => qaRepository.clearWarning(run.qaRunId, w)}
                  className="shrink-0 text-amber-300/70 transition hover:text-amber-200"
                  aria-label="경고 삭제"
                >
                  <Eraser className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <InlineAdd
          value={warningDraft}
          onChange={setWarningDraft}
          placeholder="경고 추가…"
          onSubmit={() => qaRepository.addWarning(run.qaRunId, warningDraft).success && setWarningDraft('')}
        />
      </div>

      {/* checks */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <SectionLabel>통과한 검사 ({run.passedChecks.length})</SectionLabel>
          <CheckList items={run.passedChecks} tone="good" />
        </div>
        <div>
          <SectionLabel>실패한 검사 ({run.failedChecks.length})</SectionLabel>
          <CheckList items={run.failedChecks} tone="bad" />
        </div>
      </div>
      <InlineAdd
        value={checkDraft}
        onChange={setCheckDraft}
        placeholder="검사 이름…"
        actions={
          <>
            <MiniButton
              icon={<CheckCheck className="h-3 w-3" />}
              variant="primary"
              onClick={() => qaRepository.markCheckPassed(run.qaRunId, checkDraft).success && setCheckDraft('')}
            >
              통과
            </MiniButton>
            <MiniButton
              icon={<XCircle className="h-3 w-3" />}
              variant="danger"
              onClick={() => qaRepository.markCheckFailed(run.qaRunId, checkDraft).success && setCheckDraft('')}
            >
              실패
            </MiniButton>
          </>
        }
      />

      {/* run outcome */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
        <MiniButton
          icon={<CheckCheck className="h-3 w-3" />}
          variant="primary"
          onClick={() => qaRepository.markRunPassed(run.qaRunId)}
          disabled={run.status === 'passed'}
        >
          실행 통과 처리
        </MiniButton>
        <MiniButton
          icon={<XCircle className="h-3 w-3" />}
          variant="danger"
          onClick={() => qaRepository.markRunFailed(run.qaRunId)}
          disabled={run.status === 'failed'}
        >
          실행 실패 처리
        </MiniButton>
      </div>
    </div>
  )
}

function DimensionTile({ icon, label, status }: { icon: ReactNode; label: string; status: QaStatus }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className="mt-1.5">
        <StatusBadge status={status} />
      </div>
    </div>
  )
}

function HistoryRow({ run, highlight }: { run: QaRun; highlight: boolean }): JSX.Element {
  return (
    <div
      className={[
        'flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5',
        highlight ? 'border-indigo-500/30 bg-indigo-500/5' : 'border-slate-800 bg-slate-900/40'
      ].join(' ')}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span className="truncate text-sm text-slate-200">{run.title}</span>
        <Chip>{run.scope}</Chip>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {run.releaseBlockers.length > 0 ? <span className="text-rose-300">블로커 {run.releaseBlockers.length}건</span> : null}
        {run.warnings.length > 0 ? <span className="text-amber-300">경고 {run.warnings.length}건</span> : null}
        <span>
          {run.passedChecks.length}✓ / {run.failedChecks.length}✗
        </span>
        <StatusBadge status={run.status} />
      </div>
    </div>
  )
}

// --- new run form ----------------------------------------------------------

function NewRunForm(): JSX.Element {
  const [title, setTitle] = useState('')
  const [scope, setScope] = useState<QaScope>('full-app')

  const submit = (): void => {
    if (qaRepository.createQaRun({ title, scope }).success) {
      setTitle('')
      setScope('full-app')
    }
  }

  return (
    <Card title="새 QA 실행" icon={<Plus className="h-4 w-4" />}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="QA 실행 제목…"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as QaScope)}
          className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200 focus:border-indigo-500/50 focus:outline-none"
        >
          {SCOPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <ActionButton icon={<Plus className="h-4 w-4" />} variant="primary" onClick={submit}>
          실행 생성
        </ActionButton>
      </div>
    </Card>
  )
}

// --- presentational helpers ------------------------------------------------

function InlineAdd({
  value,
  onChange,
  placeholder,
  onSubmit,
  actions
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  onSubmit?: () => void
  actions?: ReactNode
}): JSX.Element {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onSubmit) onSubmit()
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
      />
      {actions ?? (
        <button
          type="button"
          onClick={onSubmit}
          className="inline-flex items-center rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300 transition hover:bg-slate-700/60"
          aria-label="추가"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

function CheckList({ items, tone }: { items: string[]; tone: 'good' | 'bad' }): JSX.Element {
  if (items.length === 0) return <div className="ml-1 mt-1 text-xs text-slate-600">—</div>
  const Icon = tone === 'good' ? CheckCircle2 : XCircle
  const color = tone === 'good' ? 'text-emerald-300/80' : 'text-rose-300/80'
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

function StatusBadge({ status }: { status: QaStatus }): JSX.Element {
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
