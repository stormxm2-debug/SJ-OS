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
  Hourglass,
  Users
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
import {
  getMemberRate,
  memberMonthlySales,
  calcMemberSalary,
  saveMemberRate,
  listMemberRates,
  createMemberCalc,
  type MemberSales
} from '@renderer/services/commercial/salaryMemberRateService'
import { loadStaffDirectory, type StaffDirectoryEntry } from '@renderer/services/commercial/performanceRecordsService'

/**
 * 급여 계산기 — 수당 4종(모집자·상생시상·원수사시상·13개월시상), 월납보험료 기준 %.
 *
 * - 심플↔디테일 토글: 심플 = 보험사+월납보험료만 넣으면 요율표 자동 적용으로 즉시
 *   수당 표시(순수 계산 전용, 저장 없음). 디테일 = 기존 전체 기능. 마지막 모드 기억.
 * - 요율표(보험사×상품군)는 관리자가 관리, 전 직원 자동 적용. 요율은 계산 시 수정 가능.
 * - 13개월시상은 13회차 유지 시 지급되는 조건부 수당 — 즉시 수당과 분리 표시.
 * - 계산 저장 → 귀속월별 예상 급여 합산. 관리자는 "내 계산/직원 계산" 분리(원칙 준수).
 * - 서버 미연결이어도 계산기 자체는 동작(요율 자동 로드·저장만 서버 필요).
 */

const fmt = (n: number): string => n.toLocaleString('ko-KR')

type CalcMode = 'simple' | 'detail'
const MODE_KEY = 'sj-salary-calc-mode'

