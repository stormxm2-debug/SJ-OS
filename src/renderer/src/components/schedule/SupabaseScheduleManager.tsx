import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Plus,
  RefreshCw,
  Loader2,
  AlertTriangle,
  X,
  ChevronLeft,
  ChevronRight,
  CalendarSearch,
  Sparkles,
  CheckCircle2,
  NotebookPen,
  UserRound,
  MapPin,
  Navigation,
  Pencil,
  Trash2
} from 'lucide-react'
import type { CustomerRecord, ScheduleAiBrief } from '@shared/commercial/models'
import { listCustomers } from '@renderer/services/commercial/customerService'
import {
  createScheduleEvent,
  finishMeeting,
  listScheduleEvents,
  requestMeetingBrief,
  requestScheduleParse,
  updateScheduleEvent,
  updateScheduleStatus,
  type ParsedSchedule,
  type ScheduleWithCustomer
} from '@renderer/services/commercial/scheduleService'
import {
  buildScheduleTitle,
  SCHEDULE_TYPE_LABEL,
  SCHEDULE_TYPES,
  type ScheduleType
} from '@renderer/services/commercial/scheduleValidation'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'
import { takeSchedulePrefill } from '@renderer/services/commercial/schedulePrefillStore'
import { deleteScheduleRecord } from '@renderer/services/commercial/recordDeleteService'

/**
 * 일정관리 v3 — 주간 중심 + AI 한줄 등록.
 *
 *  - AI 한줄 등록: "내일 2시 김민준 2차만남 강남역" → parse-schedule이 해석 →
 *    미리보기 확인 → 등록.
 *  - 날짜 무제한: 주간 칩 + date 입력으로 몇 달 뒤든 선택.
 *  - 고객: 고객관리 목록 선택 또는 이름 직접 입력(고객관리에 없어도 등록).
 *  - 주소/장소 입력 → 카드에서 카카오맵·티맵 바로 연결 (폰 네비).
 *  - 수정: 예정 일정 = 전체 필드, 완료 일정 = 메모·주소만 (사용자 승인 범위).
 *  - 종료시간 없음: 미팅 메모 저장 순간 = 종료(status done) + AI 비서 분석.
 * RLS가 실제 접근 경계. 메모/PII는 로깅하지 않는다.
 */

const RT_TABLES = ['schedule_events']

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']

const TYPE_BADGE: Record<string, string> = {
  ap: 'bg-violet-50 text-violet-700',
  'meeting-1': 'bg-sky-50 text-sky-700',
  'meeting-2': 'bg-teal-50 text-teal-700',
  'meeting-3': 'bg-emerald-50 text-emerald-700',
  closing: 'bg-amber-50 text-amber-700',
  delivery: 'bg-rose-50 text-rose-600',
  'intro-meeting': 'bg-orange-50 text-orange-700',
  meeting: 'bg-indigo-50 text-indigo-600',
  personal: 'bg-slate-950 text-slate-400'
}
const TYPE_SELECTED_RING: Record<string, string> = {
  ap: 'ring-violet-400',
  'meeting-1': 'ring-sky-400',
  'meeting-2': 'ring-teal-400',
  'meeting-3': 'ring-emerald-400',
  closing: 'ring-amber-400',
  delivery: 'ring-rose-400',
  'intro-meeting': 'ring-orange-400',
  meeting: 'ring-indigo-400',
  personal: 'ring-slate-500'
}

function typeBadgeClass(type: string): string {
  return TYPE_BADGE[type] ?? 'bg-slate-950 text-slate-400'
}
function typeLabel(type: string): string {
  return (SCHEDULE_TYPE_LABEL as Record<string, string>)[type] ?? type
}

