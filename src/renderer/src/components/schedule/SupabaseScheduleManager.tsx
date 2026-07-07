import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Plus, Search, RefreshCw, Loader2, AlertTriangle, Save, X, Database, HardDrive, CheckCircle2, CalendarClock } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { CustomerRecord } from '@shared/commercial/models'
import { listCustomers } from '@renderer/services/commercial/customerService'
import { CONSULTATION_TYPE_LABEL } from '@renderer/services/commercial/consultationValidation'
import type { ConsultationWithCustomer } from '@renderer/services/commercial/consultationService'
import {
  createScheduleEvent,
  filterThisWeek,
  filterToday,
  listScheduleEvents,
  listScheduledConsultations,
  searchScheduleEvents,
  updateScheduleEvent,
  type ScheduleDataMode,
  type ScheduleWithCustomer
} from '@renderer/services/commercial/scheduleService'
import {
  CUSTOMER_LINKED_TYPES,
  SCHEDULE_STATUS_LABEL,
  SCHEDULE_STATUSES,
  SCHEDULE_TYPE_LABEL,
  SCHEDULE_TYPES,
  validateScheduleInput,
  type ScheduleInput,
  type ScheduleStatus,
  type ScheduleType
} from '@renderer/services/commercial/scheduleValidation'

/**
 * 일정관리 (Supabase-connected). Lists/creates/updates schedule events via
 * scheduleService (Supabase when configured + logged in, else local-mock). RLS
 * enforces real access; role guidance + client filters are UX only. Also shows a
 * read-only 상담 예정 section from consultationService. Never renders tokens/keys,
 * never logs memos/PII. Inline cards only; no backdrop.
 */

const emptyForm = (): ScheduleInput => ({ title: '', type: 'consultation', status: 'planned', customerId: '', startsAt: '', endsAt: '', memo: '' })

