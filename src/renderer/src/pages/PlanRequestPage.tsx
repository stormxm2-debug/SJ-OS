import { useEffect, useMemo, useState } from 'react'
import {
  FileSignature,
  Search,
  Copy,
  Check,
  Share2,
  Save,
  Trash2,
  ChevronRight,
  Users,
  Info,
  Phone,
  X,
  Plus,
  Building2,
  Bookmark,
  BookmarkPlus,
  HeartPulse
} from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import { listCustomers, type CustomerDataMode } from '@renderer/services/commercial/customerService'
import type { CustomerRecord } from '@shared/commercial/models'
import { shareMeetingText } from '@renderer/services/share/meetingShare'
import { copyText as copyToClipboard } from '@renderer/services/share/clipboard'
import { INSURERS } from '@renderer/services/commercial/registrationService'
import { listCompanyContacts, type CompanyContact } from '@renderer/services/commercial/companyContactsService'
import { takePlanRequestPrefill } from '@renderer/services/commercial/planRequestPrefill'
import { getHubCustomer, setHubCustomer, subscribeHubCustomer } from '@renderer/services/insurance-hub/insuranceHubStore'
import InsuranceHubBar from '@renderer/components/insurance-hub/InsuranceHubBar'
import {
  INSURANCE_KINDS,
  DRIVING_OPTIONS,
  COVERAGE_GROUPS,
  BUDGET_PRESETS,
  PAYMENT_TERM_OPTIONS,
  MATURITY_OPTIONS,
  RENEWAL_OPTIONS,
  amountPresetsFor,
  customerProfileInfo,
  insuranceAge,
  buildPlanRequestMessage,
  listPlanRequests,
  createPlanRequest,
  updatePlanRequestStatus,
  deletePlanRequest,
  nextPlanStatus,
  listPlanTemplates,
  savePlanTemplate,
  deletePlanTemplate,
  PLAN_STATUS_LABEL,
  type PlanRequest,
  type PlanDataMode,
  type PlanRequestStatus,
  type PlanConditions,
  type PlanTemplate,
  type CoverageItem
} from '@renderer/services/commercial/planRequestService'

/**
 * 설계 요청서 — 고객을 고르면 인적사항(생년월일·성별·보험연령)이 자동으로 채워지고,
 * 보험 구분·특약(가입금액)·운전 여부만 체크하면 매니저에게 보낼 설계요청 문자가
 * 실시간으로 완성된다. [복사]/[카톡 공유] 후 요청 이력이 저장되어 고객별로
 * 요청 → 설계받음 → 제안 → 계약 진행을 추적한다.
 *
 * 접근 범위: FC 본인 것만(RLS), 관리자는 내 것 기본 + 직원 것 토글.
 */

const STATUS_CHIP: Record<PlanRequestStatus, string> = {
  requested: 'bg-slate-950 text-slate-300 ring-1 ring-slate-800',
  received: 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200',
  proposed: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  contracted: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  dropped: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200'
}

