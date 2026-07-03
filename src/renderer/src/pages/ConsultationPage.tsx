import { type ReactNode, useMemo, useState } from 'react'
import {
  ClipboardList,
  Users,
  Trophy,
  XCircle,
  PauseCircle,
  Flag,
  Target,
  Download,
  RotateCcw,
  Plus,
  CheckCircle2,
  Circle,
  ChevronRight,
  StickyNote,
  ArrowRightLeft,
  ListChecks,
  Filter
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { useConsultation } from '@renderer/services/consultation/useConsultation'
import {
  consultationRepository,
  completedStageCount
} from '@renderer/services/consultation/ConsultationRepository'
import { customerRepository } from '@renderer/services/customer/CustomerRepository'
import {
  ORDERED_STAGES,
  type Consultation,
  type ConsultationFlowStage,
  type ConsultationStatus,
  type StageStatus
} from '@renderer/services/consultation/types'

const STAGE_LABEL: Record<ConsultationFlowStage, string> = {
  'first-meeting': '1차 미팅',
  'second-meeting': '2차 미팅',
  'needs-analysis': '니즈분석',
  'policy-review': '증권분석',
  proposal: '제안',
  closing: '클로징',
  contract: '계약',
  'after-care': '사후관리'
}

const STATUS_LABEL: Record<ConsultationStatus, string> = {
  active: '진행중',
  won: '성공',
  lost: '실패',
  'on-hold': '보류'
}

const STATUS_TONE: Record<ConsultationStatus, string> = {
  active: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  won: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  lost: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  'on-hold': 'border-amber-500/30 bg-amber-500/10 text-amber-300'
}

const STAGE_STATUS_TONE: Record<StageStatus, string> = {
  pending: 'border-slate-700 bg-slate-900/40 text-slate-500',
  active: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200',
  done: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  skipped: 'border-slate-600/40 bg-slate-600/10 text-slate-400'
}

const STATUS_OPTIONS = Object.keys(STATUS_LABEL) as ConsultationStatus[]

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ko-KR')
}

