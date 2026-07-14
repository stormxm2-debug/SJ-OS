import { useEffect, useMemo, useState } from 'react'
import {
  Calculator,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
  AlertTriangle,
  Hourglass
} from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import { INSURERS } from '@renderer/services/commercial/registrationService'
import {
  calcSalaryAmounts,
  createSalaryCalc,
  deleteCommissionRate,
  deleteSalaryCalc,
  listCommissionRates,
  listSalaryCalcs,
  rateFor,
  saveCommissionRate,
  sortRates,
  type CommissionRate,
  type SalaryCalc
} from '@renderer/services/commercial/salaryService'

/**
 * 급여 계산기 — 수당 4종(모집자·상생시상·원수사시상·13개월시상), 월납보험료 기준 %.
 *
 * - 요율표(보험사×상품군)는 관리자가 관리, 전 직원 자동 적용. 요율은 계산 시 수정 가능.
 * - 13개월시상은 13회차 유지 시 지급되는 조건부 수당 — 즉시 수당과 분리 표시.
 * - 계산 저장 → 귀속월별 예상 급여 합산. 관리자는 "내 계산/직원 계산" 분리(원칙 준수).
 * - 서버 미연결이어도 계산기 자체는 동작(요율 자동 로드·저장만 서버 필요).
 */

const fmt = (n: number): string => n.toLocaleString('ko-KR')

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function pctOf(v: string): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** 숫자만 남기고 콤마 포맷. */
function premiumOf(v: string): number {
  const n = Number(v.replace(/[^0-9]/g, ''))
  return Number.isFinite(n) ? n : 0
}

interface PctForm {
  recruiter: string
  sangsaeng: string
  carrier: string
  month13: string
}

const EMPTY_PCT: PctForm = { recruiter: '', sangsaeng: '', carrier: '', month13: '' }