export default function PlanRequestPage(): JSX.Element {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const admin = isAdminRole(session.role)

  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [custMode, setCustMode] = useState<CustomerDataMode>('local-mock')
  const [requests, setRequests] = useState<PlanRequest[]>([])
  const [reqMode, setReqMode] = useState<PlanDataMode>('local')
  const [includeStaff, setIncludeStaff] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 폼 상태 — 고객은 보험 허브의 "현재 작업 중 고객"과 양방향 동기화
  const [q, setQ] = useState('')
  const [customer, setCustomer] = useState<CustomerRecord | null>(() => getHubCustomer())
  const [manualName, setManualName] = useState('')
  const [manualBirth, setManualBirth] = useState('')
  const [manualGender, setManualGender] = useState<'남' | '여' | ''>('')
  const [driving, setDriving] = useState<string>(DRIVING_OPTIONS[0])
  const [kind, setKind] = useState<string>(INSURANCE_KINDS[0])
  const [coverages, setCoverages] = useState<CoverageItem[]>([])
  const [customCov, setCustomCov] = useState('')
  const [extra, setExtra] = useState('')

  // v2 — 요청 대상(보험사·매니저), 계약자, 설계 조건, 병력 고지, 특약 세트
  const [insurers, setInsurers] = useState<string[]>([])
  const [managerName, setManagerName] = useState('')
  const [contacts, setContacts] = useState<CompanyContact[]>([])
  const [diffPolicyholder, setDiffPolicyholder] = useState(false)
  const [policyholderName, setPolicyholderName] = useState('')
  const [budget, setBudget] = useState('')
  const [paymentTerm, setPaymentTerm] = useState('')
  const [maturity, setMaturity] = useState('')
  const [renewal, setRenewal] = useState('')
  const [includeMedical, setIncludeMedical] = useState(false)
  const [medicalNotes, setMedicalNotes] = useState('')
  const [templates, setTemplates] = useState<PlanTemplate[]>([])
  const [tplOpen, setTplOpen] = useState(false)
  const [tplName, setTplName] = useState('')
  const [tplSaving, setTplSaving] = useState(false)
  /** 직접 수정한 문자(메모). null = 자동 생성 문안 사용. 수정 후에도 되돌리기 가능. */
  const [editedMessage, setEditedMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<'copied' | 'shared' | 'saved' | 'failed' | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [custRes, reqRes] = await Promise.all([listCustomers(), listPlanRequests()])
      if (!alive) return
      setCustMode(custRes.mode)
      setCustomers(custRes.ok ? custRes.customers : [])
      setReqMode(reqRes.mode)
      setRequests(reqRes.ok ? reqRes.requests : [])
      if (!reqRes.ok) setError(reqRes.error ?? '요청 이력을 불러오지 못했습니다.')
    })()
    return () => {
      alive = false
    }
  }, [session.id])

  const refresh = async (): Promise<void> => {
    const res = await listPlanRequests()
    setReqMode(res.mode)
    setRequests(res.ok ? res.requests : [])
  }

  // v2 초기화 — 매니저 연락처부·특약 세트 로드, 보험 허브 동기화,
  // 사전심사/보장분석에서 넘어온 프리필(1회용) 소비.
  useEffect(() => {
    void listCompanyContacts().then((r) => {
      if (r.ok) setContacts(r.items)
    })
    void listPlanTemplates().then(setTemplates)
    const unsub = subscribeHubCustomer(setCustomer)
    const pre = takePlanRequestPrefill()
    if (pre) {
      if (pre.customer) setHubCustomer(pre.customer)
      if (pre.insuranceKind) setKind(pre.insuranceKind)
      if (pre.coverages && pre.coverages.length > 0) setCoverages(sortCoverages(pre.coverages))
      if (pre.extraRequest) setExtra(pre.extraRequest)
      if (pre.medicalNotes) setMedicalNotes(pre.medicalNotes)
      if (pre.includeMedical) setIncludeMedical(true)
    }
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 간편심사(유병자) 선택 시 병력 고지 자동 포함 — 매니저가 되묻지 않게.
  useEffect(() => {
    if (kind !== '간편심사(유병자)' || includeMedical) return
    const seed = medicalNotes || customer?.medicalHistory || ''
    if (seed) {
      setIncludeMedical(true)
      if (!medicalNotes) setMedicalNotes(seed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  // 내 고객만 (폼 고객목록 원칙)
  const myCustomers = useMemo(() => {
    if (custMode !== 'supabase') return customers
    return customers.filter((c) => c.ownerStaffId === session.id)
  }, [customers, custMode, session.id])

  const filtered = useMemo(() => {
    const t = q.trim()
    if (!t) return []
    return myCustomers.filter((c) => c.name.includes(t) || (c.phone ?? '').includes(t)).slice(0, 6)
  }, [q, myCustomers])

  // 인적사항 — 고객 선택 시 자동, 아니면 수동 입력
  const profile = useMemo(() => {
    if (customer) return customerProfileInfo(customer)
    return { birthDate: manualBirth || undefined, gender: manualGender || undefined, insAge: insuranceAge(manualBirth || undefined) }
  }, [customer, manualBirth, manualGender])

  const name = customer ? customer.name : manualName

  const conditions = useMemo<PlanConditions>(
    () => ({
      budget: budget.trim() || undefined,
      paymentTerm: paymentTerm || undefined,
      maturity: maturity || undefined,
      renewal: renewal || undefined,
      medicalNotes: includeMedical && medicalNotes.trim() ? medicalNotes.trim() : undefined
    }),
    [budget, paymentTerm, maturity, renewal, includeMedical, medicalNotes]
  )

  const message = useMemo(
    () =>
      buildPlanRequestMessage({
        customerName: name.trim() || '(고객명)',
        gender: profile.gender,
        birthDate: profile.birthDate,
        insAge: profile.insAge,
        driving,
        insuranceKind: kind,
        coverages,
        extraRequest: extra,
        insurers,
        managerName,
        policyholderName: diffPolicyholder ? policyholderName : undefined,
        conditions
      }),
    [name, profile, driving, kind, coverages, extra, insurers, managerName, diffPolicyholder, policyholderName, conditions]
  )
  /** 실제 복사·공유·저장에 쓰는 최종 문안 — 직접 수정본이 있으면 그것을 우선. */
  const finalMessage = editedMessage ?? message

  /** 체크 시 보장분석표 순서(카테고리→담보)대로 정렬 유지 — 문안 그룹 출력의 기반. */
  const sortCoverages = (list: CoverageItem[]): CoverageItem[] => {
    const order = new Map<string, number>()
    let i = 0
    for (const g of COVERAGE_GROUPS) for (const item of g.items) order.set(`${g.category}:${item}`, i++)
    return [...list].sort((a, b) => {
      const oa = order.get(`${a.category ?? ''}:${a.name}`) ?? 9999
      const ob = order.get(`${b.category ?? ''}:${b.name}`) ?? 9999
      return oa - ob
    })
  }

  const toggleCoverage = (category: string, covName: string): void => {
    setCoverages((prev) => {
      const exists = prev.find((c) => c.name === covName && c.category === category)
      if (exists) return prev.filter((c) => !(c.name === covName && c.category === category))
      return sortCoverages([...prev, { name: covName, amount: amountPresetsFor(category).defaultAmount, category }])
    })
  }

  const setAmount = (category: string | undefined, covName: string, amount: string): void => {
    setCoverages((prev) => prev.map((c) => (c.name === covName && c.category === category ? { ...c, amount } : c)))
  }

  const addCustom = (): void => {
    const n = customCov.trim()
    if (!n || coverages.some((c) => c.name === n)) return
    setCoverages((prev) => [...prev, { name: n, amount: amountPresetsFor(undefined).defaultAmount }])
    setCustomCov('')
  }

  /* ---- 자주 쓰는 특약 세트 ---- */

  const applyTemplate = (t: PlanTemplate): void => {
    setKind(t.insuranceKind)
    setCoverages(sortCoverages(t.coverages))
    if (t.driving) setDriving(t.driving)
    setBudget(t.conditions.budget ?? '')
    setPaymentTerm(t.conditions.paymentTerm ?? '')
    setMaturity(t.conditions.maturity ?? '')
    setRenewal(t.conditions.renewal ?? '')
    setEditedMessage(null)
  }

  const saveTemplate = async (): Promise<void> => {
    if (tplSaving || !tplName.trim()) return
    setTplSaving(true)
    const res = await savePlanTemplate({
      name: tplName,
      insuranceKind: kind,
      coverages,
      driving,
      conditions: {
        budget: budget.trim() || undefined,
        paymentTerm: paymentTerm || undefined,
        maturity: maturity || undefined,
        renewal: renewal || undefined
      }
    })
    setTplSaving(false)
    if (!res.ok) {
      setError(res.error ?? '세트 저장에 실패했습니다.')
      return
    }
    setTplName('')
    setTemplates(await listPlanTemplates())
  }

  const removeTemplate = async (t: PlanTemplate): Promise<void> => {
    if (!window.confirm(`'${t.name}' 세트를 삭제할까요?`)) return
    await deletePlanTemplate(t.id)
    setTemplates(await listPlanTemplates())
  }

  /** 매니저 후보 — 보험사를 골랐으면 그 회사 매니저만, 아니면 전체. */
  const managerOptions = useMemo(
    () => (insurers.length > 0 ? contacts.filter((c) => insurers.includes(c.insurer)) : contacts),
    [contacts, insurers]
  )

  const showFlash = (kindOf: typeof flash): void => {
    setFlash(kindOf)
    window.setTimeout(() => setFlash(null), 3000)
  }

  /** 저장 — 이력에 남긴다 (복사·공유와 독립). */
  const save = async (): Promise<void> => {
    if (busy || !name.trim()) return
    setBusy(true)
    const res = await createPlanRequest(
      {
        customerId: customer?.id,
        customerName: name,
        insuranceKind: kind,
        coverages,
        driving,
        extraRequest: extra,
        messageText: finalMessage,
        managerName: managerName.trim() || undefined,
        insurers,
        policyholderName: diffPolicyholder ? policyholderName : undefined,
        conditions
      },
      { id: session.id, name: session.name }
    )
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? '저장에 실패했습니다.')
      showFlash('failed')
      return
    }
    setError(null)
    showFlash('saved')
    await refresh()
  }

  const copyText = async (text: string): Promise<void> => {
    // 인앱 브라우저(카톡 등)에서 표준 API가 막히면 execCommand 폴백까지 시도한다.
    const ok = await copyToClipboard(text)
    showFlash(ok ? 'copied' : 'failed')
  }

  /** 복사 + 자동 저장 — 매니저에게 보내는 순간이 곧 요청 시점. */
  const copyAndSave = async (): Promise<void> => {
    await copyText(finalMessage)
    if (name.trim()) await save()
  }

  const shareKakao = async (): Promise<void> => {
    const outcome = await shareMeetingText(finalMessage)
    showFlash(outcome === 'failed' ? 'failed' : outcome === 'shared' ? 'shared' : 'copied')
    if (outcome !== 'failed' && name.trim()) await save()
  }

  const advance = async (r: PlanRequest): Promise<void> => {
    const next = nextPlanStatus(r.status)
    if (!next || busy) return
    setBusy(true)
    await updatePlanRequestStatus(r.id, next)
    setBusy(false)
    await refresh()
  }

  const drop = async (r: PlanRequest): Promise<void> => {
    if (busy) return
    setBusy(true)
    await updatePlanRequestStatus(r.id, 'dropped')
    setBusy(false)
    await refresh()
  }

  const remove = async (r: PlanRequest): Promise<void> => {
    if (busy) return
    if (!window.confirm(`'${r.customerName}' 설계 요청 기록을 삭제할까요?`)) return
    setBusy(true)
    await deletePlanRequest(r.id)
    setBusy(false)
    await refresh()
  }

  const visible = useMemo(() => {
    if (reqMode !== 'supabase') return requests
    if (admin && includeStaff) return requests
    return requests.filter((r) => r.fcId === session.id)
  }, [requests, reqMode, admin, includeStaff, session.id])

  const input =
    'w-full rounded-xl border border-slate-800 bg-white px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#c6982f] focus:outline-none'

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <InsuranceHubBar current="plan-request" />
      {/* 헤더 — 딥네이비 + 골드 */}
      <div
        className="relative overflow-hidden rounded-2xl p-5 text-white"
        style={{
          background:
            'radial-gradient(480px 180px at 90% -30%, rgba(198,152,47,0.2), rgba(198,152,47,0) 60%), linear-gradient(120deg, #0e1e3a 0%, #16294b 70%, #1d2f57 100%)'
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#c6982f] to-transparent opacity-80" />
        <div className="flex items-center gap-2">
          <FileSignature className="h-5 w-5 text-[#e6c877]" />
          <h1 className="text-lg font-bold">설계 요청서</h1>
        </div>
        <p className="mt-1 text-xs text-white/60">
          고객을 고르면 인적사항이 자동으로 채워지고, 특약만 체크하면 매니저에게 보낼 문자가 완성됩니다.
        </p>
      </div>

      {/* 1) 고객 선택 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-100">1. 고객</h2>
        {customer ? (
          <div className="mt-2 flex items-center justify-between rounded-xl bg-slate-950 px-3 py-2.5">
            <div className="text-sm">
              <span className="font-bold text-slate-100">{customer.name}</span>
              <span className="ml-2 text-[11px] text-slate-500">
                {profile.birthDate ?? '생년월일 미입력'}
                {profile.gender ? ` · ${profile.gender}` : ''}
                {profile.insAge !== null ? (
                  <>
                    {' · '}
                    <b className="text-[#8a6a1e]">보험연령 {profile.insAge}세</b>
                  </>
                ) : ''}
              </span>
            </div>
            <button type="button" onClick={() => setHubCustomer(null)} className="rounded-lg p-1 text-slate-400 hover:text-slate-200" aria-label="고객 선택 해제">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="mt-2 flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-2">
              <Search className="h-3.5 w-3.5 text-slate-500" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="내 고객 이름/전화 검색" className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500" />
            </div>
            {filtered.length > 0 ? (
              <div className="mt-1 space-y-0.5">
                {filtered.map((c) => {
                  const info = customerProfileInfo(c)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setHubCustomer(c)
                        setQ('')
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-950"
                    >
                      <span className="font-semibold text-slate-100">{c.name}</span>
                      <span className="text-[11px] text-slate-500">
                        {info.birthDate ?? ''} {info.insAge !== null ? `· 보험연령 ${info.insAge}세` : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : null}
            {/* 미등록 고객 직접 입력 */}
            <div className="mt-2 grid grid-cols-3 gap-2">
              <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="또는 이름 직접 입력" className={input} />
              <input type="date" value={manualBirth} onChange={(e) => setManualBirth(e.target.value)} className={input} />
              <div className="flex gap-1.5">
                {(['남', '여'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setManualGender((prev) => (prev === g ? '' : g))}
                    className={[
                      'flex-1 rounded-xl px-2 py-2 text-sm font-bold transition',
                      manualGender === g ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-slate-950 text-slate-400 ring-1 ring-slate-800'
                    ].join(' ')}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* 계약자 ≠ 피보험자 (자녀·배우자 보험) */}
        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5">
          <label className="flex cursor-pointer items-center justify-between">
            <span className="text-[12px] font-semibold text-slate-200">
              계약자가 따로 있어요 <span className="text-[10px] font-normal text-slate-500">(자녀·배우자 보험 등 — 위 고객은 피보험자)</span>
            </span>
            <input
              type="checkbox"
              checked={diffPolicyholder}
              onChange={(e) => setDiffPolicyholder(e.target.checked)}
              className="h-4 w-4 accent-[#c6982f]"
            />
          </label>
          {diffPolicyholder ? (
            <input
              value={policyholderName}
              onChange={(e) => setPolicyholderName(e.target.value)}
              placeholder="계약자 이름 (예: 어머님 성함)"
              className={`${input} mt-2`}
            />
          ) : null}
        </div>

        {/* 운전 여부 */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {DRIVING_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDriving(d)}
              className={[
                'rounded-full px-3 py-1.5 text-[12px] font-bold transition',
                driving === d ? 'bg-[#c6982f] text-[#201603]' : 'bg-slate-950 text-slate-400 ring-1 ring-slate-800'
              ].join(' ')}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* 2) 요청 대상 — 보험사(복수=비교견적) + 매니저 (연락처부 연동) */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4">
        <div className="flex items-center gap-1.5">
          <Building2 className="h-4 w-4 text-[#c6982f]" />
          <h2 className="text-sm font-bold text-slate-100">2. 요청 대상 — 보험사 · 매니저</h2>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-500">여러 회사를 고르면 문자에 비교견적 요청이 붙습니다. 안 골라도 됩니다.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {INSURERS.map((ins) => (
            <button
              key={ins}
              type="button"
              onClick={() => setInsurers((prev) => (prev.includes(ins) ? prev.filter((x) => x !== ins) : [...prev, ins]))}
              className={[
                'rounded-full px-3 py-1.5 text-[12px] font-bold transition',
                insurers.includes(ins) ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-slate-950 text-slate-400 ring-1 ring-slate-800'
              ].join(' ')}
            >
              {ins}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) setManagerName(e.target.value)
            }}
            className={input}
            aria-label="매니저 연락처부에서 선택"
          >
            <option value="">매니저 연락처부에서 선택…</option>
            {managerOptions.map((c) => (
              <option key={c.id} value={`${c.insurer} ${c.managerName}`}>
                {c.insurer} · {c.managerName} {c.title}
              </option>
            ))}
          </select>
          <input value={managerName} onChange={(e) => setManagerName(e.target.value)} placeholder="매니저 직접 입력 (선택)" className={input} />
        </div>
      </div>

      {/* 3) 보험 구분 + 특약 + 자주 쓰는 세트 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-100">3. 요청 보험 · 특약</h2>
          <button
            type="button"
            onClick={() => setTplOpen((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-bold text-[#8a6a1e] underline-offset-2 hover:underline"
          >
            <Bookmark className="h-3.5 w-3.5" /> 자주 쓰는 세트{templates.length > 0 ? ` ${templates.length}` : ''}
          </button>
        </div>
        {tplOpen ? (
          <div className="mt-2 rounded-xl border border-[#c6982f]/30 bg-[#c6982f]/5 p-3">
            {templates.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {templates.map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1 rounded-full border border-[#c6982f]/40 bg-white px-2 py-1 text-[11px] font-semibold text-[#8a6a1e]"
                  >
                    <button type="button" onClick={() => applyTemplate(t)} className="underline-offset-2 hover:underline" title={`${t.insuranceKind} · 특약 ${t.coverages.length}개 불러오기`}>
                      {t.name}
                    </button>
                    <button type="button" onClick={() => void removeTemplate(t)} className="text-slate-500 hover:text-rose-600" aria-label={`${t.name} 세트 삭제`}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">자주 쓰는 구성(보험 구분·특약·조건)을 세트로 저장해 두면 다음부터 한 번에 불러옵니다.</p>
            )}
            <div className="mt-2 flex gap-1.5">
              <input
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveTemplate()
                }}
                placeholder="현재 구성을 세트로 저장 — 이름 (예: 40대 남성 표준)"
                className={input}
              />
              <button
                type="button"
                onClick={() => void saveTemplate()}
                disabled={tplSaving || !tplName.trim()}
                className="shrink-0 rounded-xl bg-[#0e1e3a] px-3 text-[#e6c877] disabled:opacity-40"
                aria-label="세트 저장"
              >
                <BookmarkPlus className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {INSURANCE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={[
                'rounded-full px-3 py-1.5 text-[12px] font-bold transition',
                kind === k ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-slate-950 text-slate-400 ring-1 ring-slate-800'
              ].join(' ')}
            >
              {k}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-2.5">
          {COVERAGE_GROUPS.map((group) => {
            const pickedCount = coverages.filter((c) => c.category === group.category).length
            return (
              <div key={group.category}>
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="text-[11px] font-black tracking-wide text-[#8a6a1e]">{group.category}</span>
                  {pickedCount > 0 ? (
                    <span className="rounded-full bg-[#c6982f] px-1.5 py-0.5 text-[9px] font-bold text-[#201603]">{pickedCount}</span>
                  ) : null}
                </div>
                <div className="space-y-1">
                  {group.items.map((covName) => {
                    const picked = coverages.find((c) => c.name === covName && c.category === group.category)
                    const { presets } = amountPresetsFor(group.category)
                    return (
                      <div
                        key={covName}
                        className={['rounded-xl border px-3 py-2', picked ? 'border-[#c6982f]/50 bg-[#c6982f]/5' : 'border-slate-800 bg-white'].join(' ')}
                      >
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!!picked}
                            onChange={() => toggleCoverage(group.category, covName)}
                            className="h-4 w-4 accent-[#c6982f]"
                          />
                          <span className={['text-sm font-semibold', picked ? 'text-slate-100' : 'text-slate-400'].join(' ')}>{covName}</span>
                          {picked ? <span className="ml-auto text-[12px] font-bold text-[#8a6a1e]">{picked.amount}</span> : null}
                        </label>
                        {picked ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {presets.map((a) => (
                              <button
                                key={a}
                                type="button"
                                onClick={() => setAmount(group.category, covName, a)}
                                className={[
                                  'rounded-full px-2 py-1 text-[11px] font-bold transition',
                                  picked.amount === a ? 'bg-[#c6982f] text-[#201603]' : 'bg-slate-950 text-slate-400 ring-1 ring-slate-800'
                                ].join(' ')}
                              >
                                {a}
                              </button>
                            ))}
                            <input
                              value={picked.amount}
                              onChange={(e) => setAmount(group.category, covName, e.target.value)}
                              className="w-24 rounded-full border border-slate-800 bg-white px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-[#c6982f]"
                              aria-label={`${covName} 금액 직접 입력`}
                            />
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {/* 프리셋 밖 특약 직접 추가 */}
          <div className="flex gap-1.5">
            <input
              value={customCov}
              onChange={(e) => setCustomCov(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) addCustom()
              }}
              placeholder="특약 직접 추가 (예: 치아 보철치료비)"
              className={input}
            />
            <button type="button" onClick={addCustom} className="rounded-xl bg-slate-950 px-3 text-slate-300 ring-1 ring-slate-800 hover:text-[#8a6a1e]" aria-label="특약 추가">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3">
          <span className="mb-1 block text-[11px] font-bold text-slate-500">기타 요청사항</span>
          <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="기본: 최저 보험료 및 가성비 좋은 플랜으로 설계 부탁드립니다." className={input} />
        </div>
      </div>

      {/* 4) 설계 조건 + 병력 고지 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-100">4. 설계 조건 · 병력 고지</h2>
        <p className="mt-0.5 text-[11px] text-slate-500">고른 것만 문자에 실립니다. 같은 칩을 다시 누르면 해제됩니다.</p>

        <div className="mt-2">
          <span className="mb-1 block text-[11px] font-bold text-slate-500">월 보험료 예산</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {BUDGET_PRESETS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBudget((prev) => (prev === b ? '' : b))}
                className={[
                  'rounded-full px-3 py-1.5 text-[12px] font-bold transition',
                  budget === b ? 'bg-[#c6982f] text-[#201603]' : 'bg-slate-950 text-slate-400 ring-1 ring-slate-800'
                ].join(' ')}
              >
                {b}
              </button>
            ))}
            <input
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="직접 입력 (예: 월 12만원 내)"
              className="w-44 rounded-full border border-slate-800 bg-white px-3 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <span className="mb-1 block text-[11px] font-bold text-slate-500">납입기간</span>
            <div className="flex flex-wrap gap-1.5">
              {PAYMENT_TERM_OPTIONS.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setPaymentTerm((prev) => (prev === o ? '' : o))}
                  className={[
                    'rounded-full px-2.5 py-1 text-[11px] font-bold transition',
                    paymentTerm === o ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-slate-950 text-slate-400 ring-1 ring-slate-800'
                  ].join(' ')}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-bold text-slate-500">만기</span>
            <div className="flex flex-wrap gap-1.5">
              {MATURITY_OPTIONS.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setMaturity((prev) => (prev === o ? '' : o))}
                  className={[
                    'rounded-full px-2.5 py-1 text-[11px] font-bold transition',
                    maturity === o ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-slate-950 text-slate-400 ring-1 ring-slate-800'
                  ].join(' ')}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-bold text-slate-500">갱신형태</span>
            <div className="flex flex-wrap gap-1.5">
              {RENEWAL_OPTIONS.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setRenewal((prev) => (prev === o ? '' : o))}
                  className={[
                    'rounded-full px-2.5 py-1 text-[11px] font-bold transition',
                    renewal === o ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-slate-950 text-slate-400 ring-1 ring-slate-800'
                  ].join(' ')}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 병력 고지 — 간편심사 요청의 필수 정보 */}
        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5">
          <label className="flex cursor-pointer items-center justify-between">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-200">
              <HeartPulse className="h-3.5 w-3.5 text-[#c6982f]" /> 병력 고지 포함
              <span className="text-[10px] font-normal text-slate-500">(간편심사 선택 시 자동 포함 — 매니저가 되묻지 않게)</span>
            </span>
            <input
              type="checkbox"
              checked={includeMedical}
              onChange={(e) => {
                const on = e.target.checked
                setIncludeMedical(on)
                if (on && !medicalNotes && customer?.medicalHistory) setMedicalNotes(customer.medicalHistory)
              }}
              className="h-4 w-4 accent-[#c6982f]"
            />
          </label>
          {includeMedical ? (
            <textarea
              value={medicalNotes}
              onChange={(e) => setMedicalNotes(e.target.value)}
              rows={2}
              placeholder="병명·시기·치료 상태 (고객 DB 병력이 자동 입력됩니다 — 수정 가능)"
              className={`${input} mt-2`}
            />
          ) : null}
        </div>
      </div>

      {/* 5) 실시간 미리보기 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-100">5. 문자 미리보기</h2>
          {editedMessage !== null ? (
            <span className="flex items-center gap-1.5">
              <span className="rounded-full bg-[#c6982f]/15 px-2 py-0.5 text-[10px] font-bold text-[#8a6a1e]">직접 수정됨</span>
              <button
                type="button"
                onClick={() => setEditedMessage(null)}
                className="text-[11px] font-bold text-slate-500 underline-offset-2 hover:text-[#8a6a1e] hover:underline"
              >
                자동 문안으로 되돌리기
              </button>
            </span>
          ) : (
            <span className="text-[11px] text-slate-500">체크하는 대로 실시간 반영 · 눌러서 직접 수정 가능</span>
          )}
        </div>
        <textarea
          value={finalMessage}
          onChange={(e) => setEditedMessage(e.target.value)}
          rows={14}
          spellCheck={false}
          aria-label="설계요청 문자 직접 수정"
          className="mt-2 w-full resize-y rounded-xl p-4 font-mono text-[12.5px] leading-6 text-[#e6c877] outline-none focus:ring-1 focus:ring-[#c6982f]/60"
          style={{ background: 'linear-gradient(150deg, #0b1830, #10233f)' }}
        />
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => void copyAndSave()}
            className={[
              'flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold transition',
              flash === 'copied' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-[#c6982f] text-[#201603] hover:brightness-105'
            ].join(' ')}
          >
            {flash === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} 텍스트 복사
          </button>
          <button
            type="button"
            onClick={() => void shareKakao()}
            className={[
              'flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold transition',
              flash === 'shared' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-[#FEE500] text-[#191919] hover:brightness-95'
            ].join(' ')}
          >
            {flash === 'shared' ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />} 카톡 공유
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !name.trim()}
            className={[
              'flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold transition disabled:opacity-40',
              flash === 'saved' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-[#0e1e3a] text-[#e6c877] hover:brightness-125'
            ].join(' ')}
          >
            {flash === 'saved' ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />} 이력 저장
          </button>
        </div>
        <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-500">
          <Phone className="h-3 w-3" /> 복사 후 보낼 매니저는{' '}
          <button type="button" onClick={() => navigate({ name: 'contacts' })} className="font-bold text-[#8a6a1e] underline-offset-2 hover:underline">
            매니저 연락처
          </button>
          에서 바로 찾을 수 있습니다. 복사·공유하면 이력도 자동 저장됩니다.
        </p>
      </div>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center text-sm text-rose-600">{error}</div> : null}

      {/* 관리자: 직원 것 포함 */}
      {admin ? (
        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-800 bg-white px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Users className="h-4 w-4 text-[#c6982f]" /> 직원 요청 포함
            <span className="text-[11px] font-normal text-slate-500">(기본은 내 것만)</span>
          </span>
          <input type="checkbox" checked={includeStaff} onChange={(e) => setIncludeStaff(e.target.checked)} className="h-4 w-4 accent-[#c6982f]" />
        </label>
      ) : null}

      {/* 요청 이력 */}
      {visible.length > 0 ? (
        <ul className="space-y-2">
          {visible.map((r) => {
            const next = nextPlanStatus(r.status)
            const others = r.fcId !== session.id
            return (
              <li key={r.id} className="rounded-2xl border border-slate-800 bg-white p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold text-slate-100">{r.customerName}</span>
                      <span className="text-[11px] text-slate-500">{r.insuranceKind}</span>
                      {r.insurers.length > 0 ? (
                        <span className="rounded-full bg-slate-950 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 ring-1 ring-slate-800">
                          {r.insurers.join(' · ')}
                        </span>
                      ) : null}
                      {r.managerName ? <span className="text-[10px] text-slate-500">매니저 {r.managerName}</span> : null}
                      <span className={['rounded-full px-1.5 py-0.5 text-[10px] font-bold', STATUS_CHIP[r.status]].join(' ')}>
                        {PLAN_STATUS_LABEL[r.status]}
                      </span>
                      {others ? (
                        <span className="rounded-full border border-[#c6982f]/40 bg-[#c6982f]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#8a6a1e]">
                          담당 {r.fcName || '직원'}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {new Date(Date.parse(r.createdAt)).toLocaleString('ko-KR')} · 특약 {r.coverages.length}개
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyText(r.messageText)}
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-950 hover:text-[#8a6a1e]"
                    aria-label="문안 다시 복사"
                    title="문안 다시 복사"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(r)}
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
                    aria-label="삭제"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {next || (r.status !== 'contracted' && r.status !== 'dropped') ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {next ? (
                      <button
                        type="button"
                        onClick={() => void advance(r)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-xl bg-[#0e1e3a] px-3 py-1.5 text-xs font-bold text-[#e6c877] transition hover:brightness-125 disabled:opacity-40"
                      >
                        {PLAN_STATUS_LABEL[next]} 처리 <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    {r.status !== 'contracted' && r.status !== 'dropped' ? (
                      <button
                        type="button"
                        onClick={() => void drop(r)}
                        disabled={busy}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600 transition hover:bg-[#ffe4e6] disabled:opacity-40"
                      >
                        중단
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-dashed border-slate-700 bg-white/60 px-4 py-3 text-[12px] text-slate-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            아직 저장된 요청이 없습니다. 문자를 <b className="text-slate-300">복사·공유하면 이력이 자동 저장</b>되어 고객별로 요청 →
            설계받음 → 제안 → 계약 진행을 추적할 수 있습니다.
          </span>
        </div>
      )}
    </div>
  )
}