export default function SupabaseScheduleManager(): JSX.Element {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const [events, setEvents] = useState<ScheduleWithCustomer[]>([])
  const [consults, setConsults] = useState<ConsultationWithCustomer[]>([])
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [mode, setMode] = useState<ScheduleDataMode>('local-mock')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ScheduleStatus | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<ScheduleType | 'all'>('all')
  const [todayOnly, setTodayOnly] = useState(false)
  const [weekOnly, setWeekOnly] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ScheduleInput>(emptyForm)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<ScheduleWithCustomer | null>(null)

  const roleHint = session.role === 'fc' ? '내 일정만 표시됩니다.' : session.role === 'team-leader' ? '팀 일정이 표시됩니다.' : '전체 일정이 표시됩니다.'

  const load = async (): Promise<void> => {
    setLoading(true)
    const [sRes, cRes, custRes] = await Promise.all([listScheduleEvents(), listScheduledConsultations(), listCustomers()])
    setMode(sRes.mode)
    setEvents(sRes.events)
    setConsults(cRes)
    setCustomers(custRes.customers)
    setError(sRes.ok ? undefined : sRes.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = useMemo(() => {
    let v = searchScheduleEvents(events, query, statusFilter, typeFilter)
    if (todayOnly) v = filterToday(v)
    if (weekOnly) v = filterThisWeek(v)
    return v
  }, [events, query, statusFilter, typeFilter, todayOnly, weekOnly])

  const custName = (id?: string): string => (id ? customers.find((c) => c.id === id)?.name ?? '-' : '-')
  const needsCustomer = CUSTOMER_LINKED_TYPES.includes(form.type)
  const noCustomers = customers.length === 0

  const submitCreate = async (): Promise<void> => {
    const v = validateScheduleInput(form)
    setFormErrors(v.errors)
    if (!v.ok) return
    setSaving(true)
    const res = await createScheduleEvent(form)
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setShowForm(false); setForm(emptyForm()); void load()
  }
  const saveEdit = async (): Promise<void> => {
    if (!selected) return
    const input: ScheduleInput = { title: selected.title, type: selected.type, status: selected.status, customerId: selected.customerId, startsAt: selected.startsAt, endsAt: selected.endsAt, memo: selected.memo }
    const v = validateScheduleInput(input)
    setFormErrors(v.errors)
    if (!v.ok) return
    setSaving(true)
    const res = await updateScheduleEvent(selected.id, input)
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setSelected(null); void load()
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-indigo-500" />
          <h2 className="text-base font-bold text-slate-100">일정관리</h2>
          <ModeBadge mode={mode} />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"><RefreshCw className="h-3 w-3" /> 새로고침</button>
          <button type="button" onClick={() => { setShowForm((s) => !s); setSelected(null) }} className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white"><Plus className="h-3 w-3" /> 일정 등록</button>
        </div>
      </div>
      <p className="mb-3 text-[11px] text-slate-500">{roleHint} <span className="text-slate-400">(실제 접근 권한은 Supabase RLS가 적용됩니다.)</span></p>

      {mode === 'not-configured' ? <Notice text="Supabase가 아직 연결되지 않아 로컬 MVP 데이터로 표시됩니다." /> : null}
      {mode === 'no-session' ? <Notice text="Supabase 로그인 후 일정 DB를 사용할 수 있습니다." /> : null}
      {error ? <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600"><AlertTriangle className="mr-1 inline h-3 w-3" />{error}</div> : null}

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="일정/고객 검색" className="w-32 text-[11px] text-slate-300 focus:outline-none" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ScheduleStatus | 'all')} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-300">
          <option value="all">전체 상태</option>
          {SCHEDULE_STATUSES.map((s) => <option key={s} value={s}>{SCHEDULE_STATUS_LABEL[s]}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as ScheduleType | 'all')} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-300">
          <option value="all">전체 유형</option>
          {SCHEDULE_TYPES.map((t) => <option key={t} value={t}>{SCHEDULE_TYPE_LABEL[t]}</option>)}
        </select>
        <Toggle label="오늘" on={todayOnly} onClick={() => { setTodayOnly((v) => !v); setWeekOnly(false) }} />
        <Toggle label="이번 주" on={weekOnly} onClick={() => { setWeekOnly((v) => !v); setTodayOnly(false) }} />
      </div>

      {/* Create form */}
      {showForm ? (
        <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
          <div className="mb-2 text-[11px] font-semibold text-slate-300">새 일정</div>
          <Fields input={form} onChange={setForm} customers={customers} />
          {needsCustomer && noCustomers ? <p className="mt-1 text-[10px] text-amber-600">고객 연결이 필요한 일정은 고객관리에서 고객을 먼저 등록해주세요. <button type="button" onClick={() => navigate({ name: 'customer' })} className="underline">고객관리로 이동</button></p> : null}
          {formErrors.length > 0 ? <ul className="mt-2 space-y-0.5 text-[10px] text-rose-600">{formErrors.map((e) => <li key={e}>• {e}</li>)}</ul> : null}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void submitCreate()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60">{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} 저장</button>
            <button type="button" onClick={() => { setShowForm(false); setFormErrors([]) }} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-[11px] text-slate-600"><X className="h-3 w-3" /> 취소</button>
          </div>
        </div>
      ) : null}

      {/* Schedule list */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> 일정을 불러오는 중입니다.</div>
      ) : visible.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-500"><div>등록된 일정이 없습니다.</div><div className="text-[11px] text-slate-400">첫 일정을 등록해보세요.</div></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-slate-400"><tr className="border-b border-slate-100">
              <th className="py-1.5 pr-2 font-medium">일정명</th>
              <th className="py-1.5 pr-2 font-medium">유형</th>
              <th className="py-1.5 pr-2 font-medium">상태</th>
              <th className="py-1.5 pr-2 font-medium">고객</th>
              <th className="py-1.5 pr-2 font-medium">시작</th>
              <th className="py-1.5 pr-2 font-medium">종료</th>
            </tr></thead>
            <tbody>
              {visible.map((ev) => (
                <tr key={ev.id} onClick={() => { setSelected({ ...ev }); setShowForm(false) }} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-1.5 pr-2 font-medium text-slate-300">{ev.title}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{SCHEDULE_TYPE_LABEL[ev.type]}</td>
                  <td className="py-1.5 pr-2"><StatusChip status={ev.status} /></td>
                  <td className="py-1.5 pr-2 text-slate-500">{ev.customerName ?? custName(ev.customerId)}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{ev.startsAt ? new Date(ev.startsAt).toLocaleString() : '-'}</td>
                  <td className="py-1.5 pr-2 text-slate-400">{ev.endsAt ? new Date(ev.endsAt).toLocaleTimeString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit panel */}
      {selected ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-semibold text-slate-300">일정 상세 / 수정</div>
            <button type="button" onClick={() => { setSelected(null); setFormErrors([]) }} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
          </div>
          <Fields input={{ title: selected.title, type: selected.type, status: selected.status, customerId: selected.customerId ?? '', startsAt: selected.startsAt, endsAt: selected.endsAt ?? '', memo: selected.memo ?? '' }} onChange={(v) => setSelected({ ...selected, title: v.title, type: v.type, status: v.status, customerId: v.customerId, startsAt: v.startsAt, endsAt: v.endsAt, memo: v.memo })} customers={customers} />
          {formErrors.length > 0 ? <ul className="mt-2 space-y-0.5 text-[10px] text-rose-600">{formErrors.map((e) => <li key={e}>• {e}</li>)}</ul> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => void saveEdit()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60">{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} 저장</button>
            {selected.status !== 'done' ? <button type="button" onClick={() => setSelected({ ...selected, status: 'done' })} className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> 완료</button> : null}
            {selected.status !== 'cancelled' ? <button type="button" onClick={() => setSelected({ ...selected, status: 'cancelled' })} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600"><X className="h-3 w-3" /> 취소 처리</button> : null}
          </div>
        </div>
      ) : null}

      {/* Read-only 상담 예정 */}
      {consults.length > 0 ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600"><CalendarClock className="h-3.5 w-3.5 text-indigo-500" /> 상담 예정 (읽기 전용 · 상담기록 연동)</div>
          <div className="space-y-1">
            {consults.slice(0, 8).map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 text-[10px]">
                <span className="text-slate-600">{c.customerName ?? custName(c.customerId)} · {CONSULTATION_TYPE_LABEL[c.consultationType]}</span>
                <span className="text-slate-400">{c.scheduledAt ? new Date(c.scheduledAt).toLocaleString() : ''}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Fields({ input, onChange, customers }: { input: ScheduleInput; onChange: (v: ScheduleInput) => void; customers: CustomerRecord[] }): JSX.Element {
  const set = (patch: Partial<ScheduleInput>): void => onChange({ ...input, ...patch })
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label className="text-[10px] text-slate-500 sm:col-span-2">일정명 *
        <input value={input.title} onChange={(e) => set({ title: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-300" />
      </label>
      <label className="text-[10px] text-slate-500">일정 유형
        <select value={input.type} onChange={(e) => set({ type: e.target.value as ScheduleType })} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-300">
          {SCHEDULE_TYPES.map((t) => <option key={t} value={t}>{SCHEDULE_TYPE_LABEL[t]}</option>)}
        </select>
      </label>
      <label className="text-[10px] text-slate-500">고객 (선택)
        <select value={input.customerId ?? ''} onChange={(e) => set({ customerId: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-300">
          <option value="">없음</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="text-[10px] text-slate-500">시작시간 *
        <input type="datetime-local" value={toLocalInput(input.startsAt)} onChange={(e) => set({ startsAt: fromLocalInput(e.target.value) })} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-300" />
      </label>
      <label className="text-[10px] text-slate-500">종료시간
        <input type="datetime-local" value={toLocalInput(input.endsAt)} onChange={(e) => set({ endsAt: fromLocalInput(e.target.value) })} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-300" />
      </label>
      <label className="text-[10px] text-slate-500">상태
        <select value={input.status} onChange={(e) => set({ status: e.target.value as ScheduleStatus })} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-300">
          {SCHEDULE_STATUSES.map((s) => <option key={s} value={s}>{SCHEDULE_STATUS_LABEL[s]}</option>)}
        </select>
      </label>
      <label className="text-[10px] text-slate-500 sm:col-span-2">메모
        <textarea value={input.memo ?? ''} onChange={(e) => set({ memo: e.target.value })} className="mt-0.5 h-14 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-300" />
      </label>
    </div>
  )
}

function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const d = new Date(t)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(v: string): string {
  if (!v) return ''
  const t = Date.parse(v)
  return Number.isNaN(t) ? '' : new Date(t).toISOString()
}
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }): JSX.Element {
  return <button type="button" onClick={onClick} className={['rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition', on ? 'border-indigo-400 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'].join(' ')}>{label}</button>
}
function StatusChip({ status }: { status: ScheduleStatus }): JSX.Element {
  const tone = status === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : status === 'cancelled' ? 'border-slate-200 bg-slate-100 text-slate-500' : 'border-indigo-200 bg-indigo-50 text-indigo-600'
  return <span className={['rounded-full border px-2 py-0.5 text-[10px] font-semibold', tone].join(' ')}>{SCHEDULE_STATUS_LABEL[status]}</span>
}
function ModeBadge({ mode }: { mode: ScheduleDataMode }): JSX.Element {
  const supa = mode === 'supabase'
  return <span className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold', supa ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-blue-200 bg-blue-50 text-blue-600'].join(' ')}>{supa ? <Database className="h-3 w-3" /> : <HardDrive className="h-3 w-3" />}{supa ? 'Supabase 공용 DB' : '로컬 MVP 데이터'}</span>
}
function Notice({ text }: { text: string }): JSX.Element {
  return <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">{text}</div>
}