export default function SalaryCalculatorPage(): JSX.Element {
  const { session } = useSession()
  const admin = isAdminRole(session.role)

  const [rates, setRates] = useState<CommissionRate[]>([])
  const [ratesError, setRatesError] = useState<string | undefined>()
  const [calcs, setCalcs] = useState<SalaryCalc[]>([])
  const [calcsError, setCalcsError] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(currentMonth())
  const [scope, setScope] = useState<'mine' | 'staff'>('mine')
  const [showRateAdmin, setShowRateAdmin] = useState(false)

  // 계산기 입력
  const [insurer, setInsurer] = useState('')
  const [productGroup, setProductGroup] = useState('')
  const [premiumStr, setPremiumStr] = useState('')
  const [pct, setPct] = useState<PctForm>(EMPTY_PCT)
  const [customerName, setCustomerName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | undefined>()

  const loadRates = async (): Promise<void> => {
    const res = await listCommissionRates()
    setRates(res.items)
    setRatesError(res.ok ? undefined : res.error)
  }
  const loadCalcs = async (m: string): Promise<void> => {
    const res = await listSalaryCalcs(m)
    setCalcs(res.items)
    setCalcsError(res.ok ? undefined : res.error)
  }
  const loadAll = async (m: string): Promise<void> => {
    await Promise.all([loadRates(), loadCalcs(m)])
    setLoading(false)
  }
  useEffect(() => {
    void loadAll(month)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    void loadCalcs(month)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  // 보험사 목록: 요율표에 있는 회사 우선, 없으면 기본 12개사
  const insurerOptions = useMemo(() => {
    const fromRates = Array.from(new Set(rates.map((r) => r.insurer)))
    return fromRates.length > 0 ? fromRates : [...INSURERS]
  }, [rates])

  const groupOptions = useMemo(
    () => Array.from(new Set(rates.filter((r) => r.insurer === insurer).map((r) => r.productGroup))),
    [rates, insurer]
  )

  // 보험사/상품군/귀속월 선택 → 요율 자동 채움 (그 달 시책 우선, 없으면 기본 — 수정 가능)
  const applyRate = (ins: string, grp: string, m: string): void => {
    const hit = rateFor(rates, ins, grp, m) ?? rates.find((r) => r.insurer === ins)
    if (hit) {
      setPct({
        recruiter: String(hit.recruiterPct || ''),
        sangsaeng: String(hit.sangsaengPct || ''),
        carrier: String(hit.carrierPct || ''),
        month13: String(hit.month13Pct || '')
      })
    }
  }
  const pickInsurer = (ins: string): void => {
    setInsurer(ins)
    const grp = rates.find((r) => r.insurer === ins)?.productGroup ?? '공통'
    setProductGroup(grp)
    applyRate(ins, grp, month)
  }
  const pickGroup = (grp: string): void => {
    setProductGroup(grp)
    applyRate(insurer, grp, month)
  }
  // 귀속월 변경 시 그 달 요율(시책/기본)로 다시 채움
  useEffect(() => {
    if (insurer) applyRate(insurer, productGroup, month)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  // 현재 선택에 자동 적용된 요율 출처 표시용
  const appliedRate = insurer ? rateFor(rates, insurer, productGroup, month) : undefined

  const premium = premiumOf(premiumStr)
  const amounts = useMemo(
    () =>
      calcSalaryAmounts(premium, {
        recruiterPct: pctOf(pct.recruiter),
        sangsaengPct: pctOf(pct.sangsaeng),
        carrierPct: pctOf(pct.carrier),
        month13Pct: pctOf(pct.month13)
      }),
    [premium, pct]
  )

  const submit = async (): Promise<void> => {
    setSaveMsg(undefined)
    if (!insurer) {
      setSaveMsg({ ok: false, text: '보험사를 선택해 주세요.' })
      return
    }
    if (premium <= 0) {
      setSaveMsg({ ok: false, text: '월납보험료를 입력해 주세요.' })
      return
    }
    setSaving(true)
    const res = await createSalaryCalc({
      calcMonth: month,
      insurer,
      productGroup: productGroup || '공통',
      customerName: customerName || undefined,
      monthlyPremium: premium,
      recruiterPct: pctOf(pct.recruiter),
      sangsaengPct: pctOf(pct.sangsaeng),
      carrierPct: pctOf(pct.carrier),
      month13Pct: pctOf(pct.month13)
    })
    setSaving(false)
    if (!res.ok) {
      setSaveMsg({ ok: false, text: res.error ?? '저장하지 못했습니다.' })
      return
    }
    setSaveMsg({ ok: true, text: `${month} 귀속으로 저장했습니다.` })
    setPremiumStr('')
    setCustomerName('')
    await loadCalcs(month)
  }

  const removeCalc = async (c: SalaryCalc): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm('이 계산을 삭제할까요?')) return
    const res = await deleteSalaryCalc(c.id)
    if (!res.ok) {
      setCalcsError(res.error)
      return
    }
    await loadCalcs(month)
  }

  // 내 것 / 직원 것 분리 (관리자만 직원 탭)
  const mine = useMemo(() => calcs.filter((c) => c.staffId === session.id), [calcs, session.id])
  const staff = useMemo(() => calcs.filter((c) => c.staffId !== session.id), [calcs, session.id])
  const visible = admin && scope === 'staff' ? staff : mine

  const summary = useMemo(() => {
    let immediate = 0
    let month13 = 0
    for (const c of visible) {
      const a = calcSalaryAmounts(c.monthlyPremium, c)
      immediate += a.immediate
      month13 += a.month13
    }
    return { immediate, month13, total: immediate + month13, count: visible.length }
  }, [visible])

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* 헤더 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0e1e3a]">
            <Calculator className="h-5 w-5 text-[#e6c877]" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-slate-100">급여 계산기</h1>
            <p className="text-[12px] text-slate-500">모집자 + 상생시상 + 원수사시상 + 13개월시상 — 월납보험료 기준 %</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, -1))}
              aria-label="이전 달"
              className="rounded-lg border border-slate-800 bg-white p-1.5 text-slate-400 hover:text-indigo-600"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[84px] text-center text-sm font-bold text-slate-100">{month.replace('-', '년 ')}월</span>
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, 1))}
              aria-label="다음 달"
              className="rounded-lg border border-slate-800 bg-white p-1.5 text-slate-400 hover:text-indigo-600"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void loadAll(month)}
              aria-label="새로고침"
              className="rounded-lg border border-slate-800 bg-white p-1.5 text-slate-400 hover:text-indigo-600"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            {admin ? (
              <button
                type="button"
                onClick={() => setShowRateAdmin((v) => !v)}
                className={[
                  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition',
                  showRateAdmin ? 'bg-[#0e1e3a] text-[#e6c877]' : 'border border-slate-800 bg-white text-slate-400 hover:text-indigo-600'
                ].join(' ')}
              >
                <Settings2 className="h-3.5 w-3.5" /> 요율표 관리
              </button>
            ) : null}
          </div>
        </div>
        {ratesError ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {ratesError} 요율을 직접 입력해 계산할 수 있습니다.
          </div>
        ) : null}
      </div>

      {/* 관리자: 요율표 관리 */}
      {admin && showRateAdmin ? <RateAdmin rates={rates} month={month} onChanged={() => void loadRates()} /> : null}

      {/* 계산기 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-bold text-slate-100">수당 계산</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-slate-500">보험사 *</span>
            <select
              value={insurer}
              onChange={(e) => pickInsurer(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-sm text-slate-100 focus:outline-none"
            >
              <option value="">선택하세요</option>
              {insurerOptions.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-slate-500">상품군</span>
            {groupOptions.length > 0 ? (
              <select
                value={productGroup}
                onChange={(e) => pickGroup(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-sm text-slate-100 focus:outline-none"
              >
                {groupOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={productGroup}
                onChange={(e) => setProductGroup(e.target.value)}
                placeholder="공통"
                className="w-full rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-sm text-slate-100 focus:outline-none"
              />
            )}
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-slate-500">월납보험료 (원) *</span>
            <input
              value={premiumStr ? fmt(premiumOf(premiumStr)) : ''}
              onChange={(e) => setPremiumStr(e.target.value)}
              inputMode="numeric"
              placeholder="100,000"
              className="w-full rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-sm font-bold text-slate-100 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-slate-500">계약자명 (선택)</span>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="예: 김민준"
              className="w-full rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-sm text-slate-100 focus:outline-none"
            />
          </label>
        </div>

        {insurer ? (
          <div className="mt-3 text-[11px] font-semibold text-slate-500">
            {appliedRate ? (
              appliedRate.effectiveMonth ? (
                <span className="rounded-full bg-[#c6982f]/15 px-2 py-0.5 font-bold text-[#8a6a1f]">{appliedRate.effectiveMonth} 시책 요율 자동 적용</span>
              ) : (
                <span>기본 요율 자동 적용 ({month} 시책 없음)</span>
              )
            ) : (
              <span>등록된 요율 없음 — 아래에 직접 입력해 계산하세요.</span>
            )}
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ['모집자 %', 'recruiter'],
              ['상생시상 %', 'sangsaeng'],
              ['원수사시상 %', 'carrier'],
              ['13개월시상 %', 'month13']
            ] as const
          ).map(([label, key]) => (
            <label key={key} className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-slate-500">{label}</span>
              <input
                value={pct[key]}
                onChange={(e) => setPct((p) => ({ ...p, [key]: e.target.value.replace(/[^0-9.]/g, '') }))}
                inputMode="decimal"
                placeholder="0"
                className="w-full rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-sm text-slate-100 focus:outline-none"
              />
            </label>
          ))}
        </div>

        {/* 계산 결과 */}
        <div className="mt-4 rounded-xl bg-[#0e1e3a] p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ResultCell label="모집자" value={amounts.recruiter} />
            <ResultCell label="상생시상" value={amounts.sangsaeng} />
            <ResultCell label="원수사시상" value={amounts.carrier} />
            <ResultCell label="13개월시상" value={amounts.month13} pending />
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-t border-[#c6982f]/30 pt-3">
            <div>
              <div className="text-[11px] font-medium text-[#8fa3c8]">즉시 예상 수당 (모집자+상생+원수사)</div>
              <div className="text-xl font-extrabold text-[#e6c877]">{fmt(amounts.immediate)}원</div>
            </div>
            <div className="text-right">
              <div className="inline-flex items-center gap-1 text-[11px] font-medium text-[#8fa3c8]">
                <Hourglass className="h-3 w-3" /> 13회차 유지 시 합계
              </div>
              <div className="text-sm font-bold text-white">{fmt(amounts.total)}원</div>
            </div>
          </div>
        </div>

        {saveMsg ? (
          <div className={['mt-3 rounded-lg px-3 py-2 text-[12px] font-semibold', saveMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'].join(' ')}>
            {saveMsg.text}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {month} 귀속으로 저장
        </button>
      </div>

      {/* 월 요약 + 저장 목록 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="text-sm font-bold text-slate-100">{month.replace('-', '년 ')}월 예상 급여</div>
          {admin ? (
            <div className="ml-auto flex overflow-hidden rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setScope('mine')}
                className={['px-3 py-1.5 text-[11px] font-bold transition', scope === 'mine' ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-white text-slate-500'].join(' ')}
              >
                내 계산 {mine.length}
              </button>
              <button
                type="button"
                onClick={() => setScope('staff')}
                className={['px-3 py-1.5 text-[11px] font-bold transition', scope === 'staff' ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-white text-slate-500'].join(' ')}
              >
                직원 계산 {staff.length}
              </button>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryTile label="즉시 예상 수당" value={`${fmt(summary.immediate)}원`} strong />
          <SummaryTile label="13개월시상 예정" value={`${fmt(summary.month13)}원`} />
          <SummaryTile label="저장된 계산" value={`${summary.count}건`} />
        </div>

        {calcsError ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {calcsError}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-slate-700 py-6 text-center text-[12px] text-slate-500">
            {admin && scope === 'staff' ? '직원이 저장한 계산이 없습니다.' : '저장된 계산이 없습니다. 위에서 계산 후 저장해보세요.'}
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {visible.map((c) => {
              const a = calcSalaryAmounts(c.monthlyPremium, c)
              return (
                <div key={c.id} className="rounded-xl border border-slate-800 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-100">{c.insurer}</span>
                    <span className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-semibold text-slate-300">{c.productGroup}</span>
                    {admin && scope === 'staff' && c.staffName ? (
                      <span className="rounded-full bg-[#0e1e3a] px-2 py-0.5 text-[10px] font-bold text-[#e6c877]">담당 {c.staffName}</span>
                    ) : null}
                    {c.customerName ? <span className="text-[11px] text-slate-500">{c.customerName}</span> : null}
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-sm font-extrabold text-[#b0821f]">{fmt(a.immediate)}원</span>
                      <button
                        type="button"
                        onClick={() => void removeCalc(c)}
                        aria-label="계산 삭제"
                        className="rounded-lg border border-slate-800 bg-white p-1.5 text-slate-400 transition hover:border-rose-300 hover:text-rose-600"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    <span>월납 {fmt(c.monthlyPremium)}원</span>
                    <span>모집자 {fmt(a.recruiter)}</span>
                    <span>상생 {fmt(a.sangsaeng)}</span>
                    <span>원수사 {fmt(a.carrier)}</span>
                    <span className="inline-flex items-center gap-0.5 text-amber-700">
                      <Hourglass className="h-3 w-3" /> 13개월 {fmt(a.month13)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ResultCell({ label, value, pending }: { label: string; value: number; pending?: boolean }): JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-1 text-[11px] font-medium text-[#8fa3c8]">
        {label}
        {pending ? <span className="rounded-full bg-[#c6982f]/20 px-1.5 py-px text-[9px] font-bold text-[#e6c877]">유지 시</span> : null}
      </div>
      <div className="text-sm font-bold text-white">{fmt(value)}원</div>
    </div>
  )
}

function SummaryTile({ label, value, strong }: { label: string; value: string; strong?: boolean }): JSX.Element {
  return (
    <div className={['rounded-xl p-3', strong ? 'bg-[#0e1e3a]' : 'border border-slate-800 bg-white'].join(' ')}>
      <div className={['text-[11px] font-medium', strong ? 'text-[#8fa3c8]' : 'text-slate-500'].join(' ')}>{label}</div>
      <div className={['text-lg font-extrabold', strong ? 'text-[#e6c877]' : 'text-slate-100'].join(' ')}>{value}</div>
    </div>
  )
}

/** 관리자 요율표 관리 — 기본 요율 / 월 시책 전환, 행 편집/추가/삭제. RLS(owner·admin)가 실제 경계. */
function RateAdmin({ rates, month, onChanged }: { rates: CommissionRate[]; month: string; onChanged: () => void }): JSX.Element {
  interface RowDraft {
    id?: string
    insurer: string
    productGroup: string
    recruiter: string
    sangsaeng: string
    carrier: string
    month13: string
  }
  const toDraft = (r: CommissionRate): RowDraft => ({
    id: r.id,
    insurer: r.insurer,
    productGroup: r.productGroup,
    recruiter: String(r.recruiterPct),
    sangsaeng: String(r.sangsaengPct),
    carrier: String(r.carrierPct),
    month13: String(r.month13Pct)
  })
  // scope: 기본 요율('') ↔ 선택 귀속월 시책(month)
  const [scope, setScope] = useState<'base' | 'month'>('base')
  const scopeMonth = scope === 'base' ? '' : month
  const scoped = useMemo(() => sortRates(rates.filter((r) => r.effectiveMonth === scopeMonth)), [rates, scopeMonth])
  const baseRates = useMemo(() => rates.filter((r) => r.effectiveMonth === ''), [rates])
  const [rows, setRows] = useState<RowDraft[]>(scoped.map(toDraft))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | undefined>()

  useEffect(() => {
    setRows(scoped.map(toDraft))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped])

  /** 기본 요율을 이번 달 시책으로 복사 (이미 시책이 있는 보험사×상품군은 건너뜀). */
  const copyBaseToMonth = async (): Promise<void> => {
    const missing = baseRates.filter(
      (b) => !rates.some((r) => r.effectiveMonth === month && r.insurer === b.insurer && r.productGroup === b.productGroup)
    )
    if (missing.length === 0) {
      setMsg({ ok: false, text: `${month} 시책이 이미 모두 만들어져 있습니다.` })
      return
    }
    setBusy(true)
    setMsg(undefined)
    let fail = 0
    for (const b of missing) {
      const res = await saveCommissionRate({
        insurer: b.insurer,
        productGroup: b.productGroup,
        effectiveMonth: month,
        recruiterPct: b.recruiterPct,
        sangsaengPct: b.sangsaengPct,
        carrierPct: b.carrierPct,
        month13Pct: b.month13Pct
      })
      if (!res.ok) fail++
    }
    setBusy(false)
    setMsg(
      fail === 0
        ? { ok: true, text: `기본 요율 ${missing.length}건을 ${month} 시책으로 복사했습니다. 시책 값만 고쳐 저장하세요.` }
        : { ok: false, text: `${missing.length}건 중 ${fail}건 복사 실패 — 새로고침 후 다시 시도해 주세요.` }
    )
    onChanged()
  }

  const setRow = (i: number, patch: Partial<RowDraft>): void =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const saveRow = async (r: RowDraft): Promise<void> => {
    if (!r.insurer.trim()) {
      setMsg({ ok: false, text: '보험사를 입력해 주세요.' })
      return
    }
    setBusy(true)
    setMsg(undefined)
    const res = await saveCommissionRate(
      {
        insurer: r.insurer,
        productGroup: r.productGroup || '공통',
        effectiveMonth: scopeMonth,
        recruiterPct: pctOf(r.recruiter),
        sangsaengPct: pctOf(r.sangsaeng),
        carrierPct: pctOf(r.carrier),
        month13Pct: pctOf(r.month13)
      },
      r.id
    )
    setBusy(false)
    setMsg(
      res.ok
        ? { ok: true, text: `${r.insurer} · ${r.productGroup || '공통'} ${scopeMonth ? `${scopeMonth} 시책` : '기본'} 요율을 저장했습니다.` }
        : { ok: false, text: res.error ?? '저장 실패' }
    )
    if (res.ok) onChanged()
  }

  const removeRow = async (r: RowDraft, i: number): Promise<void> => {
    if (!r.id) {
      setRows((rs) => rs.filter((_, j) => j !== i))
      return
    }
    if (typeof window !== 'undefined' && !window.confirm(`${r.insurer} · ${r.productGroup} 요율을 삭제할까요?`)) return
    setBusy(true)
    const res = await deleteCommissionRate(r.id)
    setBusy(false)
    setMsg(res.ok ? { ok: true, text: '삭제했습니다.' } : { ok: false, text: res.error ?? '삭제 실패' })
    if (res.ok) onChanged()
  }

  return (
    <div className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-slate-100">요율표 관리 (관리자)</span>
        <div className="flex overflow-hidden rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setScope('base')}
            className={['px-2.5 py-1 text-[11px] font-bold transition', scope === 'base' ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-white text-slate-500'].join(' ')}
          >
            기본 요율
          </button>
          <button
            type="button"
            onClick={() => setScope('month')}
            className={['px-2.5 py-1 text-[11px] font-bold transition', scope === 'month' ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-white text-slate-500'].join(' ')}
          >
            {month} 시책 {rates.filter((r) => r.effectiveMonth === month).length}
          </button>
        </div>
        {scope === 'month' ? (
          <button
            type="button"
            onClick={() => void copyBaseToMonth()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-[#c6982f]/50 bg-[#c6982f]/10 px-2.5 py-1 text-[11px] font-bold text-[#8a6a1f] transition hover:bg-[#c6982f]/20 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" /> 기본 요율 복사해 시책 만들기
          </button>
        ) : null}
      </div>
      <p className="mb-3 text-[11px] text-slate-500">
        {scope === 'base'
          ? '평소 적용되는 보험사 × 상품군별 수당 % — 저장하면 전 직원 계산기에 바로 적용됩니다.'
          : `${month} 한 달에만 적용되는 시책 요율 — 이 달 계산에는 시책이 기본 요율보다 우선하고, 시책이 없는 보험사는 기본 요율로 계산됩니다. 시책은 다음 달로 이월되지 않습니다.`}
      </p>
      {msg ? (
        <div className={['mb-2 rounded-lg px-3 py-2 text-[12px] font-semibold', msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'].join(' ')}>{msg.text}</div>
      ) : null}
      <div className="overflow-x-auto">
        <div className="min-w-[720px] space-y-1.5">
          <div className="grid grid-cols-[1.2fr_1fr_repeat(4,0.7fr)_auto] items-center gap-1.5 px-1 text-[10px] font-bold text-slate-500">
            <span>보험사</span>
            <span>상품군</span>
            <span>모집자%</span>
            <span>상생%</span>
            <span>원수사%</span>
            <span>13개월%</span>
            <span />
          </div>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 py-4 text-center text-[11px] text-slate-500">
              {scope === 'month' ? `${month} 시책이 없습니다 — 위 [기본 요율 복사] 버튼으로 시작하세요.` : '등록된 요율이 없습니다. 아래 행 추가로 시작하세요.'}
            </div>
          ) : null}
          {rows.map((r, i) => (
            <div key={r.id ?? `new-${i}`} className="grid grid-cols-[1.2fr_1fr_repeat(4,0.7fr)_auto] items-center gap-1.5">
              {r.id ? (
                <span className="truncate px-1 text-[12px] font-semibold text-slate-100">{r.insurer}</span>
              ) : (
                <select
                  value={r.insurer}
                  onChange={(e) => setRow(i, { insurer: e.target.value })}
                  className="rounded-lg border border-slate-800 bg-white px-1.5 py-1.5 text-[12px] text-slate-100 focus:outline-none"
                >
                  <option value="">보험사 선택</option>
                  {INSURERS.map((ins) => (
                    <option key={ins} value={ins}>
                      {ins}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={r.productGroup}
                onChange={(e) => setRow(i, { productGroup: e.target.value })}
                placeholder="공통"
                disabled={Boolean(r.id)}
                className="rounded-lg border border-slate-800 bg-white px-1.5 py-1.5 text-[12px] text-slate-100 focus:outline-none disabled:text-slate-400"
              />
              {(
                [
                  ['recruiter', r.recruiter],
                  ['sangsaeng', r.sangsaeng],
                  ['carrier', r.carrier],
                  ['month13', r.month13]
                ] as const
              ).map(([key, val]) => (
                <input
                  key={key}
                  value={val}
                  onChange={(e) => setRow(i, { [key]: e.target.value.replace(/[^0-9.]/g, '') } as Partial<RowDraft>)}
                  inputMode="decimal"
                  className="rounded-lg border border-slate-800 bg-white px-1.5 py-1.5 text-[12px] text-slate-100 focus:outline-none"
                />
              ))}
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void saveRow(r)}
                  disabled={busy}
                  className="rounded-lg bg-[#0e1e3a] px-2 py-1.5 text-[11px] font-bold text-[#e6c877] disabled:opacity-50"
                >
                  저장
                </button>
                <button
                  type="button"
                  onClick={() => void removeRow(r, i)}
                  disabled={busy}
                  aria-label="요율 삭제"
                  className="rounded-lg border border-slate-800 bg-white p-1.5 text-slate-400 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setRows((rs) => [...rs, { insurer: '', productGroup: '', recruiter: '', sangsaeng: '', carrier: '', month13: '' }])}
        className="mt-2 inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-700 px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
      >
        <Plus className="h-3 w-3" /> 상품군/보험사 행 추가
      </button>
    </div>
  )
}
