import { useEffect, useMemo, useState } from 'react'
import {
  ShieldQuestion,
  Loader2,
  AlertTriangle,
  Copy,
  Check,
  Sparkles,
  Search,
  User,
  X,
  RotateCcw,
  History,
  ChevronDown,
  ChevronUp,
  HeartPulse,
  Scale,
  BadgeCheck,
  BookOpenCheck,
  Lightbulb,
  ListChecks,
  Pencil
} from 'lucide-react'
import {
  assessUnderwriting,
  collectKnownRules,
  listUnderwritingAi,
  saveUnderwritingAi,
  type DisclosureAnswer,
  type SavedUnderwritingAi,
  type UnderwritingAiInput,
  type UnderwritingAiResult,
  type UnderwritingGrade
} from '@renderer/services/underwriting-ai/underwritingAiService'
import { takeUnderwritingPrefill } from '@renderer/services/underwriting-ai/underwritingPrefill'
import { listCustomers } from '@renderer/services/commercial/customerService'
import { bmiOf, parseRrn } from '@renderer/services/commercial/customerValidation'
import { getHubCustomer, setHubCustomer, subscribeHubCustomer } from '@renderer/services/insurance-hub/insuranceHubStore'
import InsuranceHubBar from '@renderer/components/insurance-hub/InsuranceHubBar'
import { copyText } from '@renderer/services/share/clipboard'
import type { CustomerRecord } from '@shared/commercial/models'

/**
 * AI 사전심사 (언더라이팅) — 청약 전에 "이 고객, 가입 되나?"를 미리 예측.
 *
 * 1) 고객 선택(병력·키/몸무게·나이 자동 프리필) 또는 즉석 입력
 * 2) 표준 계약전 알릴의무(3개월/1년/5년/중대질병) 문답 + 흡연·음주·직업
 * 3) AI가 상품군별 예상 인수 결과(가능/조건부/어려움) + 부담보·할증 조건 +
 *    유병자·간편심사 대안 + 정확 고지 가이드 + 고객 안내문을 생성
 * '예외질병 인수 가이드' 분류표와 매칭되는 사내 기준은 최우선 근거로 자동 반영.
 * 결과는 예상이며 최종 인수는 보험사 심사에 따름 — 화면에 상시 고지한다.
 * 병력 등 민감정보는 로깅하지 않는다.
 */

type Phase = 'input' | 'analyzing' | 'result'

const GRADE_META: Record<UnderwritingGrade, { label: string; chip: string }> = {
  standard: { label: '표준체 가능 예상', chip: 'border-emerald-300/40 bg-emerald-400/15 text-emerald-300' },
  likely: { label: '대체로 가능 예상', chip: 'border-sky-300/40 bg-sky-400/15 text-sky-300' },
  conditional: { label: '조건부 가능성 (부담보·할증)', chip: 'border-amber-300/40 bg-amber-400/15 text-amber-300' },
  difficult: { label: '거절 가능성 — 대안 검토', chip: 'border-rose-300/40 bg-rose-400/15 text-rose-300' },
  'info-needed': { label: '정보 부족 — 추가 확인 필요', chip: 'border-white/25 bg-white/10 text-white/80' }
}

const VERDICT_CHIP: Record<string, string> = {
  가능: 'bg-emerald-100 text-emerald-700',
  조건부: 'bg-amber-100 text-amber-700',
  어려움: 'bg-rose-100 text-rose-700',
  정보필요: 'border border-slate-800 bg-white text-slate-500'
}

const IMPACT_DOT: Record<string, string> = {
  high: 'bg-rose-500',
  medium: 'bg-amber-500',
  low: 'bg-emerald-500'
}

const TARGET_AREAS = ['암보험', '뇌·심혈관', '건강(질병)', '실손의료비', '종신·정기', '운전자·상해', '치아', '어린이'] as const
const SMOKING_OPTIONS = ['비흡연', '흡연 중', '금연 1년 이상'] as const
const DRINKING_OPTIONS = ['안 마심', '가끔(주1~2회)', '자주(주3회 이상)'] as const