// --- 날짜 도우미 (로컬 시간 기준) --------------------------------------------

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function mondayOf(d: Date): Date {
  const s = startOfDay(d)
  return new Date(s.getTime() - ((s.getDay() + 6) % 7) * 86400000)
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000)
}
function ymd(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function sameDay(a: Date, b: Date): boolean {
  return ymd(a) === ymd(b)
}
function hhmm(iso?: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function fromDateStr(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

const TIME_CHIPS: string[] = (() => {
  const out: string[] = []
  for (let h = 7; h <= 21; h++) {
    out.push(`${String(h).padStart(2, '0')}:00`)
    out.push(`${String(h).padStart(2, '0')}:30`)
  }
  return out
})()

/** 등록/수정 폼 상태. */
interface FormState {
  editingId: string | null
  type: ScheduleType
  customerMode: 'list' | 'manual'
  customerId: string
  manualName: string
  day: Date
  time: string
  location: string
  hint?: string
}

function defaultForm(day: Date): FormState {
  return {
    editingId: null,
    type: 'ap',
    customerMode: 'list',
    customerId: '',
    manualName: '',
    day,
    time: '10:00',
    location: '',
    hint: undefined
  }
}

export default function SupabaseScheduleManager(): JSX.Element {
  const [events, setEvents] = useState<ScheduleWithCustomer[]>([])
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDay, setSelectedDay] = useState<Date>(startOfDay(new Date()))
  const [showMonth, setShowMonth] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(() => defaultForm(startOfDay(new Date())))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | undefined>()

  // AI 한줄 등록
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiPreview, setAiPreview] = useState<ParsedSchedule | undefined>()
  const [aiError, setAiError] = useState<string | undefined>()

  const weekStart = useMemo(() => addDays(mondayOf(new Date()), weekOffset * 7), [weekOffset])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const today = startOfDay(new Date())

  const load = async (): Promise<void> => {
    const [sRes, cRes] = await Promise.all([listScheduleEvents(), listCustomers()])
    setEvents(sRes.events)
    setCustomers(cRes.customers)
    setError(sRes.ok ? undefined : sRes.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // 상담기록의 "일정으로 등록" 버튼에서 넘어온 프리필이 있으면 등록 폼 자동 오픈.
    const p = takeSchedulePrefill()
    if (p) openCreate(p.type, { customerId: p.customerId, hint: p.hint })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useRealtimeSync(RT_TABLES, load)

  const eventsOf = (d: Date): ScheduleWithCustomer[] =>
    events
      .filter((ev) => {
        const t = Date.parse(ev.startsAt)
        return !Number.isNaN(t) && sameDay(new Date(t), d)
      })
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))

  const dayEvents = eventsOf(selectedDay)
  const monthLabel = `${selectedDay.getFullYear()}년 ${selectedDay.getMonth() + 1}월`

  const pickDay = (d: Date): void => {
    setSelectedDay(d)
    const diff = Math.round((mondayOf(d).getTime() - mondayOf(new Date()).getTime()) / (7 * 86400000))
    setWeekOffset(diff)
  }

  const openCreate = (type: ScheduleType = 'ap', opts?: { customerId?: string; manualName?: string; day?: Date; time?: string; location?: string; hint?: string }): void => {
    setForm({
      editingId: null,
      type,
      customerMode: opts?.manualName ? 'manual' : 'list',
      customerId: opts?.customerId ?? '',
      manualName: opts?.manualName ?? '',
      day: opts?.day ?? (selectedDay >= today ? selectedDay : today),
      time: opts?.time ?? '10:00',
      location: opts?.location ?? '',
      hint: opts?.hint
    })
    setFormError(undefined)
    setShowForm(true)
  }

  const openEdit = (ev: ScheduleWithCustomer): void => {
    const t = new Date(Date.parse(ev.startsAt))
    setForm({
      editingId: ev.id,
      type: (SCHEDULE_TYPES.includes(ev.type as ScheduleType) ? ev.type : 'meeting') as ScheduleType,
      customerMode: ev.customerId ? 'list' : ev.manualCustomerName ? 'manual' : 'list',
      customerId: ev.customerId ?? '',
      manualName: ev.manualCustomerName ?? '',
      day: startOfDay(t),
      time: hhmm(ev.startsAt) || '10:00',
      location: ev.location ?? '',
      hint: undefined
    })
    setFormError(undefined)
    setShowForm(true)
  }

  const submitForm = async (): Promise<void> => {
    const [h, m] = form.time.split(':').map(Number)
    const starts = new Date(form.day.getFullYear(), form.day.getMonth(), form.day.getDate(), h || 0, m || 0)
    const manual = form.customerMode === 'manual'
    const customerName = manual ? form.manualName.trim() : customers.find((c) => c.id === form.customerId)?.name
    setSaving(true)
    setFormError(undefined)
    const payload = {
      title: buildScheduleTitle(form.type, customerName),
      type: form.type,
      status: 'planned' as const,
      customerId: manual ? '' : form.customerId,
      manualCustomerName: manual ? form.manualName.trim() : '',
      startsAt: starts.toISOString(),
      location: form.location
    }
    const res = form.editingId
      ? await updateScheduleEvent(form.editingId, payload)
      : await createScheduleEvent({ ...payload, endsAt: '', memo: '' })
    setSaving(false)
    if (!res.ok) {
      setFormError(res.error ?? '일정 저장에 실패했습니다.')
      return
    }
    setShowForm(false)
    pickDay(startOfDay(starts))
    void load()
  }

  // --- AI 한줄 등록 ---------------------------------------------------------

  const runAiParse = async (): Promise<void> => {
    if (!aiText.trim()) return
    setAiBusy(true)
    setAiError(undefined)
    setAiPreview(undefined)
    const res = await requestScheduleParse(aiText.trim(), customers.map((c) => c.name))
    setAiBusy(false)
    if (!res.ok || !res.parsed) {
      setAiError(res.error)
      return
    }
    setAiPreview(res.parsed)
  }

  const confirmAiRegister = async (): Promise<void> => {
    if (!aiPreview) return
    const type = (SCHEDULE_TYPES.includes(aiPreview.type as ScheduleType) ? aiPreview.type : 'meeting') as ScheduleType
    const match = aiPreview.customerName ? customers.find((c) => c.name === aiPreview.customerName) : undefined
    const day = fromDateStr(aiPreview.date) ?? today
    const [h, m] = aiPreview.time.split(':').map(Number)
    const starts = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 10, m || 0)
    setAiBusy(true)
    const res = await createScheduleEvent({
      title: buildScheduleTitle(type, aiPreview.customerName),
      type,
      status: 'planned',
      customerId: match?.id,
      manualCustomerName: match ? undefined : aiPreview.customerName,
      startsAt: starts.toISOString(),
      endsAt: '',
      memo: '',
      location: aiPreview.location
    })
    setAiBusy(false)
    if (!res.ok) {
      setAiError(res.error ?? '등록에 실패했습니다.')
      return
    }
    setAiText('')
    setAiPreview(undefined)
    pickDay(startOfDay(starts))
    void load()
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-100">일정관리</h2>
            <span className="text-sm font-semibold text-slate-400">{monthLabel}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void load()}
              aria-label="새로고침"
              className="rounded-lg border border-slate-800 bg-white p-2 text-slate-400 transition hover:text-slate-200"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowMonth((v) => !v)}
              className={[
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-semibold transition',
                showMonth ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-slate-800 bg-white text-slate-400 hover:text-slate-200'
              ].join(' ')}
            >
              <CalendarSearch className="h-3.5 w-3.5" /> 달력
            </button>
            <button
              type="button"
              onClick={() => (showForm ? setShowForm(false) : openCreate())}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-110"
            >
              {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {showForm ? '닫기' : '일정 등록'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        ) : null}

        {/* AI 한줄 등록 */}
        <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-2.5">
          <div className="flex gap-2">
            <input
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runAiParse()
              }}
              placeholder='말하듯 쓰면 AI가 등록: "내일 오후 2시 김민준 2차만남, 강남역 스타벅스"'
              className="w-full rounded-lg border border-slate-800 bg-white px-3 py-2 text-[13px] text-slate-100 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void runAiParse()}
              disabled={aiBusy || !aiText.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
            >
              {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} AI 등록
            </button>
          </div>
          {aiError ? <p className="mt-1.5 text-[11px] text-rose-600">{aiError}</p> : null}
          {aiPreview ? (
            <div className="mt-2 rounded-lg border border-indigo-200 bg-white p-2.5">
              <div className="mb-1.5 text-[10px] font-bold text-indigo-600">AI가 이해한 일정 — 확인 후 등록하세요</div>
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className={['rounded-full px-2 py-0.5 text-[11px] font-bold', typeBadgeClass(aiPreview.type)].join(' ')}>{typeLabel(aiPreview.type)}</span>
                {aiPreview.customerName ? <span className="font-semibold text-slate-100">{aiPreview.customerName}</span> : null}
                <span className="text-slate-400">
                  {aiPreview.date} {aiPreview.time}
                </span>
                {aiPreview.location ? (
                  <span className="inline-flex items-center gap-0.5 text-slate-400">
                    <MapPin className="h-3 w-3" /> {aiPreview.location}
                  </span>
                ) : null}
                <span className="ml-auto flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAiPreview(undefined)}
                    className="rounded-lg border border-slate-800 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-400"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmAiRegister()}
                    disabled={aiBusy}
                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-3 w-3" /> 이대로 등록
                  </button>
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* 주간 띠 */}
        <div className="mt-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const d = addDays(weekStart, -7)
              setWeekOffset((v) => v - 1)
              setSelectedDay(d)
            }}
            aria-label="이전 주"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-950 hover:text-slate-200"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="grid flex-1 grid-cols-7 gap-1.5">
            {weekDays.map((d) => {
              const cnt = eventsOf(d).length
              const isSel = sameDay(d, selectedDay)
              const isToday = sameDay(d, today)
              const dow = d.getDay()
              return (
                <button
                  key={ymd(d)}
                  type="button"
                  onClick={() => setSelectedDay(d)}
                  className={[
                    'rounded-xl border px-1 py-2 text-center transition',
                    isSel ? 'border-indigo-400 bg-indigo-50' : 'border-slate-800 bg-white hover:border-indigo-300'
                  ].join(' ')}
                >
                  <div className={['text-[10px] font-medium', dow === 0 ? 'text-rose-500' : dow === 6 ? 'text-sky-600' : 'text-slate-500'].join(' ')}>
                    {DAY_NAMES[dow]}
                  </div>
                  <div className={['text-sm font-bold tabular-nums', isSel ? 'text-indigo-700' : 'text-slate-200'].join(' ')}>
                    {d.getDate()}
                    {isToday ? <span className="ml-0.5 align-middle text-[8px] text-indigo-500">●</span> : null}
                  </div>
                  <div className={['text-[10px]', cnt > 0 ? 'font-semibold text-indigo-600' : 'text-slate-600'].join(' ')}>
                    {cnt > 0 ? `${cnt}건` : '·'}
                  </div>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              const d = addDays(weekStart, 7)
              setWeekOffset((v) => v + 1)
              setSelectedDay(d)
            }}
            aria-label="다음 주"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-950 hover:text-slate-200"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {weekOffset !== 0 ? (
          <div className="mt-1.5 text-right">
            <button type="button" onClick={() => pickDay(today)} className="text-[11px] font-medium text-indigo-600 hover:underline">
              오늘로 돌아가기
            </button>
          </div>
        ) : null}

        {showMonth ? <MonthCalendar eventsOf={eventsOf} onPick={(d) => pickDay(d)} /> : null}
      </div>

      {/* 등록/수정 폼 */}
      {showForm ? (
        <div className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-bold text-slate-100">{form.editingId ? '일정 수정' : '새 일정 등록'}</div>
            <span className="text-[11px] text-slate-500">일정명·종료시간 없음 — 메모 저장 시 자동 종료</span>
          </div>
          {form.hint ? (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[12px] text-indigo-700">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" /> AI 제안: {form.hint}
            </div>
          ) : null}

          <div className="mb-1.5 text-[11px] font-medium text-slate-500">유형</div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {SCHEDULE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setForm((f) => ({ ...f, type: t }))}
                className={[
                  'rounded-full px-3 py-1.5 text-[12px] font-semibold transition',
                  typeBadgeClass(t),
                  form.type === t ? `ring-2 ${TYPE_SELECTED_RING[t] ?? 'ring-indigo-400'}` : 'opacity-70 hover:opacity-100'
                ].join(' ')}
              >
                {SCHEDULE_TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-slate-500">
                고객 (선택)
                <span className="flex overflow-hidden rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, customerMode: 'list' }))}
                    className={['px-2 py-0.5 text-[10px] font-semibold transition', form.customerMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-400'].join(' ')}
                  >
                    목록
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, customerMode: 'manual' }))}
                    className={['px-2 py-0.5 text-[10px] font-semibold transition', form.customerMode === 'manual' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-400'].join(' ')}
                  >
                    직접 입력
                  </button>
                </span>
              </div>
              {form.customerMode === 'list' ? (
                <select
                  value={form.customerId}
                  onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}
                  className="w-full rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-sm text-slate-200 focus:outline-none"
                >
                  <option value="">고객 없음</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={form.manualName}
                  onChange={(e) => setForm((f) => ({ ...f, manualName: e.target.value }))}
                  placeholder="고객 이름 입력 (고객관리에 없어도 됨)"
                  className="w-full rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-sm text-slate-100 focus:outline-none"
                />
              )}
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-medium text-slate-500">
                날짜 — {form.day.getFullYear()}년 {form.day.getMonth() + 1}월 {form.day.getDate()}일 ({DAY_NAMES[form.day.getDay()]})
              </div>
              <div className="flex items-center gap-1.5">
                <div className="grid flex-1 grid-cols-7 gap-1">
                  {Array.from({ length: 7 }, (_, i) => addDays(mondayOf(form.day), i)).map((d) => {
                    const sel = sameDay(d, form.day)
                    return (
                      <button
                        key={ymd(d)}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, day: d }))}
                        className={[
                          'rounded-lg border py-1.5 text-center transition',
                          sel ? 'border-indigo-400 bg-indigo-50 font-bold text-indigo-700' : 'border-slate-800 bg-white text-slate-300 hover:border-indigo-300'
                        ].join(' ')}
                      >
                        <div className="text-[9px] text-slate-500">{DAY_NAMES[d.getDay()]}</div>
                        <div className="text-[12px] tabular-nums">{d.getDate()}</div>
                      </button>
                    )
                  })}
                </div>
                <input
                  type="date"
                  value={ymd(form.day)}
                  onChange={(e) => {
                    const d = fromDateStr(e.target.value)
                    if (d) setForm((f) => ({ ...f, day: d }))
                  }}
                  aria-label="다른 날짜 선택"
                  className="rounded-lg border border-slate-800 bg-white px-2 py-2 text-[11px] font-medium text-slate-300 focus:outline-none"
                />
              </div>
              <div className="mt-1 text-[10px] text-slate-500">오른쪽 달력으로 몇 달 뒤 날짜도 선택 가능</div>
            </div>
          </div>

          <div className="mb-3">
            <div className="mb-1.5 text-[11px] font-medium text-slate-500">장소 / 주소 (선택) — 폰에서 네비로 바로 연결됩니다</div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-white px-3">
              <MapPin className="h-4 w-4 shrink-0 text-slate-500" />
              <input
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                placeholder='예: 서울 강남구 테헤란로 152 또는 "강남역 2번출구 스타벅스"'
                className="w-full py-2.5 text-sm text-slate-100 focus:outline-none"
              />
            </div>
          </div>

          <div className="mb-1.5 text-[11px] font-medium text-slate-500">시작 시간 (30분 단위) — 현재 {form.time}</div>
          <div className="mb-4 flex flex-wrap gap-1">
            {TIME_CHIPS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setForm((f) => ({ ...f, time: t }))}
                className={[
                  'rounded-lg border px-2 py-1.5 text-[11px] font-medium tabular-nums transition',
                  form.time === t ? 'border-indigo-400 bg-indigo-50 font-bold text-indigo-700' : 'border-slate-800 bg-white text-slate-400 hover:border-indigo-300'
                ].join(' ')}
              >
                {t}
              </button>
            ))}
          </div>

          {formError ? <p className="mb-2 text-[12px] text-rose-600">{formError}</p> : null}
          <button
            type="button"
            onClick={() => void submitForm()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : form.editingId ? <CheckCircle2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {form.editingId ? '수정 저장' : `${typeLabel(form.type)} ${form.time} 등록`}
          </button>
        </div>
      ) : null}

      {/* 선택한 날의 일정 카드 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-bold text-slate-100">
            {selectedDay.getMonth() + 1}월 {selectedDay.getDate()}일 ({DAY_NAMES[selectedDay.getDay()]}) · {dayEvents.length}건
          </div>
          {sameDay(selectedDay, today) ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">오늘</span> : null}
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 일정을 불러오는 중…
          </div>
        ) : dayEvents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 py-8 text-center text-[12px] text-slate-500">
            이 날의 일정이 없습니다. 위의 <b className="text-slate-300">AI 등록</b>이나 <b className="text-slate-300">일정 등록</b>으로 추가하세요.
          </div>
        ) : (
          <div className="space-y-2.5">
            {dayEvents.map((ev) => (
              <EventCard
                key={ev.id}
                event={ev}
                today={today}
                onChanged={load}
                onEdit={openEdit}
                onRegisterNext={(type, customerId, hint) => openCreate(type, { customerId, hint })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// --- 네비 연결 버튼 (카카오맵 + 티맵) -----------------------------------------

function NavButtons({ location }: { location: string }): JSX.Element {
  const enc = encodeURIComponent(location)
  return (
    <span className="inline-flex items-center gap-1">
      <a
        href={`https://map.kakao.com/link/search/${enc}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-full bg-[#FEE500] px-2.5 py-1 text-[10px] font-bold text-[#3C1E1E] transition hover:brightness-95"
      >
        <Navigation className="h-3 w-3" /> 카카오맵
      </a>
      <a
        href={`tmap://search?name=${enc}`}
        className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-bold text-sky-700 transition hover:bg-sky-100"
      >
        <Navigation className="h-3 w-3" /> 티맵
      </a>
    </span>
  )
}

// --- 일정 카드 ----------------------------------------------------------------

function EventCard({
  event,
  today,
  onChanged,
  onEdit,
  onRegisterNext
}: {
  event: ScheduleWithCustomer
  today: Date
  onChanged: () => void
  onEdit: (ev: ScheduleWithCustomer) => void
  onRegisterNext: (type: ScheduleType, customerId?: string, hint?: string) => void
}): JSX.Element {
  const [memo, setMemo] = useState(event.memo ?? '')
  const [finishing, setFinishing] = useState(false)
  const [analysisNote, setAnalysisNote] = useState<string | undefined>()

  // 완료 일정: 메모·주소만 수정 (승인 범위)
  const [editDone, setEditDone] = useState(false)
  const [doneMemo, setDoneMemo] = useState(event.memo ?? '')
  const [doneLocation, setDoneLocation] = useState(event.location ?? '')
  const [doneSaving, setDoneSaving] = useState(false)

  const started = Date.parse(event.startsAt) <= Date.now()
  const eventDay = startOfDay(new Date(Date.parse(event.startsAt)))
  const isPastOrToday = eventDay.getTime() <= today.getTime()
  const isActive = event.status === 'planned' && isPastOrToday
  const isPlanned = event.status === 'planned'
  const isDone = event.status === 'done'
  const isCancelled = event.status === 'cancelled'

  const finish = async (): Promise<void> => {
    if (!memo.trim()) {
      setAnalysisNote('미팅 내용을 먼저 적어주세요.')
      return
    }
    setFinishing(true)
    setAnalysisNote('AI 비서가 메모를 분석하는 중…')
    const brief = await requestMeetingBrief({
      memo,
      typeLabel: typeLabel(event.type),
      customerName: event.customerName
    })
    const res = await finishMeeting(event.id, memo, brief)
    setFinishing(false)
    setAnalysisNote(res.ok ? undefined : res.error)
    if (res.ok) onChanged()
  }

  const cancel = async (): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm('이 일정을 취소 처리할까요?')) return
    const res = await updateScheduleStatus(event.id, 'cancelled')
    if (res.ok) onChanged()
  }

  const saveDoneEdit = async (): Promise<void> => {
    setDoneSaving(true)
    const res = await updateScheduleEvent(event.id, { memo: doneMemo, location: doneLocation })
    setDoneSaving(false)
    if (res.ok) {
      setEditDone(false)
      onChanged()
    }
  }

  const remove = async (): Promise<void> => {
    const who = event.customerName ? `${event.customerName} · ` : ''
    if (typeof window !== 'undefined' && !window.confirm(`이 일정(${who}${typeLabel(event.type)})을 완전히 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return
    const res = await deleteScheduleRecord(event.id)
    if (!res.ok) {
      setAnalysisNote(res.error)
      return
    }
    onChanged()
  }

  return (
    <div
      className={[
        'rounded-xl border p-3 transition',
        isActive && started ? 'border-indigo-300 bg-indigo-50/30' : 'border-slate-800 bg-white',
        isCancelled ? 'opacity-50' : ''
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={['rounded-full px-2.5 py-1 text-[11px] font-bold', typeBadgeClass(event.type)].join(' ')}>{typeLabel(event.type)}</span>
        {event.customerName ? (
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-slate-100">
            <UserRound className="h-3.5 w-3.5 text-slate-500" /> {event.customerName}
            {!event.customerId ? <span className="text-[9px] font-medium text-slate-500">(직접입력)</span> : null}
          </span>
        ) : (
          <span className="text-sm text-slate-400">{event.type === 'personal' ? '개인 일정' : '고객 미지정'}</span>
        )}
        <span className="ml-auto text-[12px] tabular-nums text-slate-500">
          {hhmm(event.startsAt)}
          {event.endsAt ? ` ~ ${hhmm(event.endsAt)}` : isActive && started ? ' ~ 진행중' : ''}
        </span>
        {isDone ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">완료</span>
        ) : isCancelled ? (
          <span className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-bold text-slate-500">취소</span>
        ) : (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">예정</span>
        )}
        {isPlanned ? (
          <button
            type="button"
            onClick={() => onEdit(event)}
            aria-label="일정 수정"
            className="rounded-lg border border-slate-800 bg-white p-1.5 text-slate-400 transition hover:border-indigo-300 hover:text-indigo-600"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {isDone ? (
          <button
            type="button"
            onClick={() => {
              setDoneMemo(event.memo ?? '')
              setDoneLocation(event.location ?? '')
              setEditDone((v) => !v)
            }}
            aria-label="메모·주소 수정"
            className="rounded-lg border border-slate-800 bg-white p-1.5 text-slate-400 transition hover:border-indigo-300 hover:text-indigo-600"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void remove()}
          aria-label="일정 삭제"
          className="rounded-lg border border-slate-800 bg-white p-1.5 text-slate-400 transition hover:border-rose-300 hover:text-rose-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 장소 + 네비 */}
      {event.location ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[12px] text-slate-400">
            <MapPin className="h-3.5 w-3.5 text-slate-500" /> {event.location}
          </span>
          <NavButtons location={event.location} />
        </div>
      ) : null}

      {/* 진행중/당일: 미팅 메모 → 저장=종료 */}
      {isActive ? (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
            <NotebookPen className="h-3.5 w-3.5 text-emerald-600" /> 미팅 메모 — 저장하면 이 시각으로 종료됩니다
          </div>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="미팅 내용을 적어주세요. 고객 니즈·금액·다음 약속(예: 다음 주 화요일 저녁)을 적으면 AI 비서가 정리해 드립니다."
            className="h-24 w-full rounded-xl border border-slate-800 bg-white px-3 py-2 text-[13px] leading-6 text-slate-100 focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => void cancel()} className="text-[11px] text-slate-500 hover:text-rose-600">
              일정 취소
            </button>
            <button
              type="button"
              onClick={() => void finish()}
              disabled={finishing}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-[13px] font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
            >
              {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              메모 저장하고 종료
            </button>
          </div>
          {analysisNote ? <p className="mt-1.5 text-[11px] text-slate-500">{analysisNote}</p> : null}
        </div>
      ) : null}

      {/* 완료: 메모·주소 수정 (승인 범위: 이 둘만) */}
      {isDone && editDone ? (
        <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
          <div className="mb-1 text-[11px] font-semibold text-slate-300">메모 수정</div>
          <textarea
            value={doneMemo}
            onChange={(e) => setDoneMemo(e.target.value)}
            className="h-20 w-full rounded-lg border border-slate-800 bg-white px-3 py-2 text-[13px] leading-6 text-slate-100 focus:outline-none"
          />
          <div className="mb-1 mt-2 text-[11px] font-semibold text-slate-300">장소/주소 수정</div>
          <input
            value={doneLocation}
            onChange={(e) => setDoneLocation(e.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-white px-3 py-2 text-[13px] text-slate-100 focus:outline-none"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button type="button" onClick={() => setEditDone(false)} className="rounded-lg border border-slate-800 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-400">
              취소
            </button>
            <button
              type="button"
              onClick={() => void saveDoneEdit()}
              disabled={doneSaving}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {doneSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} 저장
            </button>
          </div>
        </div>
      ) : null}

      {/* 완료: 메모 + AI 비서 분석 */}
      {isDone && !editDone && event.memo ? (
        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[12px] leading-6 text-slate-300">{event.memo}</div>
      ) : null}
      {isDone && !editDone && event.aiBrief ? <AiBriefBox brief={event.aiBrief} customerId={event.customerId} onRegisterNext={onRegisterNext} /> : null}
    </div>
  )
}

function AiBriefBox({
  brief,
  customerId,
  onRegisterNext
}: {
  brief: ScheduleAiBrief
  customerId?: string
  onRegisterNext: (type: ScheduleType, customerId?: string, hint?: string) => void
}): JSX.Element {
  return (
    <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-indigo-700">
        <Sparkles className="h-3.5 w-3.5" /> AI 비서 분석
      </div>
      <p className="text-[12px] leading-6 text-slate-200">{brief.summary}</p>
      {brief.todos.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {brief.todos.map((t, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[12px] leading-5 text-slate-300">
              <span className="mt-0.5 text-indigo-500">☐</span> {t}
            </li>
          ))}
        </ul>
      ) : null}
      {brief.next ? (
        <button
          type="button"
          onClick={() => onRegisterNext(brief.next!.type as ScheduleType, customerId, brief.next!.suggestion)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-indigo-300 bg-white px-3 py-1.5 text-[11px] font-bold text-indigo-600 transition hover:bg-indigo-50"
        >
          <Plus className="h-3 w-3" /> {brief.next.suggestion} → 등록
        </button>
      ) : null}
    </div>
  )
}

// --- 월 달력 (토글) -----------------------------------------------------------

function MonthCalendar({ eventsOf, onPick }: { eventsOf: (d: Date) => unknown[]; onPick: (d: Date) => void }): JSX.Element {
  const now = new Date()
  const [viewYm, setViewYm] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() })
  const first = new Date(viewYm.y, viewYm.m, 1)
  const gridStart = mondayOf(first)
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const today = startOfDay(new Date())

  return (
    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setViewYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}
          aria-label="이전 달"
          className="rounded p-1 text-slate-400 hover:text-slate-200"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-[12px] font-bold text-slate-200">
          {viewYm.y}년 {viewYm.m + 1}월
        </div>
        <button
          type="button"
          onClick={() => setViewYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}
          aria-label="다음 달"
          className="rounded p-1 text-slate-400 hover:text-slate-200"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {DAY_NAMES.slice(1).concat(DAY_NAMES[0]).map((n) => (
          <div key={n} className="py-1 text-[10px] font-medium text-slate-500">
            {n}
          </div>
        ))}
        {cells.map((d) => {
          const inMonth = d.getMonth() === viewYm.m
          const cnt = eventsOf(d).length
          const isToday = sameDay(d, today)
          return (
            <button
              key={ymd(d)}
              type="button"
              onClick={() => onPick(d)}
              className={[
                'rounded-lg py-1.5 text-[11px] tabular-nums transition hover:bg-indigo-50',
                inMonth ? 'text-slate-200' : 'text-slate-600',
                isToday ? 'bg-indigo-50 font-bold text-indigo-700' : ''
              ].join(' ')}
            >
              {d.getDate()}
              <div className={['mx-auto mt-0.5 h-1 w-1 rounded-full', cnt > 0 ? 'bg-indigo-500' : 'bg-transparent'].join(' ')} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
