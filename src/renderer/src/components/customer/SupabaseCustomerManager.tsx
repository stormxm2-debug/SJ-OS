import { useEffect, useMemo, useState } from 'react'
import { Users, Plus, Search, RefreshCw, Loader2, AlertTriangle, Save, X, Database, HardDrive } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import type { CustomerRecord, CustomerStatus } from '@shared/commercial/models'
import {
  createCustomer,
  filterCustomers,
  listCustomers,
  updateCustomer,
  type CustomerDataMode
} from '@renderer/services/commercial/customerService'
import {
  CUSTOMER_STATUS_LABEL,
  CUSTOMER_STATUSES,
  validateCustomerInput,
  type CustomerInput
} from '@renderer/services/commercial/customerValidation'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

/**
 * 고객관리 (Supabase-connected). Lists/creates/updates customers via customerService
 * (Supabase when configured + logged in, else local-mock). RLS enforces real access;
 * the role guidance + client filter are UX only. Never renders raw tokens/keys and
 * never logs customer phone/birth/address. Inline cards only; no backdrop.
 */

/** Tables whose changes should live-refresh this screen (stable ref for the hook). */
const RT_TABLES = ['customers']

const emptyForm = (): CustomerInput => ({ name: '', phone: '', birthDate: '', address: '', source: '', status: 'new', tags: [], memo: '' })

