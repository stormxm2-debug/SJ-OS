import { useEffect, useMemo, useState } from 'react'
import { Hourglass, Plus, Trash2, Loader2, AlertTriangle, Search, X, CalendarClock } from 'lucide-react'
import {
  listExemptions,
  createExemption,
  deleteExemption,
  exemptionStatus,
  WAITING_PRESETS,
  type PolicyExemption
} from '@renderer/services/commercial/exemptionService'
import { listCustomers } from '@renderer/services/commercial/customerService'
import { INSURERS } from '@renderer/services/commercial/registrationService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'
import type { CustomerRecord } from '@shared/commercial/models'

/**
 * 면책기간 알람 (1단계) — 각 고객 보험 가입 건의 보장개시일 + 면책기간을 기록하면
 * 면책 종료일이 자동 계산되고, 매일 점검해 임박(D-7)/도래 시 담당 FC 에게 알림이 온다.
 * (증권 AI 자동판독 = 3단계에서 이 목록을 자동으로 채운다)
 */

const RT = ['policy_exemptions', 'exemption_alerts']

function fmtDate(d: string): string {
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return d
  return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`
}

export default function ExemptionsPage(): JSX.Element {
  const [items, setItems] = useState<PolicyExemption[]>([])
  const [configured, setConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)

  const load = async (): Promise<void> => {
    const r = await listExemptions()
    setItems(r.items)
    setConfigured(r.configured)
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])
  useRealtimeSync(RT, () => void load())

  const soon = items.filter((e) => exemptionStatus(e.waitingEnd).key === 'soon')

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* 히어로 */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0e1e3a] to-[#1b3a6b] p-5 text-white">
        <div className="flex items-center gap-2">
          <Hourglass className="h-5 w-5 text-[#e6c877]" />
          <h1 className="text-lg font-extrabold">면책기간 알람</h1>
        </div>
        <p className="mt-1 text-[13px] leading-5 text-slate-300">
          보장개시일과 면책기간을 등록하면 <b className="text-[#e6c877]">면책 종료가 임박(D-7)·도래</b>할 때 담당자에게 알림이 갑니다.
          면책이 끝나면 고객에게 “이제 보장이 시작됐다”고 안내할 좋은 타이밍입니다.
        </p>
        {soon.length > 0 ? (
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#c6982f] px-3 py-1 text-[12px] font-bold text-[#201603]">
            <AlertTriangle className="h-3.5 w-3.5" /> 임박 {soon.length}건
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-extrabold text-slate-100">등록된 면책 {items.length}건</h2>
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg bg-[#0e1e3a] px-3 py-1.5 text-[12px] font-bold text-[#e6c877] hover:brightness-125"
        >
          {formOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {formOpen ? '닫기' : '면책 등록'}
        </button>
      </div>

      {formOpen ? <ExemptionForm onSaved={() => { setFormOpen(false); void load() }} /> : null}

      {!configured ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-[13px] text-amber-800">
          면책 알람이 아직 설정되지 않았습니다(테이블 미적용). 설정 완료 후 사용할 수 있습니다.
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 py-10 text-center text-[13px] text-slate-500">
          등록된 면책이 없습니다. [면책 등록]으로 첫 건을 추가하세요.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((e) => (
            <ExemptionCard key={e.id} e={e} onDeleted={() => void load()} />
          ))}
        </div>
      )}
    </div>
  )
}

function ExemptionCard({ e, onDeleted }: { e: PolicyExemption; onDeleted: () => void }): JSX.Element {
  const st = exemptionStatus(e.waitingEnd)
  const tone =
    st.key === 'ended'
      ? 'bg-emerald-50 text-emerald-700'
      : st.key === 'soon'
        ? 'bg-[#c6982f] text-[#201603]'
        : 'bg-slate-100 text-slate-500'
  const remove = async (): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm(`${e.customerName} · ${e.insurer} 면책 기록을 삭제할까요?`)) return
    const r = await deleteExemption(e.id)
    if (r.ok) onDeleted()
  }
  return (
    <div className="rounded-xl border border-slate-800 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold text-slate-100">{e.customerName || '고객'}</span>
            <span className="rounded-full bg-[#0e1e3a] px-2 py-0.5 text-[10px] font-bold text-[#e6c877]">{e.insurer}</span>
            {e.source === 'ai' ? <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-700">AI 판독</span> : null}
          </div>
          <div className="mt-0.5 text-[12px] text-slate-500">
            {[e.productName, e.coverage].filter(Boolean).join(' · ') || '상품·담보 미기재'}
          </div>
        </div>
        <span className={['shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold', tone].join(' ')}>{st.label}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-3 w-3" /> 개시 {fmtDate(e.startDate)}
        </span>
        <span>면책 {e.waitingDays}일</span>
        <span className="font-bold text-slate-300">종료 {fmtDate(e.waitingEnd)}</span>
        <button type="button" onClick={() => void remove()} aria-label="삭제" className="ml-auto text-slate-400 hover:text-rose-600">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {e.memo ? <p className="mt-1.5 text-[12px] text-slate-400">{e.memo}</p> : null}
    </div>
  )
}

function ExemptionForm({ onSaved }: { onSaved: () => void }): JSX.Element {
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [q, setQ] = useState('')
  const [customer, setCustomer] = useState<CustomerRecord | null>(null)
  const [insurer, setInsurer] = useState<string>(INSURERS[0])
  const [product, setProduct] = useState('')
  const [coverage, setCoverage] = useState('')
  const [startDate, setStartDate] = useState('')
  const [waitingDays, setWaitingDays] = useState(90)
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    void listCustomers().then((r) => {
      if (r.ok) setCustomers(r.customers)
    })
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return customers.slice(0, 6)
    return customers.filter((c) => c.name.toLowerCase().includes(s) || (c.phone ?? '').includes(s)).slice(0, 6)
  }, [customers, q])

  const submit = async (): Promise<void> => {
    if (!customer) {
      setErr('고객을 선택해주세요.')
      return
    }
    setBusy(true)
    setErr('')
    const r = await createExemption({
      customerId: customer.id,
      insurer,
      productName: product,
      coverage,
      startDate,
      waitingDays,
      memo
    })
    setBusy(false)
    if (!r.ok) {
      setErr(r.error ?? '저장 실패')
      return
    }
    onSaved()
  }

  return (
    <div className="space-y-2.5 rounded-2xl border border-[#c6982f]/40 bg-white p-4">
      {/* 고객 선택 */}
      {customer ? (
        <div className="flex items-center justify-between rounded-lg bg-[#0e1e3a] px-3 py-2">
          <span className="text-[13px] font-bold text-white">{customer.name} <span className="text-[11px] text-slate-300">{customer.phone ?? ''}</span></span>
          <button type="button" onClick={() => setCustomer(null)} className="text-[11px] text-slate-300 hover:text-white">변경</button>
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-slate-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="고객 이름/전화 검색" className="w-full bg-transparent text-[12px] text-slate-100 outline-none placeholder:text-slate-500" />
          </div>
          {filtered.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {filtered.map((c) => (
                <button key={c.id} type="button" onClick={() => { setCustomer(c); setQ('') }} className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] hover:bg-slate-950">
                  <span className="font-semibold text-slate-100">{c.name}</span>
                  <span className="text-slate-500">{c.phone ?? ''}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">보험사</span>
          <select value={insurer} onChange={(e) => setInsurer(e.target.value)} className="w-full rounded-lg border border-slate-800 bg-white px-2 py-1.5 text-[12px] text-slate-100">
            {INSURERS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">보장개시일</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100 outline-none focus:border-[#c6982f]" />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">상품명(선택)</span>
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="예: (무)건강종신" className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]" />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">담보(선택)</span>
          <input value={coverage} onChange={(e) => setCoverage(e.target.value)} placeholder="예: 암진단비" className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]" />
        </label>
      </div>

      {/* 면책기간 프리셋 + 커스텀 */}
      <div>
        <span className="mb-1 block text-[10px] font-semibold text-slate-500">면책기간</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {WAITING_PRESETS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => setWaitingDays(p.days)}
              className={['rounded-full border px-2.5 py-1 text-[11px] font-bold', waitingDays === p.days ? 'border-[#c6982f] bg-[#0e1e3a] text-[#e6c877]' : 'border-slate-800 bg-white text-slate-400'].join(' ')}
            >
              {p.label}
            </button>
          ))}
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            직접
            <input
              type="number"
              value={waitingDays}
              onChange={(e) => setWaitingDays(Math.max(0, Number(e.target.value) || 0))}
              className="w-16 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[12px] text-slate-100 outline-none focus:border-[#c6982f]"
            />
            일
          </span>
        </div>
      </div>

      <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모(선택)" className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]" />

      {err ? <div className="text-[12px] font-medium text-rose-600">{err}</div> : null}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || !customer || !startDate}
        className={['inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-extrabold', busy || !customer || !startDate ? 'cursor-not-allowed bg-slate-200 text-slate-400' : 'bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] text-[#e6c877]'].join(' ')}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hourglass className="h-4 w-4" />} 면책 등록
      </button>
    </div>
  )
}