const DISCLOSURE_QUESTIONS: { key: 'm3' | 'y1' | 'y5' | 'major'; no: string; text: string; hint: string }[] = [
  {
    key: 'm3',
    no: '①',
    text: '최근 3개월 이내 — 의사 진찰·검사 후 소견(입원·수술·재검사 필요 등)을 받았거나, 약을 처방받아 복용 중입니까?',
    hint: '예: 고혈압약 복용 중, 위내시경 재검 소견'
  },
  {
    key: 'y1',
    no: '②',
    text: '최근 1년 이내 — 의사의 검사 결과 추가검사(재검사)를 받은 적이 있습니까?',
    hint: '예: 건강검진 갑상선 결절 추적검사'
  },
  {
    key: 'y5',
    no: '③',
    text: '최근 5년 이내 — 입원, 수술, 7일 이상 계속 치료, 30일 이상 계속 투약을 받은 적이 있습니까?',
    hint: '예: 2023년 담낭절제 수술, 디스크 치료 2주'
  },
  {
    key: 'major',
    no: '④',
    text: '최근 5년 이내 — 중대질병(암·백혈병·고혈압·당뇨·심근경색·협심증·간경화·뇌졸중 등)으로 진단·치료를 받은 적이 있습니까?',
    hint: '예: 2022년 당뇨 진단, 현재 투약 관리 중'
  }
]

const ANALYZING_MESSAGES = [
  '고지 내용을 심사 기준과 대조하는 중…',
  '상품군별 인수 가능성을 계산하는 중…',
  '부담보·할증 조건을 검토하는 중…',
  '대안 상품과 고지 가이드를 정리하는 중…'
]

const inputCls =
  'w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[13px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]'

function chipCls(active: boolean): string {
  return [
    'rounded-full border px-3 py-1.5 text-[12px] font-semibold transition',
    active ? 'border-[#c6982f] bg-[#c6982f]/10 text-[#b0821f]' : 'border-slate-800 bg-white text-slate-400 hover:border-[#c6982f]/50'
  ].join(' ')
}

