import { type ReactNode, useMemo, useState } from 'react'
import {
  CalendarDays,
  CalendarClock,
  CalendarCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Users,
  Filter,
  Download,
  RotateCcw,
  Plus,
  PlayCircle,
  XCircle,
  CircleCheck,
  CalendarX,
  StickyNote,
  ArrowRightLeft,
  Flag,
  Target,
  Handshake,
  Phone,
  Briefcase
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { useSchedule } from '@renderer/services/schedule/useSchedule'
import {
  scheduleRepository,
  isOverdue,
  isToday
} from '@renderer/services/schedule/ScheduleRepository'
import { fcRepository } from '@renderer/services/fc/FcRepository'
import type {
  ScheduleFilter,
  ScheduleItem,
  ScheduleKind,
  SchedulePriority,
  ScheduleStatus
} from '@renderer/services/schedule/types'

// --- label + tone maps -----------------------------------------------------

const KIND_LABEL: Record<ScheduleKind, string> = {
  'fc-schedule': 'FC 일정',
  'customer-follow-up': '고객 후속',
  meeting: '미팅',
  appointment: '약속'
}

const KIND_ICON: Record<ScheduleKind, ReactNode> = {
  'fc-schedule': <Briefcase className="h-3.5 w-3.5" />,
  'customer-follow-up': <Phone className="h-3.5 w-3.5" />,
  meeting: <Users className="h-3.5 w-3.5" />,
  appointment: <Handshake className="h-3.5 w-3.5" />
}

const STATUS_LABEL: Record<ScheduleStatus, string> = {
  scheduled: '예정',
  confirmed: '확정',
  'in-progress': '진행중',
  completed: '완료',
  cancelled: '취소',
  rescheduled: '변경',
  missed: '미이행'
}

const STATUS_TONE: Record<ScheduleStatus, string> = {
  scheduled: 'border-slate-600/40 bg-slate-600/10 text-slate-300',
  confirmed: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  'in-progress': 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  cancelled: 'border-slate-500/30 bg-slate-500/10 text-slate-400',
  rescheduled: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  missed: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const PRIORITY_TONE: Record<SchedulePriority, string> = {
  P0: 'text-rose-300',
  P1: 'text-amber-300',
  P2: 'text-sky-300',
  P3: 'text-slate-400'
}

const KIND_OPTIONS = Object.keys(KIND_LABEL) as ScheduleKind[]
const STATUS_OPTIONS = Object.keys(STATUS_LABEL) as ScheduleStatus[]
const PRIORITY_OPTIONS: SchedulePriority[] = ['P0', 'P1', 'P2', 'P3']

const EMPTY_FILTER: ScheduleFilter = {
  fcId: 'all',
  team: 'all',
  kind: 'all',
  status: 'all',
  priority: 'all'
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ko-KR')
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

function exportReport(): void {
  const json = scheduleRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'schedule-report.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

function handleCreate(): void {
  if (typeof window === 'undefined') return
  const title = window.prompt('새 일정 제목 (예: 오후 고객 미팅)')
  if (!title || !title.trim()) return
  const fc = fcRepository.listMembers().find((m) => m.role === 'FC') ?? fcRepository.listMembers()[0]
  if (!fc) return
  scheduleRepository.createItem({
    fcId: fc.fcId,
    kind: 'appointment',
    title: title.trim(),
    priority: 'P2',
    startAt: new Date().toISOString()
  })
}

/**
 * Schedule Workspace — the shared FC/customer calendar of the SJ Invest
 * operating heartbeat. Reads the schedule (via useSchedule) and every rollup
 * from scheduleRepository, which links to the FC OS roster and Customer
 * Workspace through their public APIs. All mutations delegate to the repository.
 */
export default function SchedulePage(): JSX.Element {
  const snapshot = useSchedule()
  const [filter, setFilter] = useState<ScheduleFilter>(EMPTY_FILTER)
  const summary = scheduleRepository.getSummary()
  const board = scheduleRepository.getBoard()
  const fcSummary = scheduleRepository.getFcScheduleSummary()

  const items = useMemo(() => scheduleRepository.filterItems(filter), [filter, snapshot])
  const selected = snapshot.selectedScheduleId
    ? scheduleRepository.getItem(snapshot.selectedScheduleId)
    : null

  const teamOptions = useMemo(
    () => Array.from(new Set(snapshot.items.map((i) => i.team))),
    [snapshot]
  )
  const fcOptions = useMemo(
    () =>
      Array.from(new Map(snapshot.items.map((i) => [i.fcId, i.fcName])).entries()).map(
        ([fcId, fcName]) => ({ fcId, fcName })
      ),
    [snapshot]
  )

  const today = scheduleRepository.getToday()
  const overdue = scheduleRepository.getOverdue()
  const upcoming = scheduleRepository.getUpcoming()

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('일정 데모 데이터를 초기화할까요?')) return
    scheduleRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      {/* Header + summary */}
      <Card
        title="Schedule Workspace — 일정/캘린더 현황"
        icon={<CalendarDays className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Plus className="h-4 w-4" />} variant="primary" onClick={handleCreate}>
              새 일정
            </ActionButton>
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
              Export report
            </ActionButton>
            <ActionButton icon={<RotateCcw className="h-4 w-4" />} variant="danger" onClick={handleReset}>
              Reset demo state
            </ActionButton>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric icon={<CalendarCheck className="h-4 w-4" />} label="오늘 일정" value={`${summary.today}건`} tone="text-sky-300" />
          <Metric icon={<CalendarClock className="h-4 w-4" />} label="다가오는" value={`${summary.upcoming}건`} />
          <Metric icon={<AlertTriangle className="h-4 w-4" />} label="연체" value={`${summary.overdue}건`} tone="text-rose-300" />
          <Metric icon={<CheckCircle2 className="h-4 w-4" />} label="완료" value={`${summary.completed}건`} tone="text-emerald-300" />
          <Metric icon={<Users className="h-4 w-4" />} label="미팅/약속" value={`${summary.meetings + summary.appointments}건`} />
          <Metric icon={<Phone className="h-4 w-4" />} label="고객 후속" value={`${summary.followUps}건`} tone="text-amber-300" />
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>전체 완료율 · 미이행 {summary.missed}건 · 취소 {summary.cancelled}건</span>
            <span className="text-emerald-300">{summary.completionRate}%</span>
          </div>
          <div className="mt-1">
            <ProgressBar value={summary.completionRate} />
          </div>
        </div>
      </Card>

      {/* Calendar-style board */}
      <Card title="주간 캘린더 보드" icon={<CalendarDays className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{board.length}일</span>}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
          {board.map((day) => (
            <div
              key={day.dateKey}
              className={[
                'rounded-lg border p-2',
                day.isToday ? 'border-sky-500/40 bg-sky-500/5' : 'border-slate-800 bg-slate-900/40'
              ].join(' ')}
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className={['text-xs font-medium', day.isToday ? 'text-sky-300' : 'text-slate-400'].join(' ')}>
                  {day.dateKey.slice(5)} ({day.weekdayLabel})
                </span>
                <span className="text-[10px] text-slate-500">{day.items.length}</span>
              </div>
              <div className="space-y-1">
                {day.items.slice(0, 5).map((item) => (
                  <button
                    key={item.scheduleId}
                    type="button"
                    onClick={() => scheduleRepository.selectItem(item.scheduleId)}
                    className={[
                      'flex w-full items-center gap-1 rounded border px-1.5 py-1 text-left text-[10px] transition',
                      item.scheduleId === snapshot.selectedScheduleId
                        ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-200'
                        : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:bg-slate-800/60'
                    ].join(' ')}
                    title={`${formatTime(item.startAt)} · ${item.title}`}
                  >
                    <span className="shrink-0 text-slate-500">{formatTime(item.startAt)}</span>
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
                {day.items.length === 0 ? <div className="px-1 py-1 text-[10px] text-slate-600">—</div> : null}
                {day.items.length > 5 ? (
                  <div className="px-1 text-[10px] text-slate-500">+{day.items.length - 5}건</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Today / overdue / upcoming boards */}
      <div className="grid gap-5 lg:grid-cols-3">
        <ActionBoard title="오늘 액션" icon={<CalendarCheck className="h-4 w-4" />} items={today} selectedId={snapshot.selectedScheduleId} tone="sky" emptyLabel="오늘 예정된 일정이 없습니다." />
        <ActionBoard title="연체 액션" icon={<AlertTriangle className="h-4 w-4" />} items={overdue} selectedId={snapshot.selectedScheduleId} tone="rose" emptyLabel="연체된 일정이 없습니다." />
        <ActionBoard title="다가오는 액션" icon={<CalendarClock className="h-4 w-4" />} items={upcoming} selectedId={snapshot.selectedScheduleId} tone="slate" emptyLabel="다가오는 일정이 없습니다." />
      </div>

      {/* FC schedule summary */}
      <Card title="FC별 일정 현황" icon={<Users className="h-4 w-4" />}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {fcSummary.map((s) => (
            <div key={s.fcId} className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="truncate text-slate-200">{s.fcName} <span className="text-xs text-slate-500">· {s.team}</span></span>
                <span className="text-emerald-300">{s.completionRate}%</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">오늘 {s.today} · 다가오는 {s.upcoming} · 연체 {s.overdue} · 완료 {s.completed}/{s.total}</div>
              <div className="mt-1"><ProgressBar value={s.completionRate} /></div>
            </div>
          ))}
        </div>
      </Card>

      {/* Filters */}
      <Card title="일정 필터" icon={<Filter className="h-4 w-4" />}>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <FilterSelect label="FC" value={filter.fcId} onChange={(v) => setFilter((f) => ({ ...f, fcId: v }))}
            options={[{ value: 'all', label: '전체' }, ...fcOptions.map((f) => ({ value: f.fcId, label: f.fcName }))]} />
          <FilterSelect label="팀" value={filter.team} onChange={(v) => setFilter((f) => ({ ...f, team: v }))}
            options={[{ value: 'all', label: '전체' }, ...teamOptions.map((t) => ({ value: t, label: t }))]} />
          <FilterSelect label="유형" value={filter.kind} onChange={(v) => setFilter((f) => ({ ...f, kind: v as ScheduleKind | 'all' }))}
            options={[{ value: 'all', label: '전체' }, ...KIND_OPTIONS.map((k) => ({ value: k, label: KIND_LABEL[k] }))]} />
          <FilterSelect label="상태" value={filter.status} onChange={(v) => setFilter((f) => ({ ...f, status: v as ScheduleStatus | 'all' }))}
            options={[{ value: 'all', label: '전체' }, ...STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
          <FilterSelect label="우선순위" value={filter.priority} onChange={(v) => setFilter((f) => ({ ...f, priority: v as SchedulePriority | 'all' }))}
            options={[{ value: 'all', label: '전체' }, ...PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))]} />
        </div>
      </Card>

      {/* List + detail */}
      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <Card title="일정 목록" icon={<CalendarDays className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{items.length}건</span>}>
          <ol className="max-h-[34rem] space-y-1.5 overflow-y-auto pr-1">
            {items.map((i) => (
              <ScheduleRow key={i.scheduleId} item={i} selected={i.scheduleId === snapshot.selectedScheduleId}
                onSelect={() => scheduleRepository.selectItem(i.scheduleId)} />
            ))}
            {items.length === 0 ? <li className="px-2 py-4 text-sm text-slate-500">조건에 맞는 일정이 없습니다.</li> : null}
          </ol>
        </Card>

        {selected ? <ScheduleDetail item={selected} /> : <EmptyDetail />}
      </div>
    </div>
  )
}

// --- shared action board ----------------------------------------------------

const BOARD_TONE: Record<string, { border: string; text: string }> = {
  sky: { border: 'border-sky-500/20 bg-sky-500/5', text: 'text-sky-300/70' },
  rose: { border: 'border-rose-500/20 bg-rose-500/10', text: 'text-rose-300/70' },
  slate: { border: 'border-slate-800 bg-slate-900/40', text: 'text-slate-500' }
}

function ActionBoard({
  title,
  icon,
  items,
  selectedId,
  tone,
  emptyLabel
}: {
  title: string
  icon: ReactNode
  items: ScheduleItem[]
  selectedId: string | null
  tone: 'sky' | 'rose' | 'slate'
  emptyLabel: string
}): JSX.Element {
  const t = BOARD_TONE[tone]
  return (
    <Card title={title} icon={icon} action={<span className="text-xs text-slate-500">{items.length}건</span>}>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyLabel}</p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {items.map((i) => (
            <li key={i.scheduleId}>
              <button
                type="button"
                onClick={() => scheduleRepository.selectItem(i.scheduleId)}
                className={[
                  'flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-2 text-left transition',
                  i.scheduleId === selectedId ? 'border-indigo-500/40 bg-indigo-500/10' : t.border
                ].join(' ')}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-200">{i.title}</div>
                  <div className={['truncate text-[11px]', t.text].join(' ')}>{i.fcName} · {i.customerName ?? '—'} · {KIND_LABEL[i.kind]}</div>
                </div>
                <span className="shrink-0 text-[11px] text-slate-500">{formatTime(i.startAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// --- schedule list row ------------------------------------------------------

function ScheduleRow({
  item,
  selected,
  onSelect
}: {
  item: ScheduleItem
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
        <span className={['shrink-0 text-[11px] font-semibold', PRIORITY_TONE[item.priority]].join(' ')}>{item.priority}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-100">{item.title}</div>
          <div className="flex items-center gap-1 truncate text-[11px] text-slate-500">
            {KIND_ICON[item.kind]}
            {item.fcName} · {item.customerName ?? '—'}
          </div>
        </div>
        {isToday(item.startAt) ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" title="오늘" /> : null}
        <span className={['shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]', STATUS_TONE[item.status]].join(' ')}>
          {STATUS_LABEL[item.status]}
        </span>
      </button>
    </li>
  )
}

// --- selected schedule detail -----------------------------------------------

function ScheduleDetail({ item }: { item: ScheduleItem }): JSX.Element {
  const id = item.scheduleId
  const linked = item.customerId ? scheduleRepository.listByCustomer(item.customerId) : []

  const promptMemo = (): void => {
    const text = window.prompt(`${item.title} 메모 추가`)
    if (text) scheduleRepository.addMemo(id, text)
  }
  const promptNextAction = (): void => {
    const text = window.prompt('다음 액션', item.nextAction)
    if (text === null) return
    scheduleRepository.updateNextAction(id, text)
  }
  const promptReschedule = (): void => {
    const raw = window.prompt('새 일정 (YYYY-MM-DD HH:mm)', '')
    if (!raw) return
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) return
    scheduleRepository.reschedule(id, parsed.toISOString())
  }
  const promptAssign = (): void => {
    const roster = fcRepository.listMembers().map((m) => `${m.fcId} · ${m.name} (${m.team})`).join('\n')
    const fcId = window.prompt(`FC 배정 — FC ID 입력\n\n${roster}`, item.fcId)
    if (fcId) scheduleRepository.assignToFc(id, fcId.trim())
  }
  const promptPriority = (): void => {
    const p = window.prompt('우선순위 (P0/P1/P2/P3)', item.priority)
    if (p && ['P0', 'P1', 'P2', 'P3'].includes(p)) scheduleRepository.changePriority(id, p as SchedulePriority)
  }

  return (
    <div className="space-y-5">
      <Card
        title="일정 상세"
        icon={<CalendarDays className="h-4 w-4" />}
        action={<span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_TONE[item.status]].join(' ')}>{STATUS_LABEL[item.status]}</span>}
      >
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={['text-xs font-semibold', PRIORITY_TONE[item.priority]].join(' ')}>{item.priority}</span>
              <span className="text-lg font-semibold text-slate-100">{item.title}</span>
            </div>
            <p className="mt-1 text-sm text-slate-400">{item.description || '설명 없음'}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="유형" value={KIND_LABEL[item.kind]} />
            <Field label="담당 FC" value={`${item.fcName} · ${item.team}`} />
            <Field label="고객" value={item.customerName ?? '—'} />
            <Field label="시작" value={formatDateTime(item.startAt)} />
            <Field label="종료" value={formatDateTime(item.endAt)} />
            <Field label="장소" value={item.location || '—'} />
            <Field label="완료 일시" value={formatDateTime(item.completedAt)} />
            <Field label="다음 액션" value={item.nextAction || '—'} />
          </div>

          {item.result ? (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">결과: {item.result}</div>
          ) : null}
          {item.memo ? (
            <div className="whitespace-pre-line rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">{item.memo}</div>
          ) : null}
        </div>
      </Card>

      {/* Quick actions */}
      <Card title="빠른 작업" icon={<Target className="h-4 w-4" />}>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton icon={<CircleCheck className="h-4 w-4" />} onClick={() => scheduleRepository.confirmItem(id)}>확정</ActionButton>
          <ActionButton icon={<PlayCircle className="h-4 w-4" />} onClick={() => scheduleRepository.markInProgress(id)}>진행중</ActionButton>
          <ActionButton icon={<CheckCircle2 className="h-4 w-4" />} variant="primary" onClick={() => scheduleRepository.markCompleted(id)}>완료</ActionButton>
          <ActionButton icon={<CalendarX className="h-4 w-4" />} onClick={() => scheduleRepository.markMissed(id)}>미이행</ActionButton>
          <ActionButton icon={<XCircle className="h-4 w-4" />} onClick={() => scheduleRepository.markCancelled(id)}>취소</ActionButton>
          <ActionButton icon={<StickyNote className="h-4 w-4" />} onClick={promptMemo}>메모</ActionButton>
          <ActionButton icon={<Target className="h-4 w-4" />} onClick={promptNextAction}>다음 액션</ActionButton>
          <ActionButton icon={<CalendarClock className="h-4 w-4" />} onClick={promptReschedule}>일정 변경</ActionButton>
          <ActionButton icon={<ArrowRightLeft className="h-4 w-4" />} onClick={promptAssign}>FC 배정</ActionButton>
          <ActionButton icon={<Flag className="h-4 w-4" />} onClick={promptPriority}>우선순위</ActionButton>
        </div>
      </Card>

      {/* Customer-linked schedule timeline */}
      {item.customerId ? (
        <Card title="고객 연결 일정 타임라인" icon={<CalendarDays className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{linked.length}건</span>}>
          <ol className="space-y-2">
            {linked.map((i) => (
              <li key={i.scheduleId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-200">{KIND_LABEL[i.kind]} · {i.title}</div>
                  <div className="text-[11px] text-slate-500">{formatDateTime(i.startAt)}</div>
                </div>
                <span className={['shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]', STATUS_TONE[i.status]].join(' ')}>{STATUS_LABEL[i.status]}</span>
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
    <Card title="일정 선택" icon={<CalendarDays className="h-4 w-4" />}>
      <p className="text-sm text-slate-500">캘린더 또는 목록에서 일정을 선택하면 상세 정보와 작업이 표시됩니다.</p>
    </Card>
  )
}

// --- presentational helpers -------------------------------------------------

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
