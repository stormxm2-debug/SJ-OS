import { type ReactNode, useMemo, useState } from 'react'
import {
  Activity,
  CalendarCheck,
  ListChecks,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Flame,
  Trophy,
  Users,
  Filter,
  Download,
  RotateCcw,
  Plus,
  PlayCircle,
  XCircle,
  CalendarClock,
  UserX,
  StickyNote,
  ArrowRightLeft,
  Flag,
  Target,
  ChevronRight
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { useSalesActivity } from '@renderer/services/sales-activity/useSalesActivity'
import {
  salesActivityRepository,
  isOverdue,
  isToday
} from '@renderer/services/sales-activity/SalesActivityRepository'
import { fcRepository } from '@renderer/services/fc/FcRepository'
import type {
  ActivityPriority,
  ActivityStatus,
  ActivityType,
  SalesActivity,
  SalesActivityFilter
} from '@renderer/services/sales-activity/types'

// --- label + tone maps -----------------------------------------------------

const TYPE_LABEL: Record<ActivityType, string> = {
  AP: 'AP',
  'first-meeting': '1차 미팅',
  'second-meeting': '2차 미팅',
  'needs-analysis': '니즈분석',
  'policy-review': '증권분석',
  proposal: '제안',
  closing: '클로징',
  contract: '계약',
  'referral-request': '소개요청',
  'existing-customer-care': '기고객관리',
  'follow-up': '후속관리',
  'after-care': '사후관리'
}

const STATUS_LABEL: Record<ActivityStatus, string> = {
  planned: '예정',
  'in-progress': '진행중',
  completed: '완료',
  cancelled: '취소',
  delayed: '연기',
  'no-show': '노쇼',
  'needs-follow-up': '후속필요'
}

const STATUS_TONE: Record<ActivityStatus, string> = {
  planned: 'border-slate-600/40 bg-slate-600/10 text-slate-300',
  'in-progress': 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  cancelled: 'border-slate-500/30 bg-slate-500/10 text-slate-400',
  delayed: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  'no-show': 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  'needs-follow-up': 'border-orange-500/30 bg-orange-500/10 text-orange-300'
}

const PRIORITY_TONE: Record<ActivityPriority, string> = {
  P0: 'text-rose-300',
  P1: 'text-amber-300',
  P2: 'text-sky-300',
  P3: 'text-slate-400'
}

const TYPE_OPTIONS = Object.keys(TYPE_LABEL) as ActivityType[]
const STATUS_OPTIONS = Object.keys(STATUS_LABEL) as ActivityStatus[]
const PRIORITY_OPTIONS: ActivityPriority[] = ['P0', 'P1', 'P2', 'P3']

const EMPTY_FILTER: SalesActivityFilter = {
  fcId: 'all',
  team: 'all',
  type: 'all',
  status: 'all',
  priority: 'all'
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ko-KR')
}

function exportReport(): void {
  const json = salesActivityRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'sales-activity-report.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

function handleCreate(): void {
  if (typeof window === 'undefined') return
  const title = window.prompt('새 영업활동 제목 (예: 오전 AP 콜)')
  if (!title || !title.trim()) return
  const fc = fcRepository.listMembers().find((m) => m.role === 'FC') ?? fcRepository.listMembers()[0]
  if (!fc) return
  salesActivityRepository.createActivity({
    fcId: fc.fcId,
    type: 'AP',
    title: title.trim(),
    priority: 'P2',
    scheduledAt: new Date().toISOString()
  })
}

/**
 * Sales Activity Workspace — the daily operating heartbeat of SJ Invest. Reads
 * the activity pipeline (via useSalesActivity) and every rollup from
 * salesActivityRepository, which links to the FC OS roster and Customer
 * Workspace through their public APIs. All mutations delegate to the repository.
 */
export default function SalesActivityWorkspacePage(): JSX.Element {
  const snapshot = useSalesActivity()
  const [filter, setFilter] = useState<SalesActivityFilter>(EMPTY_FILTER)
  const summary = salesActivityRepository.getSummary()
  const ranking = salesActivityRepository.getFcActivityRanking()
  const teams = salesActivityRepository.getTeamActivitySummary()

  const activities = useMemo(
    () => salesActivityRepository.filterActivities(filter),
    [filter, snapshot]
  )
  const selected = snapshot.selectedActivityId
    ? salesActivityRepository.getActivity(snapshot.selectedActivityId)
    : null

  const teamOptions = useMemo(
    () => Array.from(new Set(snapshot.activities.map((a) => a.team))),
    [snapshot]
  )
  const fcOptions = useMemo(
    () =>
      Array.from(new Map(snapshot.activities.map((a) => [a.fcId, a.fcName])).entries()).map(
        ([fcId, fcName]) => ({ fcId, fcName })
      ),
    [snapshot]
  )

  const nextActions = snapshot.activities
    .filter((a) => !['completed', 'cancelled'].includes(a.status) && a.nextAction)
    .sort((a, b) => (a.nextActionAt ?? '') < (b.nextActionAt ?? '') ? -1 : 1)
    .slice(0, 8)
  const overdue = snapshot.activities.filter(isOverdue)

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('영업활동 데모 데이터를 초기화할까요?')) return
    salesActivityRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      {/* Header + summary */}
      <Card
        title="영업활동 워크스페이스 — 영업활동 현황"
        icon={<Activity className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Plus className="h-4 w-4" />} variant="primary" onClick={handleCreate}>
              새 활동
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
          <Metric icon={<CalendarCheck className="h-4 w-4" />} label="오늘 활동" value={`${summary.today}건`} tone="text-sky-300" />
          <Metric icon={<ListChecks className="h-4 w-4" />} label="예정" value={`${summary.planned}건`} />
          <Metric icon={<CheckCircle2 className="h-4 w-4" />} label="완료" value={`${summary.completed}건`} tone="text-emerald-300" />
          <Metric icon={<AlertTriangle className="h-4 w-4" />} label="연기/노쇼" value={`${summary.delayed}/${summary.noShow}`} tone="text-rose-300" />
          <Metric icon={<Clock className="h-4 w-4" />} label="후속 필요" value={`${summary.followUpNeeded}건`} tone="text-orange-300" />
          <Metric icon={<Flame className="h-4 w-4" />} label="클로징 파이프라인" value={`${summary.closingPipeline}건`} tone="text-amber-300" />
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>전체 완료율 · 오늘 AP {summary.apToday}건 · 연체 후속 {summary.overdueFollowUp}건</span>
            <span className="text-emerald-300">{summary.completionRate}%</span>
          </div>
          <div className="mt-1">
            <ProgressBar value={summary.completionRate} />
          </div>
        </div>
      </Card>

      {/* FC ranking + team summary */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="FC 활동 순위" icon={<Trophy className="h-4 w-4" />} className="lg:col-span-2">
          <ol className="space-y-2">
            {ranking.map((r, i) => (
              <li key={r.fcId} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                <span className="w-5 shrink-0 text-center text-sm font-semibold text-slate-500">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-100">{r.fcName} <span className="text-xs text-slate-500">· {r.team}</span></div>
                  <div className="text-xs text-slate-500">오늘 {r.today} · 완료 {r.completed}/{r.total} · 연기 {r.delayed} · 노쇼 {r.noShow}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-medium text-emerald-300">{r.completionRate}%</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="팀별 활동" icon={<Users className="h-4 w-4" />}>
          <div className="space-y-2">
            {teams.map((t) => (
              <div key={t.team} className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-200">{t.team}</span>
                  <span className="text-emerald-300">{t.completionRate}%</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">오늘 {t.today} · 완료 {t.completed}/{t.total}</div>
                <div className="mt-1"><ProgressBar value={t.completionRate} /></div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Filters + list + detail */}
      <Card title="활동 필터" icon={<Filter className="h-4 w-4" />}>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <FilterSelect label="FC" value={filter.fcId} onChange={(v) => setFilter((f) => ({ ...f, fcId: v }))}
            options={[{ value: 'all', label: '전체' }, ...fcOptions.map((f) => ({ value: f.fcId, label: f.fcName }))]} />
          <FilterSelect label="팀" value={filter.team} onChange={(v) => setFilter((f) => ({ ...f, team: v }))}
            options={[{ value: 'all', label: '전체' }, ...teamOptions.map((t) => ({ value: t, label: t }))]} />
          <FilterSelect label="유형" value={filter.type} onChange={(v) => setFilter((f) => ({ ...f, type: v as ActivityType | 'all' }))}
            options={[{ value: 'all', label: '전체' }, ...TYPE_OPTIONS.map((t) => ({ value: t, label: TYPE_LABEL[t] }))]} />
          <FilterSelect label="상태" value={filter.status} onChange={(v) => setFilter((f) => ({ ...f, status: v as ActivityStatus | 'all' }))}
            options={[{ value: 'all', label: '전체' }, ...STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
          <FilterSelect label="우선순위" value={filter.priority} onChange={(v) => setFilter((f) => ({ ...f, priority: v as ActivityPriority | 'all' }))}
            options={[{ value: 'all', label: '전체' }, ...PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))]} />
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <Card title="활동 목록" icon={<Activity className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{activities.length}건</span>}>
          <ol className="max-h-[34rem] space-y-1.5 overflow-y-auto pr-1">
            {activities.map((a) => (
              <ActivityRow key={a.activityId} activity={a} selected={a.activityId === snapshot.selectedActivityId}
                onSelect={() => salesActivityRepository.selectActivity(a.activityId)} />
            ))}
            {activities.length === 0 ? <li className="px-2 py-4 text-sm text-slate-500">조건에 맞는 활동이 없습니다.</li> : null}
          </ol>
        </Card>

        {selected ? <ActivityDetail activity={selected} /> : <EmptyDetail />}
      </div>

      {/* Next action + overdue boards */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="다음 액션 보드" icon={<Target className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{nextActions.length}건</span>}>
          {nextActions.length === 0 ? (
            <p className="text-sm text-slate-500">예정된 다음 액션이 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {nextActions.map((a) => (
                <li key={a.activityId} className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-200">{a.nextAction}</div>
                    <div className="text-[11px] text-slate-500">{a.fcName} · {a.customerName ?? '—'} · {TYPE_LABEL[a.type]}</div>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-500">{formatDate(a.nextActionAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="연체 후속 보드" icon={<AlertTriangle className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{overdue.length}건</span>}>
          {overdue.length === 0 ? (
            <p className="text-sm text-emerald-300/80">연체된 후속 활동이 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {overdue.map((a) => (
                <li key={a.activityId} className="flex items-start justify-between gap-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-rose-100">{a.title}</div>
                    <div className="text-[11px] text-rose-300/70">{a.fcName} · {a.customerName ?? '—'} · {STATUS_LABEL[a.status]}</div>
                  </div>
                  <span className="shrink-0 text-[11px] text-rose-300/70">{formatDate(a.nextActionAt ?? a.scheduledAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

// --- activity list row -----------------------------------------------------

function ActivityRow({
  activity,
  selected,
  onSelect
}: {
  activity: SalesActivity
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={[
          'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition',
          selected ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-slate-800 bg-slate-900/40 hover:bg-slate-800/60'
        ].join(' ')}
      >
        <span className={['shrink-0 text-[11px] font-semibold', PRIORITY_TONE[activity.priority]].join(' ')}>{activity.priority}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-100">{activity.title}</div>
          <div className="truncate text-[11px] text-slate-500">
            {activity.fcName} · {activity.customerName ?? '—'} · {TYPE_LABEL[activity.type]}
          </div>
        </div>
        {isToday(activity.scheduledAt) ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" title="오늘" /> : null}
        <span className={['shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]', STATUS_TONE[activity.status]].join(' ')}>
          {STATUS_LABEL[activity.status]}
        </span>
      </button>
    </li>
  )
}

// --- selected activity detail ----------------------------------------------

function ActivityDetail({ activity }: { activity: SalesActivity }): JSX.Element {
  const id = activity.activityId
  const linked = activity.customerId ? salesActivityRepository.listByCustomer(activity.customerId) : []

  const promptMemo = (): void => {
    const text = window.prompt(`${activity.title} 메모 추가`)
    if (text) salesActivityRepository.addMemo(id, text)
  }
  const promptNextAction = (): void => {
    const text = window.prompt('다음 액션', activity.nextAction)
    if (text === null) return
    salesActivityRepository.updateNextAction(id, text)
  }
  const promptReschedule = (): void => {
    const raw = window.prompt('새 일정 (YYYY-MM-DD)', '')
    if (!raw) return
    salesActivityRepository.reschedule(id, new Date(raw).toISOString())
  }
  const promptAssign = (): void => {
    const roster = fcRepository.listMembers().map((m) => `${m.fcId} · ${m.name} (${m.team})`).join('\n')
    const fcId = window.prompt(`FC 배정 — FC ID 입력\n\n${roster}`, activity.fcId)
    if (fcId) salesActivityRepository.assignToFc(id, fcId.trim())
  }
  const promptPriority = (): void => {
    const p = window.prompt('우선순위 (P0/P1/P2/P3)', activity.priority)
    if (p && ['P0', 'P1', 'P2', 'P3'].includes(p)) salesActivityRepository.changePriority(id, p as ActivityPriority)
  }

  return (
    <div className="space-y-5">
      <Card
        title="활동 상세"
        icon={<Activity className="h-4 w-4" />}
        action={<span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_TONE[activity.status]].join(' ')}>{STATUS_LABEL[activity.status]}</span>}
      >
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={['text-xs font-semibold', PRIORITY_TONE[activity.priority]].join(' ')}>{activity.priority}</span>
              <span className="text-lg font-semibold text-slate-100">{activity.title}</span>
            </div>
            <p className="mt-1 text-sm text-slate-400">{activity.description || '설명 없음'}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="담당 FC" value={`${activity.fcName} · ${activity.team}`} />
            <Field label="고객" value={activity.customerName ?? '—'} />
            <Field label="유형" value={TYPE_LABEL[activity.type]} />
            <Field label="예정 일시" value={formatDate(activity.scheduledAt)} />
            <Field label="완료 일시" value={formatDate(activity.completedAt)} />
            <Field label="장소" value={activity.location || '—'} />
            <Field label="상담 단계" value={activity.relatedConsultationStage ?? '—'} />
            <Field label="다음 액션" value={activity.nextAction || '—'} />
            <Field label="다음 액션 일시" value={formatDate(activity.nextActionAt)} />
          </div>

          {activity.result ? (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">결과: {activity.result}</div>
          ) : null}
          {activity.memo ? (
            <div className="whitespace-pre-line rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">{activity.memo}</div>
          ) : null}
        </div>
      </Card>

      {/* Quick actions */}
      <Card title="빠른 작업" icon={<ListChecks className="h-4 w-4" />}>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton icon={<PlayCircle className="h-4 w-4" />} onClick={() => salesActivityRepository.markInProgress(id)}>진행중</ActionButton>
          <ActionButton icon={<CheckCircle2 className="h-4 w-4" />} variant="primary" onClick={() => salesActivityRepository.markCompleted(id)}>완료</ActionButton>
          <ActionButton icon={<CalendarClock className="h-4 w-4" />} onClick={() => salesActivityRepository.markDelayed(id)}>연기</ActionButton>
          <ActionButton icon={<UserX className="h-4 w-4" />} onClick={() => salesActivityRepository.markNoShow(id)}>노쇼</ActionButton>
          <ActionButton icon={<XCircle className="h-4 w-4" />} onClick={() => salesActivityRepository.markCancelled(id)}>취소</ActionButton>
          <ActionButton icon={<StickyNote className="h-4 w-4" />} onClick={promptMemo}>메모</ActionButton>
          <ActionButton icon={<Target className="h-4 w-4" />} onClick={promptNextAction}>다음 액션</ActionButton>
          <ActionButton icon={<CalendarClock className="h-4 w-4" />} onClick={promptReschedule}>일정 변경</ActionButton>
          <ActionButton icon={<ArrowRightLeft className="h-4 w-4" />} onClick={promptAssign}>FC 배정</ActionButton>
          <ActionButton icon={<Flag className="h-4 w-4" />} onClick={promptPriority}>우선순위</ActionButton>
          {activity.customerId && activity.relatedConsultationStage ? (
            <ActionButton icon={<ChevronRight className="h-4 w-4" />} onClick={() => salesActivityRepository.applyConsultationStage(id)}>고객 단계 반영</ActionButton>
          ) : null}
        </div>
      </Card>

      {/* Customer-linked activity timeline */}
      {activity.customerId ? (
        <Card title="고객 연결 활동 타임라인" icon={<Activity className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{linked.length}건</span>}>
          <ol className="space-y-2">
            {linked.map((a) => (
              <li key={a.activityId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-200">{TYPE_LABEL[a.type]} · {a.title}</div>
                  <div className="text-[11px] text-slate-500">{formatDate(a.scheduledAt)}</div>
                </div>
                <span className={['shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]', STATUS_TONE[a.status]].join(' ')}>{STATUS_LABEL[a.status]}</span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </div>
  )
}

function EmptyDetail(): JSX.Element {
  return (
    <Card title="활동 선택" icon={<Activity className="h-4 w-4" />}>
      <p className="text-sm text-slate-500">왼쪽 목록에서 활동을 선택하면 상세 정보와 작업이 표시됩니다.</p>
    </Card>
  )
}

// --- presentational helpers ------------------------------------------------

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

function FilterSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}): JSX.Element {
  return (
    <label className="block text-[11px] text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-sm text-slate-200 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
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
