import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, FileSearch, FileSignature, HeartPulse, Link2, ListChecks, ReceiptText, Search, ShieldQuestion, Stethoscope, User, X } from 'lucide-react'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { View } from '@renderer/navigation/types'
import { listCustomers } from '@renderer/services/commercial/customerService'
import { parseRrn } from '@renderer/services/commercial/customerValidation'
import { getHubCustomer, setHubCustomer, subscribeHubCustomer } from '@renderer/services/insurance-hub/insuranceHubStore'
import type { CustomerRecord } from '@shared/commercial/models'

/**
 * 보험 허브 바 — 보험 도구 6종의 상단 공용 바.
 * 도구 간 원클릭 이동 + "현재 작업 중 고객" 칩(연결/해제). 여기서 고객을 연결하면
 * 각 도구의 고객 선택이 자동으로 채워지고, 도구를 옮겨 다녀도 유지된다.
 * 어두운 바이므로 slate 토큰 대신 명시적 hex(딥네이비+골드)·white 계열만 쓴다.
 */

export type HubTool =
  | 'insurance-analysis'
  | 'pre-underwriting'
  | 'underwriting'
  | 'disease-exceptions'
  | 'plan-request'
  | 'claim-assistant'
  | 'wiki'
  | 'leads'

const TOOLS: { key: HubTool; label: string; icon: typeof FileSearch; view: View }[] = [
  { key: 'insurance-analysis', label: '보장분석', icon: FileSearch, view: { name: 'insurance-analysis' } },
  { key: 'pre-underwriting', label: '사전심사', icon: ShieldQuestion, view: { name: 'pre-underwriting' } },
  { key: 'underwriting', label: '인수가이드', icon: Stethoscope, view: { name: 'underwriting' } },
  { key: 'disease-exceptions', label: '예외질환', icon: HeartPulse, view: { name: 'disease-exceptions' } },
  { key: 'plan-request', label: '설계요청', icon: FileSignature, view: { name: 'plan-request' } },
  { key: 'claim-assistant', label: '청구비서', icon: ReceiptText, view: { name: 'claim-assistant' } },
  { key: 'wiki', label: '백과사전', icon: BookOpen, view: { name: 'wiki' } },
  { key: 'leads', label: 'DB배정', icon: ListChecks, view: { name: 'leads' } }
]

export default function InsuranceHubBar({ current }: { current: HubTool }): JSX.Element {
  const { navigate } = useNavigation()
  const [customer, setCustomer] = useState<CustomerRecord | null>(() => getHubCustomer())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const loadedRef = useRef(false)

  useEffect(() => subscribeHubCustomer(setCustomer), [])

  const openPicker = (): void => {
    setPickerOpen(true)
    if (!loadedRef.current) {
      loadedRef.current = true
      void listCustomers().then((r) => {
        if (r.ok) setCustomers(r.customers)
      })
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return customers.slice(0, 8)
    return customers.filter((c) => c.name.includes(q) || (c.phone ?? '').includes(q)).slice(0, 8)
  }, [customers, query])

  const rrn = parseRrn(customer?.rrn)

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0e1e3a] px-3 py-2.5 shadow-sm sm:px-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold tracking-wide text-[#e6c877]">
          <Link2 className="h-3.5 w-3.5" /> 보험 허브
        </span>

        {/* 도구 이동 칩 */}
        <div className="flex flex-wrap items-center gap-1">
          {TOOLS.map((t) => {
            const active = t.key === current
            const Icon = t.icon
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  if (!active) navigate(t.view)
                }}
                className={[
                  'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold transition',
                  active
                    ? 'bg-[#c6982f] font-bold text-[#0e1e3a]'
                    : 'border border-white/15 text-white/70 hover:border-[#e6c877]/50 hover:text-[#e6c877]'
                ].join(' ')}
              >
                <Icon className="h-3 w-3" />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* 현재 작업 중 고객 */}
        <div className="relative ml-auto">
          {customer ? (
            <div className="flex items-center gap-1.5 rounded-full border border-[#e6c877]/40 bg-[#c6982f]/15 py-1 pl-1.5 pr-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#c6982f] text-[10px] font-bold text-[#0e1e3a]">
                {customer.name.slice(0, 1)}
              </span>
              <span className="text-[11px] font-bold text-[#e6c877]">{customer.name}</span>
              {rrn ? (
                <span className="text-[10px] text-white/60">
                  {rrn.age}세 {rrn.gender}
                </span>
              ) : null}
              {customer.medicalHistory ? <span className="text-[10px] text-white/60">· 병력</span> : null}
              <button
                type="button"
                onClick={() => setHubCustomer(null)}
                className="text-white/50 transition hover:text-rose-300"
                aria-label="고객 연결 해제"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : pickerOpen ? (
            <div className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2 py-1">
              <Search className="h-3 w-3 shrink-0 text-white/50" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="고객 이름/전화 검색"
                className="w-28 bg-transparent text-[11px] text-white outline-none placeholder:text-white/40 sm:w-40"
              />
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false)
                  setQuery('')
                }}
                className="text-white/50 hover:text-white"
                aria-label="검색 닫기"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={openPicker}
              className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/80 transition hover:border-[#e6c877]/50 hover:text-[#e6c877]"
              title="고객을 연결하면 보장분석·사전심사·인수가이드·청구비서로 이동해도 유지됩니다"
            >
              <User className="h-3 w-3" /> 고객 연결
            </button>
          )}

          {pickerOpen && !customer && filtered.length > 0 ? (
            <div className="absolute right-0 top-full z-20 mt-1 w-60 overflow-hidden rounded-xl border border-slate-800 bg-white shadow-lg">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setHubCustomer(c)
                    setPickerOpen(false)
                    setQuery('')
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-950"
                >
                  <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="text-[12px] font-medium text-slate-200">{c.name}</span>
                  <span className="text-[10px] text-slate-500">{c.phone ?? ''}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