function exportReport(): void {
  const json = consultationRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'consultation-report.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

function handleCreate(): void {
  if (typeof window === 'undefined') return
  const roster = customerRepository
    .listCustomers()
    .slice(0, 20)
    .map((c) => `${c.customerId} · ${c.name}`)
    .join('\n')
  const customerId = window.prompt(`새 상담 개설 — 고객 ID 입력\n\n${roster}`)
  if (!customerId || !customerId.trim()) return
  const result = consultationRepository.createConsultation({ customerId: customerId.trim() })
  if (!result.success) window.alert(result.error ?? '상담 개설에 실패했습니다.')
}

/**
 * Consultation Workspace — the customer advisory-journey cockpit of SJ Invest.
 * Reads consultations (via useConsultation) and rollups from
 * consultationRepository, which links to the Customer Workspace and FC OS. All
 * mutations delegate to the repository.
 */
export default function ConsultationPage(): JSX.Element {
  const snapshot = useConsultation()
  const [statusFilter, setStatusFilter] = useState<ConsultationStatus | 'all'>('all')
  const summary = consultationRepository.getSummary()
  const funnel = consultationRepository.getStageFunnel()

  const consultations = useMemo(
    () =>
      snapshot.consultations.filter((c) => statusFilter === 'all' || c.status === statusFilter),
    [snapshot, statusFilter]
  )
  const selected = snapshot.selectedConsultationId
    ? consultationRepository.getConsultation(snapshot.selectedConsultationId)
    : null

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('상담 데모 데이터를 초기화할까요?')) return
    consultationRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      {/* Header + summary */}
      <Card
        title="상담 워크스페이스 — 상담 흐름 현황"
        icon={<ClipboardList className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Plus className="h-4 w-4" />} variant="primary" onClick={handleCreate}>
              새 상담
            </ActionButton>
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
              리포트 내보내기
            </ActionButton>
            <ActionButton icon={<RotateCcw className="h-4 w-4" />} variant="danger" onClick={handleReset}>
              데모 데이터 초기화
            </ActionButton>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric icon={<Users className="h-4 w-4" />} label="전체 상담" value={`${summary.total}건`} />
          <Metric icon={<ClipboardList className="h-4 w-4" />} label="진행중" value={`${summary.active}건`} tone="text-sky-300" />
          <Metric icon={<Flag className="h-4 w-4" />} label="클로징 단계" value={`${summary.closingStage}건`} tone="text-amber-300" />
          <Metric icon={<Trophy className="h-4 w-4" />} label="성공" value={`${summary.won}건`} tone="text-emerald-300" />
          <Metric icon={<Target className="h-4 w-4" />} label="성공률" value={`${summary.winRate}%`} tone="text-emerald-300" />
          <Metric icon={<PauseCircle className="h-4 w-4" />} label="보류/실패" value={`${summary.onHold}/${summary.lost}`} tone="text-rose-300" />
        </div>
      </Card>

      {/* Stage funnel */}
      <Card title="단계별 상담 퍼널" icon={<ChevronRight className="h-4 w-4" />}>
        <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {funnel.map((row) => (
            <div key={row.stage} className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5 text-center">
              <div className="text-[11px] text-slate-500">{STAGE_LABEL[row.stage]}</div>
              <div className="mt-1 text-lg font-semibold text-slate-100">{row.count}</div>
              <div className="text-[10px] text-emerald-300/80">완료 {row.completed}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Filter + list + detail */}
      <Card title="상담 필터" icon={<Filter className="h-4 w-4" />}>
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip label="전체" active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
          {STATUS_OPTIONS.map((s) => (
            <FilterChip key={s} label={STATUS_LABEL[s]} active={statusFilter === s} onClick={() => setStatusFilter(s)} />
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <Card title="상담 목록" icon={<ClipboardList className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{consultations.length}건</span>}>
          <ol className="max-h-[36rem] space-y-1.5 overflow-y-auto pr-1">
            {consultations.map((c) => (
              <ConsultationRow key={c.consultationId} consultation={c} selected={c.consultationId === snapshot.selectedConsultationId}
                onSelect={() => consultationRepository.selectConsultation(c.consultationId)} />
            ))}
            {consultations.length === 0 ? <li className="px-2 py-4 text-sm text-slate-500">조건에 맞는 상담이 없습니다.</li> : null}
          </ol>
        </Card>

        {selected ? <ConsultationDetail consultation={selected} /> : <EmptyDetail />}
      </div>
    </div>
  )
}

// --- consultation list row --------------------------------------------------

function ConsultationRow({
  consultation,
  selected,
  onSelect
}: {
  consultation: Consultation
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  const progress = Math.round((completedStageCount(consultation) / ORDERED_STAGES.length) * 100)
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={[
          'w-full rounded-lg border px-2.5 py-2 text-left transition',
          selected ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-slate-800 bg-slate-900/40 hover:bg-slate-800/60'
        ].join(' ')}
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-100">{consultation.customerName}</div>
            <div className="truncate text-[11px] text-slate-500">{consultation.fcName} · {STAGE_LABEL[consultation.currentStage]}</div>
          </div>
          <span className={['shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]', STATUS_TONE[consultation.status]].join(' ')}>
            {STATUS_LABEL[consultation.status]}
          </span>
        </div>
        <div className="mt-1.5"><ProgressBar value={progress} /></div>
      </button>
    </li>
  )
}

// --- selected consultation detail -------------------------------------------

function ConsultationDetail({ consultation }: { consultation: Consultation }): JSX.Element {
  const id = consultation.consultationId
  const doneCount = consultation.checklist.filter((i) => i.done).length
  const checklistPct = consultation.checklist.length > 0 ? Math.round((doneCount / consultation.checklist.length) * 100) : 0

  const promptNote = (): void => {
    const text = window.prompt(`${consultation.customerName} 상담 노트`)
    if (text) consultationRepository.addNote(id, text)
  }
  const promptNextAction = (): void => {
    const text = window.prompt('다음 액션', consultation.nextAction)
    if (text === null) return
    consultationRepository.updateNextAction(id, text)
  }
  const promptChecklist = (): void => {
    const text = window.prompt('체크리스트 항목 추가')
    if (text) consultationRepository.addChecklistItem(id, text)
  }

  return (
    <div className="space-y-5">
      <Card
        title="상담 상세"
        icon={<ClipboardList className="h-4 w-4" />}
        action={<span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_TONE[consultation.status]].join(' ')}>{STATUS_LABEL[consultation.status]}</span>}
      >
        <div className="space-y-4">
          <div>
            <span className="text-lg font-semibold text-slate-100">{consultation.customerName}</span>
            <p className="mt-1 text-sm text-slate-400">{consultation.fcName} · {consultation.team} · 현재 단계 {STAGE_LABEL[consultation.currentStage]}</p>
          </div>

          {/* Stage flow */}
          <div className="flex flex-wrap items-center gap-1.5">
            {consultation.stages.map((s, i) => (
              <div key={s.stage} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => consultationRepository.setStageStatus(id, s.stage, s.status === 'done' ? 'active' : 'done')}
                  className={['rounded-lg border px-2 py-1 text-[11px] font-medium transition hover:opacity-80', STAGE_STATUS_TONE[s.status]].join(' ')}
                  title="클릭하여 완료/진행 토글"
                >
                  {STAGE_LABEL[s.stage]}
                </button>
                {i < consultation.stages.length - 1 ? <ChevronRight className="h-3 w-3 text-slate-600" /> : null}
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="다음 액션" value={consultation.nextAction || '—'} />
            <Field label="다음 액션 일시" value={formatDateTime(consultation.nextActionAt)} />
          </div>
        </div>
      </Card>

      {/* Quick actions */}
      <Card title="빠른 작업" icon={<ListChecks className="h-4 w-4" />}>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton icon={<ChevronRight className="h-4 w-4" />} variant="primary" onClick={() => consultationRepository.advanceStage(id)}>다음 단계</ActionButton>
          <ActionButton icon={<Trophy className="h-4 w-4" />} onClick={() => consultationRepository.setStatus(id, 'won')}>성공</ActionButton>
          <ActionButton icon={<XCircle className="h-4 w-4" />} onClick={() => consultationRepository.setStatus(id, 'lost')}>실패</ActionButton>
          <ActionButton icon={<PauseCircle className="h-4 w-4" />} onClick={() => consultationRepository.setStatus(id, 'on-hold')}>보류</ActionButton>
          <ActionButton icon={<StickyNote className="h-4 w-4" />} onClick={promptNote}>노트</ActionButton>
          <ActionButton icon={<Target className="h-4 w-4" />} onClick={promptNextAction}>다음 액션</ActionButton>
          <ActionButton icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => consultationRepository.syncToCustomer(id)}>고객 단계 반영</ActionButton>
        </div>
      </Card>

      {/* Checklist */}
      <Card
        title="상담 체크리스트"
        icon={<ListChecks className="h-4 w-4" />}
        action={<ActionButton icon={<Plus className="h-4 w-4" />} onClick={promptChecklist}>항목</ActionButton>}
      >
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
          <span>{doneCount}/{consultation.checklist.length} 완료</span>
          <span className="text-emerald-300">{checklistPct}%</span>
        </div>
        <div className="mb-3"><ProgressBar value={checklistPct} /></div>
        <ul className="space-y-1.5">
          {consultation.checklist.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => consultationRepository.toggleChecklistItem(id, item.id)}
                className="flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-left transition hover:bg-slate-800/60"
              >
                {item.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-slate-500" />
                )}
                <span className={['text-sm', item.done ? 'text-slate-500 line-through' : 'text-slate-200'].join(' ')}>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {/* Notes */}
      <Card title="상담 노트" icon={<StickyNote className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{consultation.notes.length}건</span>}>
        {consultation.notes.length === 0 ? (
          <p className="text-sm text-slate-500">상담 노트가 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {consultation.notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>{n.author}</span>
                  <span>{formatDateTime(n.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-200">{n.text}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function EmptyDetail(): JSX.Element {
  return (
    <Card title="상담 선택" icon={<ClipboardList className="h-4 w-4" />}>
      <p className="text-sm text-slate-500">왼쪽 목록에서 상담을 선택하면 단계 흐름, 체크리스트, 노트가 표시됩니다.</p>
    </Card>
  )
}

// --- presentational helpers -------------------------------------------------

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-lg border px-3 py-1.5 text-xs font-medium transition',
        active ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200' : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:bg-slate-700/50'
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className={['mt-1 truncate text-sm font-medium', tone ?? 'text-slate-200'].join(' ')}>{value}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-0.5 truncate text-sm text-slate-200" title={value}>{value}</div>
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
      className={['inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition', BUTTON_VARIANTS[variant]].join(' ')}
    >
      {icon}
      {children}
    </button>
  )
}
