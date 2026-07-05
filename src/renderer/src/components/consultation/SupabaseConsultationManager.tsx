import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, Plus, Search, RefreshCw, Loader2, AlertTriangle, Save, X, Database, HardDrive, CheckCircle2 } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { CustomerRecord } from '@shared/commercial/models'
import { listCustomers } from '@renderer/services/commercial/customerService'
import {
  createConsultation,
  filterPendingNextActions,
  filterToday,
  listConsultations,
  searchConsultations,
  updateConsultation,
  type ConsultationDataMode,
  type ConsultationWithCustomer
} from '@renderer/services/commercial/consultationService'
import {
  CONSULTATION_STATUS_LABEL,
  CONSULTATION_STATUSES,
  CONSULTATION_TYPE_LABEL,
  CONSULTATION_TYPES,
  normalizeCompletion,
  validateConsultationInput,
  type ConsultationInput,
  type ConsultationStatus,
  type ConsultationType
} from '@renderer/services/commercial/consultationValidation'

/**
 * 상담기록 (Supabase-connected). Lists/creates/updates consultations via
 * consultationService (Supabase when configured + logged in, else local-mock). RLS
 * enforces real access; role guidance + client filters are UX only. Never renders
 * tokens/keys, never logs summaries/PII. Inline cards only; no backdrop.
 */

const emptyForm = (): ConsultationInput => ({ customerId: '', consultationType: 'first', status: 'planned', summary: '', nextAction: '', scheduledAt: '', completedAt: '' })

