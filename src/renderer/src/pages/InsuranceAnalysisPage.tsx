import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  ShieldCheck,
  Loader2,
  AlertTriangle,
  UploadCloud,
  Image as ImageIcon,
  FileText,
  X,
  Search,
  User,
  Copy,
  Check,
  Sparkles,
  BadgeCheck,
  ShieldAlert,
  Lightbulb,
  RotateCcw,
  History,
  ChevronDown,
  ChevronUp,
  Wallet
} from 'lucide-react'
import {
  analyzeCoverage,
  saveInsuranceAnalysis,
  listInsuranceAnalyses,
  type Adequacy,
  type GapSeverity,
  type InsuranceAnalysisResult,
  type SavedInsuranceAnalysis
} from '@renderer/services/insurance-analysis-ai/insuranceAnalysisAiService'
import { listCustomers } from '@renderer/services/commercial/customerService'
import { parseRrn } from '@renderer/services/commercial/customerValidation'
import { getHubCustomer, setHubCustomer, subscribeHubCustomer } from '@renderer/services/insurance-hub/insuranceHubStore'
import InsuranceHubBar from '@renderer/components/insurance-hub/InsuranceHubBar'
import FileDropZone from '@renderer/components/ui/FileDropZone'
import { copyText } from '@renderer/services/share/clipboard'
import type { CustomerRecord } from '@shared/commercial/models'

/**
 * AI 보장분석 — 증권 업로드 → Claude가 담보를 읽어 카테고리별 보장현황·공백·
 * 적정성 + 보완 제안(영업 기회)까지. 청구비서(보험금 계산)와 별개.
 * 고객 선택 시 프로필 자동 반영 + 결과 자동 저장(RLS). 증권은 저장되지 않는다.
 */

type Phase = 'input' | 'analyzing' | 'result'