export default function SupabaseCustomerManager(): JSX.Element {
  const { session } = useSession()
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [mode, setMode] = useState<CustomerDataMode>('local-mock')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | 'all'>('all')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<CustomerInput>(emptyForm)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<CustomerRecord | null>(null)

  const roleHint =
    session.role === 'fc' ? '내 고객만 표시됩니다.' : session.role === 'team-leader' ? '팀 고객이 표시됩니다.' : '전체 고객이 표시됩니다.'

  const load = async (): Promise<void> => {
    setLoading(true)
    const res = await listCustomers()
    setMode(res.mode)
    setCustomers(res.customers)
    setError(res.ok ? undefined : res.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Live sync: re-load instantly when customers change on any device.
  useRealtimeSync(RT_TABLES, load)

  const visible = useMemo(() => filterCustomers(customers, query, statusFilter), [customers, query, statusFilter])

  const submitCreate = async (): Promise<void> => {
    const v = validateCustomerInput(form)
    setFormErrors(v.errors)
    if (!v.ok) return
    setSaving(true)
    const res = await createCustomer(form)
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setShowForm(false)
    setForm(emptyForm())
    void load()
  }

  const saveEdit = async (): Promise<void> => {
    if (!selected) return
    const v = validateCustomerInput({ name: selected.name, phone: selected.phone, birthDate: selected.birthDate, address: selected.address, source: selected.source, status: selected.status, tags: selected.tags, memo: selected.memo })
    setFormErrors(v.errors)
    if (!v.ok) return
    setSaving(true)
    const res = await updateCustomer(selected.id, { name: selected.name, phone: selected.phone, birthDate: selected.birthDate, address: selected.address, source: selected.source, status: selected.status, tags: selected.tags, memo: selected.memo })
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setSelected(null)
    void load()
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-indigo-500" />
          <h2 className="text-base font-bold text-slate-100">고객관리</h2>
          <ModeBadge mode={mode} />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"><RefreshCw className="h-3 w-3" /> 새로고침</button>
          <button type="button" onClick={() => { setShowForm((s) => !s); setSelected(null) }} className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white"><Plus className="h-3 w-3" /> 고객 등록</button>
        </div>
      </div>
      <p className="mb-3 text-[11px] text-slate-500">{roleHint} <span className="text-slate-400">(실제 접근 권한은 Supabase RLS가 적용됩니다.)</span></p>

      {/* Not-configured / no-session notices */}
      {mode === 'not-configured' ? <Notice text="Supabase가 아직 연결되지 않아 로컬 MVP 데이터로 표시됩니다." /> : null}
      {mode === 'no-session' ? <Notice text="Supabase 로그인 후 고객 DB를 사용할 수 있습니다." /> : null}
      {error ? <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600"><AlertTriangle className="mr-1 inline h-3 w-3" />{error}</div> : null}

      {/* Search + filter */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름/연락처 검색" className="w-40 text-[11px] text-slate-300 focus:outline-none" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as CustomerStatus | 'all')} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-300 focus:outline-none">
          <option value="all">전체 상태</option>
          {CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{CUSTOMER_STATUS_LABEL[s]}</option>)}
        </select>
      </div>

      {/* Create form */}
      {showForm ? (
        <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
          <div className="mb-2 text-[11px] font-semibold text-slate-300">새 고객 등록</div>
          <CustomerFields input={form} onChange={setForm} />
          {formErrors.length > 0 ? <ul className="mt-2 space-y-0.5 text-[10px] text-rose-600">{formErrors.map((e) => <li key={e}>• {e}</li>)}</ul> : null}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void submitCreate()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60">{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} 저장</button>
            <button type="button" onClick={() => { setShowForm(false); setFormErrors([]) }} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-[11px] text-slate-600"><X className="h-3 w-3" /> 취소</button>
          </div>
        </div>
      ) : null}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> 고객 목록을 불러오는 중입니다.</div>
      ) : visible.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-500">
          <div>등록된 고객이 없습니다.</div>
          <div className="text-[11px] text-slate-400">첫 고객을 등록해보세요.</div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-slate-400">
              <tr className="border-b border-slate-100">
                <th className="py-1.5 pr-2 font-medium">이름</th>
                <th className="py-1.5 pr-2 font-medium">연락처</th>
                <th className="py-1.5 pr-2 font-medium">상태</th>
                <th className="py-1.5 pr-2 font-medium">태그</th>
                <th className="py-1.5 pr-2 font-medium">최근 수정</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id} onClick={() => { setSelected({ ...c }); setShowForm(false) }} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-1.5 pr-2 font-medium text-slate-300">{c.name}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{c.phone ?? '-'}</td>
                  <td className="py-1.5 pr-2"><StatusChip status={c.status} /></td>
                  <td className="py-1.5 pr-2 text-slate-500">{c.tags.slice(0, 3).join(', ')}</td>
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
            <div className="text-[11px] font-semibold text-slate-300">고객 상세 / 수정</div>
            <button type="button" onClick={() => { setSelected(null); setFormErrors([]) }} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
          </div>
          <CustomerFields input={{ name: selected.name, phone: selected.phone ?? '', birthDate: selected.birthDate ?? '', address: selected.address ?? '', source: selected.source ?? '', status: selected.status, tags: selected.tags, memo: selected.memo ?? '' }} onChange={(v) => setSelected({ ...selected, name: v.name, phone: v.phone, birthDate: v.birthDate, address: v.address, source: v.source, status: v.status, tags: v.tags, memo: v.memo })} />
          {formErrors.length > 0 ? <ul className="mt-2 space-y-0.5 text-[10px] text-rose-600">{formErrors.map((e) => <li key={e}>• {e}</li>)}</ul> : null}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void saveEdit()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60">{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} 저장</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CustomerFields({ input, onChange }: { input: CustomerInput; onChange: (v: CustomerInput) => void }): JSX.Element {
  const set = (patch: Partial<CustomerInput>): void => onChange({ ...input, ...patch })
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Input label="고객명 *" value={input.name} onChange={(v) => set({ name: v })} />
      <Input label="연락처" value={input.phone ?? ''} onChange={(v) => set({ phone: v })} />
      <Input label="생년월일 (YYYY-MM-DD)" value={input.birthDate ?? ''} onChange={(v) => set({ birthDate: v })} />
      <Input label="유입경로" value={input.source ?? ''} onChange={(v) => set({ source: v })} />
      <Input label="주소" value={input.address ?? ''} onChange={(v) => set({ address: v })} />
      <label className="text-[10px] text-slate-500">상태
        <select value={input.status} onChange={(e) => set({ status: e.target.value as CustomerStatus })} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-300 focus:outline-none">
          {CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{CUSTOMER_STATUS_LABEL[s]}</option>)}
        </select>
      </label>
      <Input label="태그 (쉼표로 구분)" value={input.tags.join(', ')} onChange={(v) => set({ tags: v.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10) })} />
      <label className="text-[10px] text-slate-500 sm:col-span-2">메모
        <textarea value={input.memo ?? ''} onChange={(e) => set({ memo: e.target.value })} className="mt-0.5 h-14 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-300 focus:outline-none" />
      </label>
    </div>
  )
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }): JSX.Element {
  return (
    <label className="text-[10px] text-slate-500">{label}
      <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-300 focus:outline-none" />
    </label>
  )
}
function StatusChip({ status }: { status: CustomerStatus }): JSX.Element {
  return <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">{CUSTOMER_STATUS_LABEL[status]}</span>
}
function ModeBadge({ mode }: { mode: CustomerDataMode }): JSX.Element {
  const supa = mode === 'supabase'
  return (
    <span className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold', supa ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-blue-200 bg-blue-50 text-blue-600'].join(' ')}>
      {supa ? <Database className="h-3 w-3" /> : <HardDrive className="h-3 w-3" />}
      {supa ? 'Supabase 공용 DB' : '로컬 MVP 데이터'}
    </span>
  )
}
function Notice({ text }: { text: string }): JSX.Element {
  return <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">{text}</div>
}