export default function PreUnderwritingPage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('input')

  // 고객 선택
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [customerQuery, setCustomerQuery] = useState('')
  const [customer, setCustomer] = useState<CustomerRecord | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  // 기본 정보
  const [age, setAge] = useState('')
  const [gender, setGender] = useState<'남' | '여' | ''>('')
  const [heightCm, setHeightCm] = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [job, setJob] = useState('')
  const [smoking, setSmoking] = useState('')
  const [drinking, setDrinking] = useState('')
  const [medicalHistory, setMedicalHistory] = useState('')
  const [extraNotes, setExtraNotes] = useState('')

  // 고지 문답
  const emptyAnswer: DisclosureAnswer = { has: false, detail: '' }
  const [m3, setM3] = useState<DisclosureAnswer>(emptyAnswer)
  const [y1, setY1] = useState<DisclosureAnswer>(emptyAnswer)
  const [y5, setY5] = useState<DisclosureAnswer>(emptyAnswer)
  const [major, setMajor] = useState<DisclosureAnswer>(emptyAnswer)
  const [targetAreas, setTargetAreas] = useState<string[]>([])

  // 결과
  const [result, setResult] = useState<UnderwritingAiResult | null>(null)
  const [usedRules, setUsedRules] = useState(0)
  const [error, setError] = useState('')
  const [disabled, setDisabled] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [copied, setCopied] = useState(false)
  const [analyzingMsg, setAnalyzingMsg] = useState(0)

  // 이력
  const [past, setPast] = useState<SavedUnderwritingAi[]>([])
  const [pastOpen, setPastOpen] = useState(false)

  const bmi = bmiOf(Number(heightCm) || undefined, Number(weightKg) || undefined)

  const applyCustomer = (c: CustomerRecord): void => {
    setCustomer(c)
    setPickerOpen(false)
    setCustomerQuery('')
    const rrn = parseRrn(c.rrn)
    if (rrn) {
      setAge(String(rrn.age))
      setGender(rrn.gender)
    }
    if (c.heightCm) setHeightCm(String(c.heightCm))
    if (c.weightKg) setWeightKg(String(c.weightKg))
    if (c.medicalHistory) setMedicalHistory(c.medicalHistory)
  }

  useEffect(() => {
    void listCustomers().then((res) => {
      if (res.ok) setCustomers(res.customers)
    })
    // 보험 허브와 양방향 동기화 — 다른 도구(보장분석·청구비서 등)에서 고른 고객이 이어진다
    const unsub = subscribeHubCustomer((c) => {
      if (c) applyCustomer(c)
      else setCustomer(null)
    })
    const pre = takeUnderwritingPrefill()
    if (pre) setHubCustomer(pre)
    else {
      const hub = getHubCustomer()
      if (hub) applyCustomer(hub)
    }
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!customer) {
      setPast([])
      return
    }
    void listUnderwritingAi(customer.id).then((res) => {
      if (res.ok) setPast(res.items)
    })
  }, [customer?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'analyzing') return
    setAnalyzingMsg(0)
    const t = window.setInterval(() => setAnalyzingMsg((i) => (i + 1) % ANALYZING_MESSAGES.length), 6000)
    return () => window.clearInterval(t)
  }, [phase])

  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim()
    if (!q) return customers.slice(0, 8)
    return customers.filter((c) => c.name.includes(q) || (c.phone ?? '').includes(q)).slice(0, 8)
  }, [customers, customerQuery])

  const buildInput = (): UnderwritingAiInput => ({
    profile: {
      age: Number(age),
      gender,
      heightCm: Number(heightCm) || undefined,
      weightKg: Number(weightKg) || undefined,
      bmi,
      job: job.trim(),
      smoking,
      drinking
    },
    disclosures: { m3, y1, y5, major },
    medicalHistory: medicalHistory.trim(),
    targetAreas,
    extraNotes: extraNotes.trim()
  })

  const run = async (): Promise<void> => {
    setError('')
    const ageNum = Number(age)
    if (!ageNum || ageNum < 1 || ageNum > 110) {
      setError('고객 나이를 입력해 주세요 (만 나이).')
      return
    }
    if (!gender) {
      setError('성별을 선택해 주세요.')
      return
    }
    if (targetAreas.length === 0) {
      setError('심사할 상품군을 1개 이상 선택해 주세요.')
      return
    }
    const answered = [m3, y1, y5, major]
    if (answered.some((a) => a.has && !a.detail.trim())) {
      setError('"예"라고 답한 고지 항목의 세부 내용(병명·시기·치료)을 입력해 주세요 — 정확할수록 심사 예측이 정확해집니다.')
      return
    }

    setPhase('analyzing')
    setSaveState('idle')
    setResult(null)
    const input = buildInput()
    // 사내 인수기준 분류표 매칭 — 병력·고지 텍스트 전체에서 질병명 탐색
    const freeText = [input.medicalHistory, m3.detail, y1.detail, y5.detail, major.detail, input.extraNotes].join('\n')
    const rules = await collectKnownRules(freeText)
    setUsedRules(rules.length)

    const res = await assessUnderwriting(input, rules)
    if (!res.ok || !res.result) {
      setError(res.error ?? '심사 분석에 실패했습니다.')
      setDisabled(Boolean(res.disabled))
      setPhase('input')
      return
    }
    setResult(res.result)
    setPhase('result')

    if (customer) {
      setSaveState('saving')
      const saved = await saveUnderwritingAi(customer.id, input, res.result)
      setSaveState(saved.ok ? 'saved' : 'failed')
      if (saved.ok) {
        const list = await listUnderwritingAi(customer.id)
        if (list.ok) setPast(list.items)
      }
    }
  }

  const copyMessage = async (): Promise<void> => {
    if (!result?.customerMessage) return
    // 인앱 브라우저(카톡 등)에서 표준 API가 막히면 execCommand 폴백까지 시도한다.
    const ok = await copyText(result.customerMessage)
    if (!ok) return // 실패하면 '복사됨' 표시하지 않는다 (직접 드래그 복사)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const openPast = (item: SavedUnderwritingAi): void => {
    setResult(item.result)
    setSaveState('idle')
    setUsedRules(0)
    setPhase('result')
  }

  const stepNow = phase === 'input' ? 1 : phase === 'analyzing' ? 2 : 3

  const disclosureSetters: Record<string, (a: DisclosureAnswer) => void> = { m3: setM3, y1: setY1, y5: setY5, major: setMajor }
  const disclosureValues: Record<string, DisclosureAnswer> = { m3, y1, y5, major }

  return (
    <div className="space-y-5">
      <InsuranceHubBar current="pre-underwriting" />
      {/* ── 히어로 (딥네이비 + 골드) ─────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0e1e3a] shadow-sm">
        <div className="relative px-5 py-6 sm:px-7">
          <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-[#c6982f]/15 blur-2xl" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e6c877]/40 bg-[#c6982f]/15 px-2.5 py-1 text-[11px] font-bold tracking-wide text-[#e6c877]">
              <ShieldQuestion className="h-3 w-3" /> AI 언더라이터 · Claude
            </span>
            {result && phase === 'result' ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                <BadgeCheck className="h-3 w-3" /> 심사 예측 완료
              </span>
            ) : null}
          </div>
          <h1 className="mt-3 text-xl font-extrabold text-white sm:text-2xl">AI 사전심사</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-6" style={{ color: 'rgba(203,213,225,0.92)' }}>
            청약 전에 <b className="text-[#e6c877]">"이 고객, 가입 되나?"</b>를 미리 확인하세요. 고지사항 문답만 하면 AI가{' '}
            <b className="text-[#e6c877]">상품군별 예상 인수 결과와 부담보·할증 조건, 대안 상품</b>까지 정리합니다.
            결과는 예상이며, 최종 인수는 보험사 심사로 결정됩니다.
          </p>
          <div className="mt-4 flex items-center gap-2">
            {[
              { n: 1, label: '고객 정보 · 고지 문답' },
              { n: 2, label: 'AI 심사 분석' },
              { n: 3, label: '결과 · 대안' }
            ].map((s, i) => (
              <div key={s.n} className="flex items-center gap-2">
                {i > 0 ? <div className="h-px w-4 bg-white/20 sm:w-8" /> : null}
                <div
                  className={[
                    'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold',
                    stepNow >= s.n ? 'bg-[#c6982f] text-[#0e1e3a]' : 'border border-white/20 text-white/50'
                  ].join(' ')}
                >
                  <span>{s.n}</span>
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 1단계: 입력 ──────────────────────────────────────────── */}
      {phase === 'input' ? (
        <>
          {disabled ? (
            <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[13px] leading-6 text-sky-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                AI 사전심사 서버(underwriting-expert)가 아직 준비되지 않았습니다. 관리자(대표님)가 엣지 함수 배포와
                ANTHROPIC_API_KEY 설정을 완료하면 즉시 사용할 수 있습니다.
              </span>
            </div>
          ) : null}
          {error ? (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] leading-6 text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {/* 고객 선택 */}
          <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <User className="h-4 w-4 text-[#b0821f]" />
              <h2 className="text-sm font-bold text-slate-100">고객 선택 — 병력·나이 자동 입력</h2>
              <span className="text-[11px] text-slate-500">(선택 시 결과가 고객 기록에 자동 저장)</span>
            </div>
            {customer ? (
              <div className="flex items-center justify-between rounded-xl border border-[#c6982f]/40 bg-[#c6982f]/5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0e1e3a] text-[12px] font-bold text-[#e6c877]">
                    {customer.name.slice(0, 1)}
                  </span>
                  <div>
                    <div className="text-[13px] font-bold text-slate-100">{customer.name}</div>
                    <div className="text-[11px] text-slate-500">{customer.phone ?? ''}</div>
                  </div>
                </div>
                <button type="button" onClick={() => setHubCustomer(null)} className="rounded p-1 text-slate-400 hover:text-rose-600" aria-label="고객 해제">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
                  <Search className="h-4 w-4 text-slate-500" />
                  <input
                    value={customerQuery}
                    onChange={(e) => {
                      setCustomerQuery(e.target.value)
                      setPickerOpen(true)
                    }}
                    onFocus={() => setPickerOpen(true)}
                    placeholder="고객 이름/전화로 검색 (미등록 고객은 아래에 직접 입력)"
                    className="w-full bg-transparent text-[13px] text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </div>
                {pickerOpen && filteredCustomers.length > 0 ? (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-slate-800 bg-white shadow-lg">
                    {filteredCustomers.map((c) => (
                      <button key={c.id} type="button" onClick={() => setHubCustomer(c)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-950">
                        <User className="h-3.5 w-3.5 text-slate-400" />
                        <span className="text-[13px] font-medium text-slate-200">{c.name}</span>
                        <span className="text-[11px] text-slate-500">{c.phone ?? ''}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {/* 지난 심사 이력 */}
            {customer && past.length > 0 ? (
              <div className="mt-3">
                <button type="button" onClick={() => setPastOpen((v) => !v)} className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-400 hover:text-[#b0821f]">
                  <History className="h-3.5 w-3.5" /> 지난 심사 이력 {past.length}건
                  {pastOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                {pastOpen ? (
                  <div className="mt-2 space-y-1.5">
                    {past.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => openPast(p)}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left hover:border-[#c6982f]/50"
                      >
                        <span className="text-[12px] text-slate-300">{new Date(p.createdAt).toLocaleString('ko-KR')}</span>
                        <span className={['rounded-full px-2 py-0.5 text-[11px] font-bold', VERDICT_CHIP[p.result.byArea[0]?.verdict ?? '정보필요']].join(' ')}>
                          {GRADE_META[p.result.overallGrade]?.label ?? '결과'}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* 기본 정보 */}
          <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <Scale className="h-4 w-4 text-[#b0821f]" />
              <h2 className="text-sm font-bold text-slate-100">기본 정보</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <div className="mb-1 text-[11px] font-semibold text-slate-500">나이 (만) *</div>
                <input value={age} onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, ''))} placeholder="예: 45" className={inputCls} inputMode="numeric" />
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold text-slate-500">성별 *</div>
                <div className="flex gap-1.5">
                  {(['남', '여'] as const).map((g) => (
                    <button key={g} type="button" onClick={() => setGender(g)} className={chipCls(gender === g)}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold text-slate-500">키 (cm)</div>
                <input value={heightCm} onChange={(e) => setHeightCm(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="170" className={inputCls} inputMode="decimal" />
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold text-slate-500">
                  몸무게 (kg) {bmi ? <span className="ml-1 rounded bg-[#c6982f]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#b0821f]">BMI {bmi}</span> : null}
                </div>
                <input value={weightKg} onChange={(e) => setWeightKg(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="70" className={inputCls} inputMode="decimal" />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <div className="mb-1 text-[11px] font-semibold text-slate-500">직업 (구체적으로)</div>
                <input value={job} onChange={(e) => setJob(e.target.value)} placeholder="예: 사무직, 배달 라이더, 용접공" className={inputCls} />
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold text-slate-500">흡연</div>
                <div className="flex flex-wrap gap-1.5">
                  {SMOKING_OPTIONS.map((o) => (
                    <button key={o} type="button" onClick={() => setSmoking(smoking === o ? '' : o)} className={chipCls(smoking === o)}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold text-slate-500">음주</div>
                <div className="flex flex-wrap gap-1.5">
                  {DRINKING_OPTIONS.map((o) => (
                    <button key={o} type="button" onClick={() => setDrinking(drinking === o ? '' : o)} className={chipCls(drinking === o)}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <HeartPulse className="h-3.5 w-3.5" /> 병력 메모 (고객 DB에서 자동 입력 — 수정 가능)
              </div>
              <textarea
                value={medicalHistory}
                onChange={(e) => setMedicalHistory(e.target.value)}
                placeholder="예: 2023년 갑상선 결절 추적관찰, 고혈압약 복용 중"
                rows={2}
                className={inputCls}
              />
            </div>
          </div>

          {/* 고지 문답 */}
          <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-1 flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-[#b0821f]" />
              <h2 className="text-sm font-bold text-slate-100">계약전 알릴의무 (고지) 문답</h2>
            </div>
            <p className="mb-3 text-[11px] leading-5 text-slate-500">청약서 고지사항과 같은 구조입니다. 정확하게 답할수록 심사 예측이 정확해집니다.</p>
            <div className="space-y-3">
              {DISCLOSURE_QUESTIONS.map((q) => {
                const v = disclosureValues[q.key]
                const set = disclosureSetters[q.key]
                return (
                  <div key={q.key} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="text-[13px] leading-5 text-slate-200">
                        <b className="mr-1 text-[#b0821f]">{q.no}</b>
                        {q.text}
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button type="button" onClick={() => set({ ...v, has: false })} className={chipCls(!v.has)}>
                          아니오
                        </button>
                        <button type="button" onClick={() => set({ ...v, has: true })} className={chipCls(v.has)}>
                          예
                        </button>
                      </div>
                    </div>
                    {v.has ? (
                      <textarea
                        value={v.detail}
                        onChange={(e) => set({ ...v, detail: e.target.value })}
                        placeholder={`세부 내용 — 병명·시기·치료·현재 상태 (${q.hint})`}
                        rows={2}
                        className={`${inputCls} mt-2 bg-white`}
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>

          {/* 상품군 + 실행 */}
          <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#b0821f]" />
              <h2 className="text-sm font-bold text-slate-100">심사할 상품군 * (복수 선택)</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {TARGET_AREAS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setTargetAreas((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]))}
                  className={chipCls(targetAreas.includes(a))}
                >
                  {a}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold text-slate-500">추가 메모 (선택)</div>
              <input value={extraNotes} onChange={(e) => setExtraNotes(e.target.value)} placeholder="예: 삼성화재 위주로 검토, 월 보험료 10만원 예산" className={inputCls} />
            </div>
            <button
              type="button"
              onClick={() => void run()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] px-4 py-3 text-sm font-bold text-[#e6c877] shadow-md transition hover:brightness-125"
            >
              <ShieldQuestion className="h-4 w-4" /> AI 사전심사 시작
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-500">분석에 30초~1분 정도 걸립니다. 병력·고지 내용은 저장 전까지 서버에 남지 않습니다.</p>
          </div>
        </>
      ) : null}

      {/* ── 2단계: 분석 중 ───────────────────────────────────────── */}
      {phase === 'analyzing' ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-800 bg-white px-4 py-14 shadow-sm">
          <Loader2 className="h-8 w-8 animate-spin text-[#b0821f]" />
          <div className="text-sm font-bold text-slate-100">{ANALYZING_MESSAGES[analyzingMsg]}</div>
          <div className="text-[12px] text-slate-500">AI 언더라이터가 국내 인수 관행 기준으로 정밀 검토 중입니다 (30초~1분)</div>
        </div>
      ) : null}

      {/* ── 3단계: 결과 ──────────────────────────────────────────── */}
      {phase === 'result' && result ? (
        <>
          {/* 종합 결과 (딥네이비 카드) */}
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0e1e3a] shadow-sm">
            <div className="relative px-5 py-6 sm:px-7">
              <div className="pointer-events-none absolute -left-10 -bottom-16 h-44 w-44 rounded-full bg-[#c6982f]/15 blur-2xl" />
              <div className="flex flex-wrap items-center gap-2">
                <span className={['inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-bold', GRADE_META[result.overallGrade].chip].join(' ')}>
                  <BadgeCheck className="h-3.5 w-3.5" /> {GRADE_META[result.overallGrade].label}
                </span>
                {usedRules > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#e6c877]/40 bg-[#c6982f]/15 px-2.5 py-1 text-[11px] font-semibold text-[#e6c877]">
                    <BookOpenCheck className="h-3 w-3" /> 사내 인수기준 {usedRules}건 반영
                  </span>
                ) : null}
                {customer ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/80">
                    {saveState === 'saving' ? '저장 중…' : saveState === 'saved' ? `${customer.name} 고객 기록에 저장됨` : saveState === 'failed' ? '저장 실패' : customer.name}
                  </span>
                ) : null}
              </div>
              <h2 className="mt-3 text-lg font-extrabold text-white sm:text-xl">{result.headline || 'AI 사전심사 결과'}</h2>
              <p className="mt-1.5 max-w-3xl text-[13px] leading-6" style={{ color: 'rgba(203,213,225,0.92)' }}>
                {result.summary}
              </p>
            </div>
          </div>

          {/* 상품군별 예상 결과 */}
          <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="mb-3 text-sm font-bold text-slate-100">상품군별 예상 인수 결과</h3>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {result.byArea.map((a) => (
                <div key={a.area} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[13px] font-bold text-slate-100">{a.area}</div>
                    <span className={['rounded-full px-2.5 py-0.5 text-[11px] font-bold', VERDICT_CHIP[a.verdict]].join(' ')}>{a.verdict}</span>
                  </div>
                  {a.condition ? <div className="mt-1.5 text-[12px] font-semibold text-[#b0821f]">{a.condition}</div> : null}
                  <div className="mt-1 text-[12px] leading-5 text-slate-400">{a.reason}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 핵심 심사 포인트 + 고지 가이드 */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {result.keyFactors.length > 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
                <h3 className="mb-3 text-sm font-bold text-slate-100">핵심 심사 포인트</h3>
                <div className="space-y-2">
                  {result.keyFactors.map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className={['mt-1.5 h-2 w-2 shrink-0 rounded-full', IMPACT_DOT[f.impact]].join(' ')} />
                      <div>
                        <div className="text-[13px] font-semibold text-slate-200">{f.factor}</div>
                        <div className="text-[12px] leading-5 text-slate-500">{f.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {result.disclosureGuide.length > 0 ? (
              <div className="rounded-2xl border border-[#c6982f]/40 bg-gradient-to-r from-[#c6982f]/10 to-transparent p-4 shadow-sm sm:p-5">
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-100">
                  <Lightbulb className="h-4 w-4 text-[#b0821f]" /> 고지 가이드 — 정확하고 유리하게
                </h3>
                <ul className="space-y-1.5">
                  {result.disclosureGuide.map((g, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[13px] leading-6 text-slate-300">
                      <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-[#b0821f]" />
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {/* 대안 상품 */}
          {result.alternatives.length > 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="mb-3 text-sm font-bold text-slate-100">대안 — 이 고객에게 맞는 다른 길</h3>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {result.alternatives.map((alt, i) => (
                  <div key={i} className="rounded-xl border border-[#c6982f]/30 bg-[#c6982f]/5 p-3">
                    <div className="text-[13px] font-bold text-[#b0821f]">{alt.name}</div>
                    <div className="mt-1 text-[12px] leading-5 text-slate-300">{alt.why}</div>
                    {alt.note ? <div className="mt-1 text-[11px] text-slate-500">※ {alt.note}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* 추가 확인 + 주의 */}
          {result.neededInfo.length > 0 || result.cautions.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {result.neededInfo.length > 0 ? (
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                  <h3 className="mb-2 text-[13px] font-bold text-sky-800">추가 확인하면 정확도가 올라갑니다</h3>
                  <ul className="list-disc space-y-1 pl-4 text-[12px] leading-5 text-sky-800">
                    {result.neededInfo.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {result.cautions.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <h3 className="mb-2 text-[13px] font-bold text-amber-800">설계사 주의사항</h3>
                  <ul className="list-disc space-y-1 pl-4 text-[12px] leading-5 text-amber-800">
                    {result.cautions.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 고객 안내문 */}
          {result.customerMessage ? (
            <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-100">고객 안내문 (카톡용)</h3>
                <button
                  type="button"
                  onClick={() => void copyMessage()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e1e3a] px-3 py-1.5 text-xs font-bold text-[#e6c877] hover:brightness-125"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? '복사됨' : '복사'}
                </button>
              </div>
              <div className="whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-3 text-[13px] leading-6 text-slate-100">
                {result.customerMessage}
              </div>
            </div>
          ) : null}

          {/* 법적 고지 + 액션 */}
          <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-[11px] leading-5 text-slate-500">
            본 결과는 일반적인 인수 경향과 입력된 고지 내용에 기반한 <b>예상 참고자료</b>입니다. 실제 인수 여부·조건은 각 보험사의
            심사 기준과 시점에 따라 달라질 수 있으며, 청약 시에는 반드시 정확한 고지가 이루어져야 합니다.
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setPhase('input')}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#c6982f]/50 bg-white px-4 py-2.5 text-[13px] font-bold text-[#b0821f] hover:bg-[#c6982f]/5"
            >
              <Pencil className="h-4 w-4" /> 조건 수정 후 다시 심사
            </button>
            <button
              type="button"
              onClick={() => {
                setPhase('input')
                setResult(null)
                setHubCustomer(null)
                setAge('')
                setGender('')
                setHeightCm('')
                setWeightKg('')
                setJob('')
                setSmoking('')
                setDrinking('')
                setMedicalHistory('')
                setExtraNotes('')
                setM3(emptyAnswer)
                setY1(emptyAnswer)
                setY5(emptyAnswer)
                setMajor(emptyAnswer)
                setTargetAreas([])
              }}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-800 bg-white px-4 py-2.5 text-[13px] font-bold text-slate-300 hover:border-[#c6982f]/40"
            >
              <RotateCcw className="h-4 w-4" /> 새 고객 심사
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