function initialMode(): CalcMode {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(MODE_KEY) === 'detail' ? 'detail' : 'simple'
  } catch {
    return 'simple'
  }
}

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
  const [mode, setMode] = useState<CalcMode>(initialMode)

  const switchMode = (m: CalcMode): void => {
    setMode(m)
    try {
      window.localStorage.setItem(MODE_KEY, m)
    } catch {
      /* 기억 실패해도 동작엔 지장 없음 */
    }
  }

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
            <p className="text-[12px] text-slate-500">
              {mode === 'simple'
                ? '생명·손해·단기납 매출에 회원별 요율(%)을 적용해 수당을 계산합니다'
                : '모집자 + 상생시상 + 원수사시상 + 13개월시상 — 월납보험료 기준 %'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex overflow-hidden rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => switchMode('simple')}
                className={['px-3 py-1.5 text-[11px] font-bold transition', mode === 'simple' ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-white text-slate-500'].join(' ')}
              >
                심플
              </button>
              <button
                type="button"
                onClick={() => switchMode('detail')}
                className={['px-3 py-1.5 text-[11px] font-bold transition', mode === 'detail' ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-white text-slate-500'].join(' ')}
              >
                디테일
              </button>
            </div>
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

      {/* 심플 — 생명·손해·단기납 매출 × 회원별 요율 (실적 연동) */}
      {mode === 'simple' ? <SimpleMemberSalary admin={admin} month={month} /> : null}

      {/* 계산기 (디테일) */}
      {mode === 'detail' ? (
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
      ) : null}

      {/* 월 요약 + 저장 목록 (디테일 전용) */}
      {mode === 'detail' ? (
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
      ) : null}
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

/**
 * 심플(개편) — 생명·손해·단기납 '매출 × 회원별 요율(%)' 로 수당 계산.
 * 회원 선택(관리자) 또는 본인 고정 → 그 회원 요율 + 그 달 실적 매출 자동 로드(수정 가능) → 즉시 수당.
 * 관리자는 [회원 요율 관리]에서 직원별 %를 입력한다. RLS(owner·admin 쓰기, 본인 조회)가 실제 경계.
 */
function SimpleMemberSalary({ admin, month }: { admin: boolean; month: string }): JSX.Element {
  const { session } = useSession()
  const [staffId, setStaffId] = useState<string>(session.id)
  const [staffName, setStaffName] = useState<string>(session.name || '나')
  const [staffList, setStaffList] = useState<StaffDirectoryEntry[]>([])
  const [rate, setRate] = useState<{ lifePct: number; nonLifePct: number; shortPct: number }>({ lifePct: 0, nonLifePct: 0, shortPct: 0 })
  const [sales, setSales] = useState<MemberSales>({ life: 0, nonLife: 0, shortTerm: 0 })
  const [loading, setLoading] = useState(true)
  const [rateAdminOpen, setRateAdminOpen] = useState(false)
  const [saveNote, setSaveNote] = useState('')

  // 관리자: 직원 목록(회원 선택용)
  useEffect(() => {
    if (!admin) return
    void loadStaffDirectory().then((r) => setStaffList((r as { data?: StaffDirectoryEntry[] }).data ?? []))
  }, [admin])

  // 회원의 요율 + 그 달 실적 매출을 불러온다(수정 가능).
  const doLoad = async (): Promise<void> => {
    setLoading(true)
    const [rt, sl] = await Promise.all([getMemberRate(staffId), memberMonthlySales(staffId, month)])
    setRate({ lifePct: rt.lifePct, nonLifePct: rt.nonLifePct, shortPct: rt.shortPct })
    setSales(sl)
    setLoading(false)
  }
  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([getMemberRate(staffId), memberMonthlySales(staffId, month)]).then(([rt, sl]) => {
      if (!alive) return
      setRate({ lifePct: rt.lifePct, nonLifePct: rt.nonLifePct, shortPct: rt.shortPct })
      setSales(sl)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [staffId, month])

  const bd = calcMemberSalary(sales, rate)
  const setSale = (k: keyof MemberSales, v: string): void => setSales((s) => ({ ...s, [k]: premiumOf(v) }))
  const pickStaff = (id: string): void => {
    setStaffId(id)
    setStaffName(id === session.id ? session.name || '나' : staffList.find((s) => s.profileId === id)?.name ?? '')
    setSaveNote('')
  }
  const save = async (): Promise<void> => {
    const r = await createMemberCalc({ staffId, calcMonth: month, sales, rate, total: bd.total })
    setSaveNote(r.ok ? '저장했습니다.' : r.error ?? '저장 실패')
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-slate-100">매출별 수당 (심플)</div>
        {admin ? (
          <button
            type="button"
            onClick={() => setRateAdminOpen((v) => !v)}
            className={['inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition', rateAdminOpen ? 'bg-[#0e1e3a] text-[#e6c877]' : 'border border-slate-800 bg-white text-slate-400 hover:text-indigo-600'].join(' ')}
          >
            <Settings2 className="h-3.5 w-3.5" /> 회원 요율 관리
          </button>
        ) : null}
      </div>

      {admin && rateAdminOpen ? <MemberRateAdmin staffList={staffList} onChanged={() => void doLoad()} /> : null}

      {/* 회원(직원) 선택 — 관리자는 전 직원, 직원은 본인 고정 */}
      <div className="mb-3">
        <span className="mb-1.5 block text-[11px] font-medium text-slate-500">회원 (직원)</span>
        {admin ? (
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 shrink-0 text-slate-400" />
            <select
              value={staffId}
              onChange={(e) => pickStaff(e.target.value)}
              className="min-w-[10rem] flex-1 rounded-lg border border-slate-800 bg-white px-2.5 py-2 text-[13px] font-semibold text-slate-100 focus:outline-none"
            >
              <option value={session.id}>{session.name || '나'} (나)</option>
              {staffList
                .filter((s) => s.profileId !== session.id)
                .map((s) => (
                  <option key={s.profileId} value={s.profileId}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-[13px] font-bold text-slate-100">
            <Users className="h-4 w-4 text-[#c6982f]" /> {session.name || '나'}
          </div>
        )}
      </div>

      {/* 이 회원의 요율 */}
      <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
        {([['생명', rate.lifePct], ['손해', rate.nonLifePct], ['단기납', rate.shortPct]] as const).map(([lbl, p]) => (
          <span key={lbl} className="rounded-full border border-slate-800 bg-slate-950 px-2.5 py-1 font-semibold text-slate-300">
            {lbl} <span className="text-[#e6c877]">{p}%</span>
          </span>
        ))}
        {rate.lifePct === 0 && rate.nonLifePct === 0 && rate.shortPct === 0 ? (
          <span className="text-slate-500">{admin ? '요율 미설정 — [회원 요율 관리]에서 입력' : '요율 미설정 — 관리자에게 문의'}</span>
        ) : null}
      </div>

      {/* 매출 3종 — 실적 자동 + 수정 가능 */}
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-500">이 달 매출 (실적에서 불러옴 · 수정 가능)</span>
        <button type="button" onClick={() => void doLoad()} className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-indigo-600">
          <RefreshCw className="h-3 w-3" /> 실적 다시 불러오기
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {([['생명', 'life'], ['손해', 'nonLife'], ['단기납', 'shortTerm']] as const).map(([lbl, key]) => (
          <label key={key} className="block">
            <span className="mb-1 block text-[10px] font-semibold text-slate-500">{lbl} 매출(원)</span>
            <input
              value={sales[key] ? fmt(sales[key]) : ''}
              onChange={(e) => setSale(key, e.target.value)}
              inputMode="numeric"
              placeholder="0"
              className="w-full rounded-lg border border-slate-800 bg-white px-2.5 py-2 text-[14px] font-bold text-slate-100 focus:outline-none"
            />
          </label>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-slate-400">단기납은 회사 규칙상 60% 반영이 필요하면 매출을 조정하거나 단기납 %에 반영하세요.</p>

      {/* 결과 */}
      <div className="mt-4 rounded-xl bg-[#0e1e3a] p-5 text-center">
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-[13px] text-[#8fa3c8]">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
          </div>
        ) : (
          <>
            <div className="text-[12px] font-medium text-[#8fa3c8]">예상 수당 합계</div>
            <div className="mt-1 text-3xl font-extrabold text-[#e6c877]">{fmt(bd.total)}원</div>
            <div className="mt-3 border-t border-[#c6982f]/30 pt-2 text-[11px] text-[#8fa3c8]">
              생명 {fmt(bd.life)} · 손해 {fmt(bd.nonLife)} · 단기납 {fmt(bd.short)}
            </div>
          </>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-500">{staffName ? `${staffName} · ${month.replace('-', '년 ')}월` : ''}</span>
        <button
          type="button"
          onClick={() => void save()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-[12px] font-bold text-white"
        >
          <Save className="h-3.5 w-3.5" /> 이 달 급여로 저장
        </button>
      </div>
      {saveNote ? <p className="mt-1.5 text-right text-[11px] font-semibold text-[#8a6a1f]">{saveNote}</p> : null}
    </div>
  )
}

/** 관리자: 직원별 생명/손해/단기납 요율(%) 입력표. RLS(owner·admin)가 실제 경계. */
function MemberRateAdmin({ staffList, onChanged }: { staffList: StaffDirectoryEntry[]; onChanged: () => void }): JSX.Element {
  type Row = { life: string; nonLife: string; short: string }
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    void listMemberRates().then((r) => {
      if (!r.ok) {
        setErr(r.error ?? '')
        return
      }
      const map: Record<string, Row> = {}
      for (const it of r.items) map[it.staffId] = { life: String(it.lifePct), nonLife: String(it.nonLifePct), short: String(it.shortPct) }
      setRows(map)
    })
  }, [])

  const val = (id: string): Row => rows[id] ?? { life: '', nonLife: '', short: '' }
  const setVal = (id: string, patch: Partial<Row>): void => setRows((r) => ({ ...r, [id]: { ...val(id), ...patch } }))
  const pctNum = (s: string): number => {
    const n = Number(s)
    return Number.isFinite(n) && n >= 0 ? n : 0
  }
  const saveOne = async (id: string): Promise<void> => {
    setBusy(id)
    const v = val(id)
    const r = await saveMemberRate(id, { lifePct: pctNum(v.life), nonLifePct: pctNum(v.nonLife), shortPct: pctNum(v.short) })
    setBusy('')
    if (!r.ok) {
      setErr(r.error ?? '저장 실패')
      return
    }
    setErr('')
    onChanged()
  }

  return (
    <div className="mb-3 rounded-xl border border-[#c6982f]/40 bg-[#fdf9f0] p-3">
      <div className="mb-2 text-[12px] font-bold text-[#8a6a1f]">회원별 요율 (%) — 관리자 전용 (급여 민감정보)</div>
      {err ? <div className="mb-2 text-[11px] font-semibold text-rose-600">{err}</div> : null}
      <div className="grid grid-cols-[1.4fr_repeat(3,0.9fr)_auto] items-center gap-1.5 text-[10px] font-bold text-slate-500">
        <span className="px-1">직원</span>
        <span className="text-center">생명%</span>
        <span className="text-center">손해%</span>
        <span className="text-center">단기납%</span>
        <span />
      </div>
      <div className="mt-1 space-y-1">
        {staffList.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 py-3 text-center text-[11px] text-slate-500">직원 목록을 불러오는 중…</div>
        ) : (
          staffList.map((s) => {
            const v = val(s.profileId)
            return (
              <div key={s.profileId} className="grid grid-cols-[1.4fr_repeat(3,0.9fr)_auto] items-center gap-1.5">
                <span className="truncate px-1 text-[12px] font-semibold text-slate-100">{s.name}</span>
                {(['life', 'nonLife', 'short'] as const).map((k) => (
                  <input
                    key={k}
                    value={v[k]}
                    onChange={(e) => setVal(s.profileId, { [k]: e.target.value.replace(/[^0-9.]/g, '') } as Partial<Row>)}
                    inputMode="decimal"
                    placeholder="0"
                    className="rounded-lg border border-slate-800 bg-white px-1.5 py-1.5 text-center text-[12px] text-slate-100 focus:outline-none"
                  />
                ))}
                <button
                  type="button"
                  onClick={() => void saveOne(s.profileId)}
                  disabled={busy === s.profileId}
                  className="rounded-lg bg-[#0e1e3a] px-2 py-1.5 text-[11px] font-bold text-[#e6c877] disabled:opacity-50"
                >
                  {busy === s.profileId ? '…' : '저장'}
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