const ADEQ_META: Record<Adequacy, { label: string; chip: string; dot: string }> = {
  sufficient: { label: '충분', chip: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  partial: { label: '부분', chip: 'bg-sky-100 text-sky-700', dot: 'bg-sky-500' },
  insufficient: { label: '부족', chip: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  none: { label: '미가입', chip: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500' }
}

const SEV_META: Record<GapSeverity, { label: string; chip: string }> = {
  high: { label: '높음', chip: 'border-rose-300/50 bg-rose-50 text-rose-700' },
  medium: { label: '보통', chip: 'border-amber-300/50 bg-amber-50 text-amber-700' },
  low: { label: '낮음', chip: 'border-slate-700 bg-white text-slate-500' }
}

const ANALYZING_MESSAGES = [
  '증권을 판독하는 중…',
  '담보별 보장현황을 정리하는 중…',
  '보장 공백을 찾는 중…',
  '보완 제안을 작성하는 중…'
]

const won = (n: number): string => (n >= 10000 ? `${Math.round(n / 10000).toLocaleString('ko-KR')}만원` : `${n.toLocaleString('ko-KR')}원`)

export default function InsuranceAnalysisPage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('input')
  const [files, setFiles] = useState<File[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [customerQuery, setCustomerQuery] = useState('')
  // 보험 허브의 "현재 작업 중 고객"과 양방향 동기화 — 다른 도구에서 골라도 이어진다
  const [customer, setCustomer] = useState<CustomerRecord | null>(() => getHubCustomer())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [extraNotes, setExtraNotes] = useState('')

  const [result, setResult] = useState<InsuranceAnalysisResult | null>(null)
  const [error, setError] = useState('')
  const [disabled, setDisabled] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [copied, setCopied] = useState(false)
  const [analyzingMsg, setAnalyzingMsg] = useState(0)

  const [past, setPast] = useState<SavedInsuranceAnalysis[]>([])
  const [pastOpen, setPastOpen] = useState(false)

  useEffect(() => {
    void listCustomers().then((res) => {
      if (res.ok) setCustomers(res.customers)
    })
    return subscribeHubCustomer(setCustomer)
  }, [])

  useEffect(() => {
    if (!customer) {
      setPast([])
      return
    }
    void listInsuranceAnalyses(customer.id).then((res) => {
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

  const addFiles = (list: FileList | File[] | null): void => {
    if (!list) return
    const next = [...files, ...Array.from(list)].slice(0, 6)
    setFiles(next)
  }

  const run = async (): Promise<void> => {
    setError('')
    if (files.length === 0) {
      setError('분석할 증권을 먼저 올려주세요.')
      return
    }
    setPhase('analyzing')
    setResult(null)
    setSaveState('idle')
    const rrn = parseRrn(customer?.rrn)
    const profile = {
      age: rrn?.age,
      gender: rrn?.gender,
      job: undefined,
      medicalHistory: customer?.medicalHistory
    }
    const res = await analyzeCoverage(files, profile, extraNotes.trim())
    if (!res.ok || !res.result) {
      setError(res.error ?? '보장분석에 실패했습니다.')
      setDisabled(Boolean(res.disabled))
      setPhase('input')
      return
    }
    setResult(res.result)
    setPhase('result')
    if (customer) {
      setSaveState('saving')
      const saved = await saveInsuranceAnalysis(customer.id, res.result)
      setSaveState(saved.ok ? 'saved' : 'failed')
      if (saved.ok) {
        const list = await listInsuranceAnalyses(customer.id)
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

  const reset = (): void => {
    setPhase('input')
    setResult(null)
    setFiles([])
    setHubCustomer(null)
    setExtraNotes('')
    setSaveState('idle')
  }

  const stepNow = phase === 'input' ? 1 : phase === 'analyzing' ? 2 : 3

  return (
    <div className="space-y-5">
      <InsuranceHubBar current="insurance-analysis" />
      {/* ── 히어로 ─────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0e1e3a] shadow-sm">
        <div className="relative px-5 py-6 sm:px-7">
          <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-[#c6982f]/15 blur-2xl" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e6c877]/40 bg-[#c6982f]/15 px-2.5 py-1 text-[11px] font-bold tracking-wide text-[#e6c877]">
              <ShieldCheck className="h-3 w-3" /> AI 보장분석 · Claude
            </span>
            {result && phase === 'result' ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                <BadgeCheck className="h-3 w-3" /> 분석 완료
              </span>
            ) : null}
          </div>
          <h1 className="mt-3 text-xl font-extrabold text-white sm:text-2xl">AI 보장분석</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-6" style={{ color: 'rgba(203,213,225,0.92)' }}>
            고객 <b className="text-[#e6c877]">증권을 올리면</b> AI가 담보를 전부 읽어{' '}
            <b className="text-[#e6c877]">카테고리별 보장현황·공백·적정성</b>과 <b className="text-white">보완 제안</b>까지 정리합니다.
            보험금 계산이 아니라 <b className="text-white">"뭐가 부족하고 뭘 제안할까"</b>에 초점을 둡니다.
          </p>
          <div className="mt-4 flex items-center gap-2">
            {[
              { n: 1, label: '증권 업로드' },
              { n: 2, label: 'AI 보장분석' },
              { n: 3, label: '공백·제안' }
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

      {/* ── 1단계: 업로드 ──────────────────────────────────────────── */}
      {phase === 'input' ? (
        <>
          {disabled ? (
            <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[13px] leading-6 text-sky-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>AI 보장분석 서버(insurance-analysis)가 아직 준비되지 않았습니다. 관리자가 엣지 함수 배포를 완료하면 즉시 사용할 수 있습니다.</span>
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
              <h2 className="text-sm font-bold text-slate-100">고객 선택 — 나이·병력 자동 반영</h2>
              <span className="text-[11px] text-slate-500">(선택 시 결과가 고객 기록에 자동 저장)</span>
            </div>
            {customer ? (
              <div className="flex items-center justify-between rounded-xl border border-[#c6982f]/40 bg-[#c6982f]/5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0e1e3a] text-[12px] font-bold text-[#e6c877]">{customer.name.slice(0, 1)}</span>
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
                    placeholder="고객 이름/전화로 검색 (건너뛰어도 됩니다)"
                    className="w-full bg-transparent text-[13px] text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </div>
                {pickerOpen && filteredCustomers.length > 0 ? (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-slate-800 bg-white shadow-lg">
                    {filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setHubCustomer(c)
                          setPickerOpen(false)
                          setCustomerQuery('')
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-950"
                      >
                        <User className="h-3.5 w-3.5 text-slate-400" />
                        <span className="text-[13px] font-medium text-slate-200">{c.name}</span>
                        <span className="text-[11px] text-slate-500">{c.phone ?? ''}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {customer && past.length > 0 ? (
              <div className="mt-3">
                <button type="button" onClick={() => setPastOpen((v) => !v)} className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-400 hover:text-[#b0821f]">
                  <History className="h-3.5 w-3.5" /> 지난 보장분석 {past.length}건
                  {pastOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                {pastOpen ? (
                  <div className="mt-2 space-y-1.5">
                    {past.map((pv) => (
                      <button
                        key={pv.id}
                        type="button"
                        onClick={() => {
                          setResult(pv.result)
                          setSaveState('idle')
                          setPhase('result')
                        }}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left hover:border-[#c6982f]/50"
                      >
                        <span className="text-[12px] text-slate-300">{new Date(pv.createdAt).toLocaleString('ko-KR')}</span>
                        <span className="truncate pl-2 text-[11px] text-slate-500">{pv.result.summary?.slice(0, 40)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* 업로드 */}
          <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <UploadCloud className="h-4 w-4 text-[#b0821f]" />
              <h2 className="text-sm font-bold text-slate-100">증권 올리기 — 여러 장 가능 (최대 6장)</h2>
            </div>
            <FileDropZone onFiles={addFiles} accept="image/*,application/pdf" dropLabel="놓으면 증권이 추가됩니다">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 bg-slate-950 py-8 transition hover:border-[#c6982f]/60 hover:bg-[#c6982f]/5"
              >
                <UploadCloud className="h-6 w-6 text-[#b0821f]" />
                <span className="text-[13px] font-semibold text-slate-200">증권 사진 · PDF — 드래그하거나 클릭해서 선택</span>
                <span className="text-[11px] text-slate-500">가입증명서·보험증권·가입내역서 모두 가능</span>
              </button>
            </FileDropZone>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e: ChangeEvent<HTMLInputElement>) => addFiles(e.target.files)} />

            {files.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {files.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-[12px] text-slate-300">
                    {f.type === 'application/pdf' ? <FileText className="h-3.5 w-3.5 text-rose-400" /> : <ImageIcon className="h-3.5 w-3.5 text-sky-400" />}
                    <span className="max-w-[160px] truncate">{f.name}</span>
                    <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-slate-500 hover:text-rose-600" aria-label="제거">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold text-slate-500">추가 메모 (선택)</div>
              <input value={extraNotes} onChange={(e) => setExtraNotes(e.target.value)} placeholder="예: 40대 가장, 자녀 2명 · 뇌·심장 보완 중점" className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[13px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]" />
            </div>

            <button
              type="button"
              onClick={() => void run()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] px-4 py-3 text-sm font-bold text-[#e6c877] shadow-md transition hover:brightness-125"
            >
              <ShieldCheck className="h-4 w-4" /> AI 보장분석 시작
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-500">분석에 30초~1분 정도 걸립니다. 증권은 저장 전까지 서버에 남지 않습니다.</p>
          </div>
        </>
      ) : null}

      {/* ── 2단계: 분석 중 ───────────────────────────────────────────── */}
      {phase === 'analyzing' ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-800 bg-white px-4 py-14 shadow-sm">
          <Loader2 className="h-8 w-8 animate-spin text-[#b0821f]" />
          <div className="text-sm font-bold text-slate-100">{ANALYZING_MESSAGES[analyzingMsg]}</div>
          <div className="text-[12px] text-slate-500">AI가 증권을 판독해 보장 공백을 찾는 중입니다 (30초~1분)</div>
        </div>
      ) : null}

      {/* ── 3단계: 결과 ──────────────────────────────────────────────── */}
      {phase === 'result' && result ? (
        <>
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0e1e3a] shadow-sm">
            <div className="relative px-5 py-6 sm:px-7">
              <div className="pointer-events-none absolute -left-10 -bottom-16 h-44 w-44 rounded-full bg-[#c6982f]/15 blur-2xl" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e6c877]/40 bg-[#c6982f]/15 px-3 py-1 text-[12px] font-bold text-[#e6c877]">
                  <BadgeCheck className="h-3.5 w-3.5" /> 보장 진단
                </span>
                {customer ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/80">
                    {saveState === 'saving' ? '저장 중…' : saveState === 'saved' ? `${customer.name} 고객 기록에 저장됨` : saveState === 'failed' ? '저장 실패' : customer.name}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 max-w-3xl text-[14px] leading-6 text-white">{result.summary}</p>
              {result.policies.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {result.policies.map((pl, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px]" style={{ color: 'rgba(203,213,225,0.9)' }}>
                      <Wallet className="h-3 w-3 text-[#e6c877]" />
                      {pl.insurer}
                      {pl.product ? ` · ${pl.product}` : ''}
                      {pl.monthlyPremium ? ` · 월 ${won(pl.monthlyPremium)}` : ''}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {/* 카테고리별 보장현황 */}
          <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="mb-3 text-sm font-bold text-slate-100">카테고리별 보장 현황</h3>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {result.categories.map((c) => (
                <div key={c.category} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className={['h-2 w-2 rounded-full', ADEQ_META[c.adequacy].dot].join(' ')} />
                      <span className="text-[13px] font-bold text-slate-100">{c.category}</span>
                    </div>
                    <span className={['rounded-full px-2.5 py-0.5 text-[11px] font-bold', ADEQ_META[c.adequacy].chip].join(' ')}>{ADEQ_META[c.adequacy].label}</span>
                  </div>
                  <div className="mt-1 text-[12px] font-semibold text-[#b0821f]">{c.current}</div>
                  {c.note ? <div className="mt-0.5 text-[12px] leading-5 text-slate-400">{c.note}</div> : null}
                </div>
              ))}
            </div>
          </div>

          {/* 보장 공백 */}
          {result.gaps.length > 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-100">
                <ShieldAlert className="h-4 w-4 text-rose-500" /> 보장 공백 — 보완이 필요한 부분
              </h3>
              <div className="space-y-2.5">
                {result.gaps.map((g, i) => (
                  <div key={i} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[13px] font-bold text-slate-100">{g.title}</div>
                      <span className={['rounded-full border px-2 py-0.5 text-[10px] font-bold', SEV_META[g.severity].chip].join(' ')}>{SEV_META[g.severity].label}</span>
                    </div>
                    <div className="mt-1 text-[12px] leading-5 text-slate-400">{g.why}</div>
                    {g.suggestion ? (
                      <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-[#c6982f]/5 px-2.5 py-1.5 text-[12px] text-[#b0821f]">
                        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{g.suggestion}</span>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* 종합 제안 */}
          {result.recommendation ? (
            <div className="rounded-2xl border border-[#c6982f]/40 bg-gradient-to-r from-[#c6982f]/10 to-transparent p-4 shadow-sm sm:p-5">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-100">
                <Sparkles className="h-4 w-4 text-[#b0821f]" /> 종합 제안 (설계사용)
              </h3>
              <p className="text-[13px] leading-6 text-slate-300">{result.recommendation}</p>
            </div>
          ) : null}

          {/* 고객 안내문 */}
          {result.customerMessage ? (
            <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-100">고객 안내문 (카톡용)</h3>
                <button type="button" onClick={() => void copyMessage()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e1e3a] px-3 py-1.5 text-xs font-bold text-[#e6c877] hover:brightness-125">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? '복사됨' : '복사'}
                </button>
              </div>
              <div className="whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-3 text-[13px] leading-6 text-slate-100">{result.customerMessage}</div>
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

          <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-[11px] leading-5 text-slate-500">
            본 분석은 업로드된 증권과 일반적 권장 기준에 기반한 <b>참고자료</b>입니다. 실제 보장·가입금액은 증권 원본과 약관으로 최종 확인하세요.
          </div>
          <button type="button" onClick={reset} className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-white px-4 py-2.5 text-[13px] font-bold text-slate-300 hover:border-[#c6982f]/40">
            <RotateCcw className="h-4 w-4" /> 새 보장분석
          </button>
        </>
      ) : null}
    </div>
  )
}