export default function SupabaseConsultationManager(): JSX.Element {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const [list, setList] = useState<ConsultationWithCustomer[]>([])
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [mode, setMode] = useState<ConsultationDataMode>('local-mock')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ConsultationStatus | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<ConsultationType | 'all'>('all')
  const [todayOnly, setTodayOnly] = useState(false)
  const [pendingOnly, setPendingOnly] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ConsultationInput>(emptyForm)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<ConsultationWithCustomer | null>(null)

  const roleHint = session.role === 'fc' ? '내 상담기록만 표시됩니다.' : session.role === 'team-leader' ? '팀 상담기록이 표시됩니다.' : '전체 상담기록이 표시됩니다.'

  const load = async (): Promise<void> => {
    setLoading(true)
    const [cRes, custRes] = await Promise.all([listConsultations(), listCustomers()])
    setMode(cRes.mode)
    setList(cRes.consultations)
    setCustomers(custRes.customers)
    setError(cRes.ok ? undefined : cRes.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = useMemo(() => {
    let v = searchConsultations(list, query, statusFilter, typeFilter)
    if (todayOnly) v = filterToday(v)
    if (pendingOnly) v = filterPendingNextActions(v)
    return v
  }, [list, query, statusFilter, typeFilter, todayOnly, pendingOnly])

  const custName = (id: string): string => customers.find((c) => c.id === id)?.name ?? '-'

  const submitCreate = async (): Promise<void> => {
    const normalized = normalizeCompletion(form)
    const v = validateConsultationInput(normalized)
    setFormErrors(v.errors)
    if (!v.ok) return
    setSaving(true)
    const res = await createConsultation(normalized)
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setShowForm(false); setForm(emptyForm()); void load()
  }
  const saveEdit = async (): Promise<void> => {
    if (!selected) return
    const input: ConsultationInput = { customerId: selected.customerId, consultationType: selected.consultationType, status: selected.status, summary: selected.summary, nextAction: selected.nextAction, scheduledAt: selected.scheduledAt, completedAt: selected.completedAt }
    const normalized = normalizeCompletion(input)
    const v = validateConsultationInput(normalized)
    setFormErrors(v.errors)
    if (!v.ok) return
    setSaving(true)
    const res = await updateConsultation(selected.id, normalized)
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setSelected(null); void load()
  }

  const noCustomers = customers.length === 0

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-indigo-500" />
          <h2 className="text-base font-bold text-slate-800">상담기록</h2>
          <ModeBadge mode={mode} />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"><RefreshCw className="h-3 w-3" /> 새로고침</button>
          <button type="button" onClick={() => { setShowForm((s) => !s); setSelected(null) }} disabled={noCustomers} className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"><Plus className="h-3 w-3" /> 상담기록 작성</button>
        </div>
      </div>
      <p className="mb-3 text-[11px] text-slate-500">{roleHint} <span className="text-slate-400">(실제 접근 권한은 Supabase RLS가 적용됩니다.)</span></p>

      {mode === 'not-configured' ? <Notice text="Supabase가 아직 연결되지 않아 로컬 MVP 데이터로 표시됩니다." /> : null}
      {mode === 'no-session' ? <Notice text="Supabase 로그인 후 상담기록 DB를 사용할 수 있습니다." /> : null}
      {error ? <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600"><AlertTriangle className="mr-1 inline h-3 w-3" />{error}</div> : null}

      {noCustomers ? (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          고객이 없어 상담기록을 작성할 수 없습니다. 고객을 먼저 등록해주세요.
          <button type="button" onClick={() => navigate({ name: 'customer' })} className="ml-2 rounded border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-700">고객관리로 이동</button>
        </div>
      ) : null}

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="고객명 검색" className="w-32 text-[11px] text-slate-700 focus:outline-none" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ConsultationStatus | 'all')} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-700">
          <option value="all">전체 상태</option>
          {CONSULTATION_STATUSES.map((s) => <option key={s} value={s}>{CONSULTATION_STATUS_LABEL[s]}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as ConsultationType | 'all')} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-700">
          <option value="all">전체 유형</option>
          {CONSULTATION_TYPES.map((t) => <option key={t} value={t}>{CONSULTATION_TYPE_LABEL[t]}</option>)}
        </select>
        <Toggle label="오늘" on={todayOnly} onClick={() => setTodayOnly((v) => !v)} />
        <Toggle label="다음 액션" on={pendingOnly} onClick={() => setPendingOnly((v) => !v)} />
      </div>

      {/* Create form */}
      {showForm && !noCustomers ? (
        <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
          <div className="mb-2 text-[11px] font-semibold text-slate-700">새 상담기록</div>
          <Fields input={form} onChange={setForm} customers={customers} />
          {formErrors.length > 0 ? <ul className="mt-2 space-y-0.5 text-[10px] text-rose-600">{formErrors.map((e) => <li key={e}>• {e}</li>)}</ul> : null}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void submitCreate()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60">{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} 저장</button>
            <button type="button" onClick={() => { setShowForm(false); setFormErrors([]) }} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-[11px] text-slate-600"><X className="h-3 w-3" /> 취소</button>
          </div>
        </div>
      ) : null}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> 상담기록을 불러오는 중입니다.</div>
      ) : visible.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-500"><div>등록된 상담기록이 없습니다.</div><div className="text-[11px] text-slate-400">첫 상담기록을 작성해보세요.</div></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-slate-400"><tr className="border-b border-slate-100">
              <th className="py-1.5 pr-2 font-medium">고객명</th>
              <th className="py-1.5 pr-2 font-medium">유형</th>
              <th className="py-1.5 pr-2 font-medium">상태</th>
              <th className="py-1.5 pr-2 font-medium">예정일</th>
              <th className="py-1.5 pr-2 font-medium">다음 액션</th>
              <th className="py-1.5 pr-2 font-medium">최근 수정</th>
            </tr></thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id} onClick={() => { setSelected({ ...c }); setShowForm(false) }} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-1.5 pr-2 font-medium text-slate-700">{c.customerName ?? custName(c.customerId)}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{CONSULTATION_TYPE_LABEL[c.consultationType]}</td>
                  <td className="py-1.5 pr-2"><StatusChip status={c.status} /></td>
                  <td className="py-1.5 pr-2 text-slate-500">{c.scheduledAt ? new Date(c.scheduledAt).toLocaleDateString() : '-'}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{c.nextAction ? '있음' : '-'}</td>
                  <td className="py-1.5 pr-2 text-slate-400">{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '-'}</td>
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
            <div className="text-[11px] font-semibold text-slate-700">상담기록 상세 / 수정 · {selected.customerName ?? custName(selected.customerId)}</div>
            <button type="button" onClick={() => { setSelected(null); setFormErrors([]) }} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
          </div>
          <Fields input={{ customerId: selected.customerId, consultationType: selected.consultationType, status: selected.status, summary: selected.summary, nextAction: selected.nextAction ?? '', scheduledAt: selected.scheduledAt ?? '', completedAt: selected.completedAt ?? '' }} onChange={(v) => setSelected({ ...selected, consultationType: v.consultationType, status: v.status, summary: v.summary ?? '', nextAction: v.nextAction, scheduledAt: v.scheduledAt, completedAt: v.completedAt })} customers={customers} lockCustomer />
          {formErrors.length > 0 ? <ul className="mt-2 space-y-0.5 text-[10px] text-rose-600">{formErrors.map((e) => <li key={e}>• {e}</li>)}</ul> : null}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void saveEdit()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60">{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} 저장</button>
            {selected.status !== 'completed' ? (
              <button type="button" onClick={() => setSelected({ ...selected, status: 'completed', completedAt: selected.completedAt || new Date().toISOString() })} className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> 완료 처리</button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Fields({ input, onChange, customers, lockCustomer }: { input: ConsultationInput; onChange: (v: ConsultationInput) => void; customers: CustomerRecord[]; lockCustomer?: boolean }): JSX.Element {
  const set = (patch: Partial<ConsultationInput>): void => onChange({ ...input, ...patch })
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label className="text-[10px] text-slate-500">고객 *
        <select value={input.customerId} disabled={lockCustomer} onChange={(e) => set({ customerId: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-700 disabled:bg-slate-100">
          <option value="">고객 선택</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="text-[10px] text-slate-500">상담 유형
        <select value={input.consultationType} onChange={(e) => set({ consultationType: e.target.value as ConsultationType })} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-700">
          {CONSULTATION_TYPES.map((t) => <option key={t} value={t}>{CONSULTATION_TYPE_LABEL[t]}</option>)}
        </select>
      </label>
      <label className="text-[10px] text-slate-500">상태
        <select value={input.status} onChange={(e) => set({ status: e.target.value as ConsultationStatus })} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-700">
          {CONSULTATION_STATUSES.map((s) => <option key={s} value={s}>{CONSULTATION_STATUS_LABEL[s]}</option>)}
        </select>
      </label>
      <label className="text-[10px] text-slate-500">상담 예정일
        <input type="datetime-local" value={toLocalInput(input.scheduledAt)} onChange={(e) => set({ scheduledAt: fromLocalInput(e.target.value) })} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-700" />
      </label>
      <label className="text-[10px] text-slate-500 sm:col-span-2">상담 요약
        <textarea value={input.summary ?? ''} onChange={(e) => set({ summary: e.target.value })} className="mt-0.5 h-14 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-700" />
      </label>
      <label className="text-[10px] text-slate-500 sm:col-span-2">다음 액션
        <input value={input.nextAction ?? ''} onChange={(e) => set({ nextAction: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-700" />
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
function StatusChip({ status }: { status: ConsultationStatus }): JSX.Element {
  const tone = status === 'completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : status === 'cancelled' ? 'border-slate-200 bg-slate-100 text-slate-500' : 'border-indigo-200 bg-indigo-50 text-indigo-600'
  return <span className={['rounded-full border px-2 py-0.5 text-[10px] font-semibold', tone].join(' ')}>{CONSULTATION_STATUS_LABEL[status]}</span>
}
function ModeBadge({ mode }: { mode: ConsultationDataMode }): JSX.Element {
  const supa = mode === 'supabase'
  return <span className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold', supa ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-blue-200 bg-blue-50 text-blue-600'].join(' ')}>{supa ? <Database className="h-3 w-3" /> : <HardDrive className="h-3 w-3" />}{supa ? 'Supabase 공용 DB' : '로컬 MVP 데이터'}</span>
}
function Notice({ text }: { text: string }): JSX.Element {
  return <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">{text}</div>
}
