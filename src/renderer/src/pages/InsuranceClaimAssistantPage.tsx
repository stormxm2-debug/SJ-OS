import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  ShieldCheck,
  Loader2,
  AlertTriangle,
  Copy,
  Check,
  Sparkles,
  UploadCloud,
  FileText,
  Image as ImageIcon,
  X,
  Scale,
  BadgeCheck,
  Gem,
  Search,
  User,
  RotateCcw,
  Send,
  Landmark,
  History,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import {
  analyzeClaimExpert,
  generateAppeal,
  saveClaimAnalysis,
  listClaimAnalyses,
  won,
  fileSizeIssue,
  type ClaimExpertResult,
  type ClaimProgress,
  type ClaimAppeal,
  type SavedClaimAnalysis
} from '@renderer/services/insurance-claim/claimExpertService'
import { listCustomers } from '@renderer/services/commercial/customerService'
import {
  deletePolicyTerm,
  listPolicyTerms,
  registerPolicyTerm,
  saveWebTerms,
  type PolicyTerm
} from '@renderer/services/insurance-claim/policyTermsService'
import type { CustomerRecord } from '@shared/commercial/models'

/**
 * 보험금 청구비서 완전판 — Claude 기반 보상전문가.
 *
 * 1) 서류 무제한 업로드(증권·약관·병원서류·건강자료) → 배치 판독
 * 2) 회사별·담보별 예상 보험금 + 약관 조항 인용 + 숨은 청구(소멸시효)
 * 3) 고객 발송 안내문 + 부지급 시 재검토(이의) 요청서 생성
 * 고객을 선택하면 결과가 고객 기록에 자동 저장된다. 서류는 저장되지 않는다.
 */

type Phase = 'upload' | 'analyzing' | 'result'

const DOC_TYPE_STYLE: Record<string, string> = {
  증권: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  약관: 'border-violet-200 bg-violet-50 text-violet-700',
  진단서: 'border-rose-200 bg-rose-50 text-rose-700',
  입퇴원확인서: 'border-rose-200 bg-rose-50 text-rose-700',
  수술확인서: 'border-rose-200 bg-rose-50 text-rose-700',
  진료비영수증: 'border-amber-200 bg-amber-50 text-amber-700',
  검진결과: 'border-sky-200 bg-sky-50 text-sky-700',
  기타: 'border-slate-800 bg-slate-950 text-slate-400'
}

export default function InsuranceClaimAssistantPage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('upload')
  const [files, setFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [customerQuery, setCustomerQuery] = useState('')
  const [customer, setCustomer] = useState<CustomerRecord | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const [progress, setProgress] = useState<ClaimProgress | null>(null)
  const [result, setResult] = useState<ClaimExpertResult | null>(null)
  const [error, setError] = useState('')
  const [disabled, setDisabled] = useState(false)

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [past, setPast] = useState<SavedClaimAnalysis[]>([])
  const [pastOpen, setPastOpen] = useState(false)

  const [message, setMessage] = useState('')
  const [copiedMsg, setCopiedMsg] = useState(false)

  const [rejection, setRejection] = useState('')
  const [appealLoading, setAppealLoading] = useState(false)
  const [appeal, setAppeal] = useState<ClaimAppeal | null>(null)
  const [appealError, setAppealError] = useState('')
  const [copiedAppeal, setCopiedAppeal] = useState(false)

  // 약관 보관함 — 한 번 등록하면 같은 상품 분석이 영구히 빨라진다
  const [terms, setTerms] = useState<PolicyTerm[]>([])
  const [termsOpen, setTermsOpen] = useState(false)
  const [forcedTermIds, setForcedTermIds] = useState<string[]>([])
  const [usedTermIds, setUsedTermIds] = useState<string[]>([])
  const [autoSavedTerms, setAutoSavedTerms] = useState<string[]>([])
  const [regInsurer, setRegInsurer] = useState('')
  const [regProduct, setRegProduct] = useState('')
  const [regBusy, setRegBusy] = useState(false)
  const [regMsg, setRegMsg] = useState('')
  const termsFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void listPolicyTerms().then(setTerms)
  }, [])

  const registerTerms = async (file: File | null): Promise<void> => {
    if (!file) return
    setRegBusy(true)
    setRegMsg('')
    const res = await registerPolicyTerm({
      file,
      insurer: regInsurer,
      productName: regProduct,
      onProgress: (m) => setRegMsg(m)
    })
    setRegBusy(false)
    if (!res.ok || !res.term) {
      setRegMsg(res.error ?? '등록 실패')
      return
    }
    setTerms((prev) => [res.term as PolicyTerm, ...prev])
    setRegInsurer('')
    setRegProduct('')
    setRegMsg(`✓ 등록 완료 — 조항 ${res.term.summary.clauses.length}개 요약됨. 이제 이 상품 분석이 빨라집니다.`)
  }

  const removeTerm = async (t: PolicyTerm): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm(`보관함에서 "${t.insurer} ${t.productName}" 약관을 삭제할까요?`)) return
    const res = await deletePolicyTerm(t)
    if (!res.ok) {
      setRegMsg(res.error ?? '삭제 실패')
      return
    }
    setTerms((prev) => prev.filter((x) => x.id !== t.id))
  }

  // 고객 목록 (선택은 옵션 — 선택 시 결과가 고객 기록에 저장된다)
  useEffect(() => {
    void listCustomers().then((r) => {
      if (r.ok) setCustomers(r.customers)
    })
  }, [])

  // 고객 선택 시 지난 분석 이력 로드
  useEffect(() => {
    if (!customer) {
      setPast([])
      return
    }
    void listClaimAnalyses(customer.id).then((r) => setPast(r.items))
  }, [customer])

  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase()
    if (!q) return customers.slice(0, 8)
    return customers.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q)).slice(0, 8)
  }, [customers, customerQuery])

  const supported = (f: File): boolean => f.type === 'application/pdf' || f.type.startsWith('image/')

  const addFiles = (incoming: FileList | File[]): void => {
    const ok = Array.from(incoming).filter(supported)
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`))
      const merged = [...prev]
      for (const f of ok) {
        const key = `${f.name}:${f.size}`
        if (!seen.has(key)) {
          seen.add(key)
          merged.push(f)
        }
      }
      return merged
    })
  }

  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    if (e.target.files) addFiles(e.target.files)
    e.target.value = ''
  }
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }

  const totalMb = (files.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)
  const sizeIssues = files.map(fileSizeIssue).filter((m): m is string => Boolean(m))

  const analyze = async (): Promise<void> => {
    if (files.length === 0) return
    setPhase('analyzing')
    setError('')
    setDisabled(false)
    setResult(null)
    setAppeal(null)
    setRejection('')
    setSaveState('idle')
    const res = await analyzeClaimExpert({
      files,
      customerName: customer?.name,
      onProgress: (p) => setProgress(p),
      policyTerms: terms.map((t) => ({ id: t.id, insurer: t.insurer, summary: t.summary, filePath: t.filePath })),
      forcedTermIds
    })
    if (!res.ok || !res.result) {
      setError(res.error ?? '분석에 실패했습니다.')
      setDisabled(Boolean(res.disabled))
      setPhase('upload')
      return
    }
    setUsedTermIds(res.usedTerms ?? [])
    setResult(res.result)
    // 웹에서 확인한 약관 → 보관함 자동 저장 (다음 분석부터 검색 없이 즉시 적용)
    if ((res.webTerms ?? []).length > 0) {
      void saveWebTerms(res.webTerms as unknown[], terms).then((added) => {
        if (added.length > 0) {
          setTerms((prev) => [...added, ...prev])
          setAutoSavedTerms(added.map((t) => `${t.insurer} · ${t.productName}`))
        }
      })
    } else {
      setAutoSavedTerms([])
    }
    setMessage(res.result.customerMessage)
    setPhase('result')
    // 고객이 선택돼 있으면 고객 기록에 자동 저장
    if (customer) {
      setSaveState('saving')
      const saved = await saveClaimAnalysis(customer.id, res.result)
      setSaveState(saved.ok ? 'saved' : 'failed')
      if (saved.ok) void listClaimAnalyses(customer.id).then((r) => setPast(r.items))
    }
  }

  const loadPast = (item: SavedClaimAnalysis): void => {
    setResult(item.result)
    setMessage(item.result.customerMessage ?? '')
    setAppeal(null)
    setRejection('')
    setSaveState('idle')
    setPhase('result')
    setPastOpen(false)
  }

  const runAppeal = async (): Promise<void> => {
    if (!result) return
    setAppealLoading(true)
    setAppealError('')
    setAppeal(null)
    const res = await generateAppeal({ result, rejection })
    setAppealLoading(false)
    if (!res.ok || !res.appeal) {
      setAppealError(res.error ?? '요청서 생성에 실패했습니다.')
      return
    }
    setAppeal(res.appeal)
  }

  const reset = (): void => {
    setPhase('upload')
    setFiles([])
    setResult(null)
    setError('')
    setAppeal(null)
    setRejection('')
    setSaveState('idle')
  }

  const stepNow = phase === 'upload' ? 1 : phase === 'analyzing' ? 2 : 3

  return (
    <div className="space-y-5">
      {/* ── 히어로 (딥네이비 + 골드) ─────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0e1e3a] shadow-sm">
        <div className="relative px-5 py-6 sm:px-7">
          <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-[#c6982f]/15 blur-2xl" />
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e6c877]/40 bg-[#c6982f]/15 px-2.5 py-1 text-[11px] font-bold tracking-wide text-[#e6c877]">
              <Gem className="h-3 w-3" /> 보상전문가 AI · Claude
            </span>
            {result && phase === 'result' ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                <BadgeCheck className="h-3 w-3" /> 분석 완료
              </span>
            ) : null}
          </div>
          <h1 className="mt-3 text-xl font-extrabold text-white sm:text-2xl">보험금 청구비서</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-6 text-slate-300/90" style={{ color: 'rgba(203,213,225,0.92)' }}>
            증권·약관·병원서류·건강자료를 <b className="text-[#e6c877]">분량 제한 없이</b> 올리면, AI가 서류를 전부 판독해{' '}
            <b className="text-[#e6c877]">회사별·담보별 보험금과 약관 근거 조항</b>까지 정리합니다. 보험사가 아니라{' '}
            <b className="text-white">고객의 편</b>에서.
          </p>
          {/* 단계 표시 */}
          <div className="mt-4 flex items-center gap-2">
            {[
              { n: 1, label: '서류 업로드' },
              { n: 2, label: 'AI 정밀 분석' },
              { n: 3, label: '안내문 · 재검토' }
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

      {/* ── 1단계: 업로드 ────────────────────────────────────────── */}
      {phase === 'upload' ? (
        <>
          {disabled ? (
            <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[13px] leading-6 text-sky-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Claude 분석 키(ANTHROPIC_API_KEY)가 아직 서버에 설정되지 않았습니다. 관리자(대표님)가 Supabase → Edge
                Functions → Secrets에 키를 추가하면 즉시 사용할 수 있습니다.
              </span>
            </div>
          ) : null}
          {error ? (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] leading-6 text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <UploadCloud className="h-4 w-4 text-[#b0821f]" />
              <h2 className="text-sm font-bold text-slate-100">서류 올리기 — 많을수록 정확합니다</h2>
            </div>

            {/* 고객 선택 (옵션) */}
            <div className="relative mb-4">
              <div className="mb-1.5 text-[11px] font-semibold text-slate-500">
                고객 선택 <span className="font-normal">(선택 시 분석 결과가 고객 기록에 자동 저장)</span>
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
                  <button type="button" onClick={() => setCustomer(null)} className="rounded p-1 text-slate-400 hover:text-rose-600" aria-label="고객 해제">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
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
                            setCustomer(c)
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
                      <button
                        type="button"
                        onClick={() => setPickerOpen(false)}
                        className="w-full border-t border-slate-800 px-3 py-1.5 text-center text-[11px] text-slate-500 hover:bg-slate-950"
                      >
                        닫기
                      </button>
                    </div>
                  ) : null}
                </>
              )}
              {/* 지난 분석 이력 */}
              {customer && past.length > 0 ? (
                <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950">
                  <button
                    type="button"
                    onClick={() => setPastOpen((v) => !v)}
                    className="flex w-full items-center justify-between px-3 py-2 text-[12px] font-semibold text-slate-300"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <History className="h-3.5 w-3.5 text-[#b0821f]" /> 이 고객의 지난 분석 {past.length}건
                    </span>
                    {pastOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {pastOpen
                    ? past.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => loadPast(p)}
                          className="flex w-full items-center justify-between border-t border-slate-800 px-3 py-2 text-left hover:bg-white"
                        >
                          <span className="text-[12px] text-slate-300">{new Date(p.createdAt).toLocaleDateString('ko-KR')} 분석</span>
                          <span className="text-[12px] font-bold text-[#b0821f]">{won(p.result?.grandTotal ?? 0)}</span>
                        </button>
                      ))
                    : null}
                </div>
              ) : null}
            </div>

            {/* 약관 보관함 — 등록된 약관은 증권의 보험사와 자동 매칭되어 분석이 빨라진다 */}
            <div className="mb-4 rounded-xl border border-[#c6982f]/30 bg-[#c6982f]/5">
              <button
                type="button"
                onClick={() => setTermsOpen((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2.5"
              >
                <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-200">
                  <Gem className="h-3.5 w-3.5 text-[#b0821f]" /> 약관 보관함 {terms.length}개
                  <span className="font-normal text-slate-500">— 등록된 상품은 자동 매칭되어 빠르고 정확</span>
                </span>
                {termsOpen ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
              </button>
              {termsOpen ? (
                <div className="border-t border-[#c6982f]/20 px-3 py-3">
                  {terms.length > 0 ? (
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {terms.map((t) => {
                        const forced = forcedTermIds.includes(t.id)
                        return (
                          <span key={t.id} className={['inline-flex items-center overflow-hidden rounded-full border text-[11px]', forced ? 'border-emerald-300 bg-emerald-50' : 'border-slate-800 bg-white'].join(' ')}>
                            <button
                              type="button"
                              title="클릭하면 이번 분석에 강제 포함"
                              onClick={() => setForcedTermIds((prev) => (forced ? prev.filter((x) => x !== t.id) : [...prev, t.id]))}
                              className={['px-2.5 py-1 font-semibold', forced ? 'text-emerald-700' : 'text-slate-300'].join(' ')}
                            >
                              {forced ? '✓ ' : ''}{t.insurer} · {t.productName}
                            </button>
                            <button type="button" aria-label="약관 삭제" onClick={() => void removeTerm(t)} className="px-1.5 py-1 text-slate-400 hover:text-rose-600">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="mb-3 text-[11px] text-slate-500">아직 등록된 약관이 없습니다. 자주 다루는 상품 약관을 등록해 두면 분석이 훨씬 빨라집니다.</p>
                  )}
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                    <input value={regInsurer} onChange={(e) => setRegInsurer(e.target.value)} placeholder="보험사 (예: 삼성화재)" className="rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-500" />
                    <input value={regProduct} onChange={(e) => setRegProduct(e.target.value)} placeholder="상품명 (예: 마이헬스파트너)" className="rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-500" />
                    <button
                      type="button"
                      disabled={regBusy || !regInsurer.trim() || !regProduct.trim()}
                      onClick={() => termsFileRef.current?.click()}
                      className={['inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-bold', regBusy || !regInsurer.trim() || !regProduct.trim() ? 'cursor-not-allowed bg-slate-200 text-slate-400' : 'bg-[#0e1e3a] text-[#e6c877] hover:brightness-125'].join(' ')}
                    >
                      {regBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />} 약관 PDF 등록
                    </button>
                  </div>
                  <input ref={termsFileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { void registerTerms(e.target.files?.[0] ?? null); e.target.value = '' }} />
                  {regMsg ? <p className="mt-2 text-[11px] font-medium text-slate-400">{regMsg}</p> : null}
                </div>
              ) : null}
            </div>

            {/* 드롭존 */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={[
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition',
                dragOver ? 'border-[#c6982f] bg-[#c6982f]/10' : 'border-slate-700 bg-slate-950 hover:border-[#c6982f]/60 hover:bg-[#c6982f]/5'
              ].join(' ')}
            >
              <UploadCloud className={['h-10 w-10', dragOver ? 'text-[#b0821f]' : 'text-slate-500'].join(' ')} />
              <div className="text-sm font-bold text-slate-100">
                서류를 드래그하거나 <span className="text-[#b0821f]">클릭해서 선택</span>
              </div>
              <div className="text-[11px] leading-5 text-slate-500">
                증권 · 약관 · 진단서 · 입퇴원/수술확인서 · 진료비영수증 · 건강검진(5년) — PDF·사진
                <br />
                <b className="text-slate-400">개수 제한 없음</b> · 사진은 자동 압축(무제한) · PDF는 파일당 8MB
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept="application/pdf,image/*" multiple onChange={onPick} className="hidden" />

            {/* 파일 목록 */}
            {files.length > 0 ? (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
                  <span>
                    올린 서류 <b className="text-slate-300">{files.length}개</b> · {totalMb}MB
                    {files.length > 5 ? <span className="ml-1 text-[#b0821f]">(배치로 나눠 순차 판독합니다)</span> : null}
                  </span>
                  <button type="button" onClick={() => setFiles([])} className="text-slate-400 hover:text-rose-600">
                    모두 지우기
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {files.map((f, i) => {
                    const isPdf = f.type === 'application/pdf'
                    const over = fileSizeIssue(f) !== null
                    return (
                      <div
                        key={`${f.name}:${f.size}:${i}`}
                        className={['flex items-center gap-2 rounded-lg border px-3 py-2', over ? 'border-rose-300 bg-rose-50' : 'border-slate-800 bg-white'].join(' ')}
                      >
                        <span className={['flex h-8 w-8 shrink-0 items-center justify-center rounded-md', isPdf ? 'bg-rose-50 text-rose-600' : 'bg-sky-50 text-sky-600'].join(' ')}>
                          {isPdf ? <FileText className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] font-medium text-slate-200">{f.name}</div>
                          <div className={['text-[10px]', over ? 'font-bold text-rose-600' : 'text-slate-500'].join(' ')}>
                            {(f.size / 1024 / 1024).toFixed(1)}MB{over ? ' · 용량 초과' : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          aria-label="삭제"
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {sizeIssues.length > 0 ? (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] leading-5 text-rose-700">
                {sizeIssues[0]}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void analyze()}
              disabled={files.length === 0 || sizeIssues.length > 0}
              className={[
                'mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-extrabold transition sm:w-auto sm:px-8',
                files.length > 0 && sizeIssues.length === 0
                  ? 'bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] text-[#e6c877] shadow-md hover:brightness-125'
                  : 'cursor-not-allowed bg-slate-200 text-slate-400'
              ].join(' ')}
            >
              <Sparkles className="h-4 w-4" />
              {files.length > 0 ? `서류 ${files.length}개 정밀 분석 시작` : '서류를 먼저 올려주세요'}
            </button>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              서류는 분석 후 즉시 폐기되며 서버에 저장되지 않습니다. 결과는 AI 손해사정 추정이며 실제 지급은 보험사 심사에
              따라 달라질 수 있습니다.
            </p>
          </div>
        </>
      ) : null}

      {/* ── 2단계: 분석 진행 ─────────────────────────────────────── */}
      {phase === 'analyzing' ? <AnalyzingPanel progress={progress} fileCount={files.length} /> : null}

      {/* ── 3단계: 결과 ──────────────────────────────────────────── */}
      {phase === 'result' && result ? (
        <>
          {/* 저장 상태 + 새 분석 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] text-slate-500">
              {customer ? (
                saveState === 'saved' ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                    <BadgeCheck className="h-3.5 w-3.5" /> {customer.name} 고객 기록에 저장됨
                  </span>
                ) : saveState === 'saving' ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> 고객 기록에 저장 중…
                  </span>
                ) : saveState === 'failed' ? (
                  <span className="text-rose-600">고객 기록 저장 실패 (결과는 그대로 사용 가능)</span>
                ) : (
                  <span>{customer.name} 고객의 분석</span>
                )
              ) : (
                <span>고객 미선택 — 저장되지 않는 1회성 분석입니다.</span>
              )}
            </div>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-white px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-950"
            >
              <RotateCcw className="h-3.5 w-3.5" /> 새 분석
            </button>
          </div>

          {/* 웹에서 확인한 약관 자동 보관 알림 */}
          {autoSavedTerms.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-violet-200 bg-violet-50/60 px-4 py-2.5">
              <Gem className="h-4 w-4 text-violet-600" />
              <span className="text-[12px] font-bold text-violet-700">웹에서 확인한 약관 {autoSavedTerms.length}건을 보관함에 자동 저장 — 다음 분석부터 검색 없이 즉시 적용됩니다:</span>
              {autoSavedTerms.map((label, i) => (
                <span key={i} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-violet-700">{label}</span>
              ))}
            </div>
          ) : null}

          {/* 적용된 보관함 약관 */}
          {usedTermIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-2.5">
              <BadgeCheck className="h-4 w-4 text-emerald-600" />
              <span className="text-[12px] font-bold text-emerald-700">보관함 약관 자동 적용 {usedTermIds.length}건:</span>
              {terms.filter((t) => usedTermIds.includes(t.id)).map((t) => (
                <span key={t.id} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{t.insurer} · {t.productName}</span>
              ))}
            </div>
          ) : null}

          {/* 판독된 서류 */}
          {result.docs.length > 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
              <div className="mb-2 text-[12px] font-bold text-slate-300">판독된 서류 {result.docs.length}건</div>
              <div className="flex flex-wrap gap-1.5">
                {result.docs.map((d) => (
                  <span
                    key={d.index}
                    title={d.fileName ?? ''}
                    className={[
                      'inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                      DOC_TYPE_STYLE[d.docType] ?? DOC_TYPE_STYLE['기타']
                    ].join(' ')}
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {d.docType}
                      {d.insurer ? ` · ${d.insurer}` : ''}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* 총액 히어로 */}
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0e1e3a] shadow-sm">
            <div className="relative px-5 py-6 text-center sm:py-8">
              <div className="pointer-events-none absolute -left-10 -bottom-16 h-44 w-44 rounded-full bg-[#c6982f]/15 blur-2xl" />
              <div className="text-[12px] font-semibold tracking-widest text-[#e6c877]">예상 총 보험금</div>
              <div className="mt-1 text-3xl font-black text-white sm:text-4xl">{won(result.grandTotal)}</div>
              <div className="mt-2 text-[12px]" style={{ color: 'rgba(203,213,225,0.85)' }}>
                {result.companies.length}개 보험사 · 담보 {result.companies.reduce((s, c) => s + c.items.length, 0)}건 — 아래
                근거 조항까지 확인하세요
              </div>
            </div>
          </div>

          {/* 회사별 카드 */}
          <div className="space-y-4">
            {result.companies.map((c, ci) => (
              <div key={`${c.name}:${ci}`} className="overflow-hidden rounded-2xl border border-slate-800 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-[#b0821f]" />
                    <span className="text-sm font-extrabold text-slate-100">{c.name}</span>
                  </div>
                  <span className="text-sm font-black text-[#b0821f]">{won(c.subtotal)}</span>
                </div>
                <div className="divide-y divide-slate-800/60">
                  {c.items.map((it, ii) => (
                    <div key={`${it.coverage}:${ii}`} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-slate-100">{it.coverage}</div>
                          {it.calc ? <div className="mt-0.5 text-[11px] text-slate-500">산정: {it.calc}</div> : null}
                        </div>
                        <div className="shrink-0 text-right text-[14px] font-extrabold text-slate-100">{won(it.amount)}</div>
                      </div>
                      <div className="mt-2 flex items-start gap-2 rounded-lg bg-slate-950 px-3 py-2">
                        <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#b0821f]" />
                        <div className="min-w-0">
                          <div className="text-[12px] leading-5 text-slate-300">{it.basis}</div>
                          <span
                            className={[
                              'mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold',
                              it.basisSource === 'clause-confirmed'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : it.basisSource === 'web-confirmed'
                                  ? 'border-violet-200 bg-violet-50 text-violet-700'
                                  : it.basisSource === 'policy-stated'
                                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                                    : 'border-amber-200 bg-amber-50 text-amber-700'
                            ].join(' ')}
                          >
                            {it.basisSource === 'clause-confirmed' ? (
                              <>
                                <BadgeCheck className="h-3 w-3" /> 상품약관 조항 확인됨
                              </>
                            ) : it.basisSource === 'web-confirmed' ? (
                              <>
                                <BadgeCheck className="h-3 w-3" /> 인터넷 약관 확인 — 가입시점 약관 대조 권장
                              </>
                            ) : it.basisSource === 'policy-stated' ? (
                              <>
                                <FileText className="h-3 w-3" /> 증권 기재 기준 — 약관 업로드 시 조항 확정
                              </>
                            ) : (
                              <>
                                <AlertTriangle className="h-3 w-3" /> 표준약관 추정 — 약관 업로드 시 조항 확정
                              </>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {c.items.length === 0 ? <div className="px-4 py-3 text-[12px] text-slate-500">지급 가능 담보를 찾지 못했습니다.</div> : null}
                </div>
              </div>
            ))}
          </div>

          {/* 지급 제외 담보 (전수 검토 결과) */}
          {result.excluded && result.excluded.length > 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
              <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-extrabold text-slate-100">
                <Scale className="h-4 w-4 text-slate-500" /> 검토했지만 이번 건에 지급되지 않는 담보 {result.excluded.length}건
              </h3>
              <p className="mb-2 text-[11px] text-slate-500">증권의 전 담보를 빠짐없이 검토한 결과입니다 — 사유가 부당해 보이면 아래 재검토 요청서를 활용하세요.</p>
              <ul className="space-y-1.5">
                {result.excluded.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] leading-5">
                    <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">제외</span>
                    <span className="text-slate-200">
                      <b>{e.coverage}</b> — <span className="text-slate-400">{e.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* 숨은 청구 (소멸시효) */}
          {result.hiddenClaims.length > 0 ? (
            <div className="rounded-2xl border border-[#c6982f]/40 bg-gradient-to-r from-[#c6982f]/10 to-transparent p-4 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <Gem className="h-4 w-4 text-[#b0821f]" />
                <h3 className="text-sm font-extrabold text-slate-100">놓치고 있던 보험금 — 소멸시효 3년 안에 청구하세요</h3>
              </div>
              <ul className="space-y-1.5">
                {result.hiddenClaims.map((h, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 text-[13px] leading-6 text-slate-200">
                    <span>· {h.desc}</span>
                    {h.amount ? <b className="shrink-0 text-[#b0821f]">{won(h.amount)}</b> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* 주의 + 필요서류 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {result.cautions.length > 0 ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-extrabold text-rose-700">
                  <AlertTriangle className="h-4 w-4" /> 부지급·삭감 주의 포인트
                </h3>
                <ul className="space-y-1 text-[12px] leading-6 text-rose-800/90">
                  {result.cautions.map((c, i) => (
                    <li key={i}>· {c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {result.neededDocs.length > 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-white p-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-extrabold text-slate-100">
                  <FileText className="h-4 w-4 text-[#b0821f]" /> 청구 시 필요 서류
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {result.neededDocs.map((d, i) => (
                    <span key={i} className="rounded-full border border-slate-800 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-slate-300">
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* 고객 발송 안내문 */}
          <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-100">
                <Send className="h-4 w-4 text-[#b0821f]" /> 고객 발송용 안내문 (카톡 그대로 전송)
              </h3>
              <button
                type="button"
                onClick={() => writeClipboard(message, setCopiedMsg)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e1e3a] px-3 py-1.5 text-xs font-bold text-[#e6c877] hover:brightness-125"
              >
                {copiedMsg ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedMsg ? '복사됨' : '안내문 복사'}
              </button>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={7}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-[13px] leading-6 text-slate-100 outline-none focus:border-[#c6982f]"
            />
            <p className="mt-1 text-[11px] text-slate-500">보내기 전에 자유롭게 수정하세요.</p>
          </div>

          {/* 재검토 요청서 */}
          <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-100">
              <ShieldCheck className="h-4 w-4 text-[#b0821f]" /> 보상팀이 지급을 거절했나요? — 재검토 요청서
            </h3>
            <p className="mt-1 text-[12px] leading-5 text-slate-500">
              보상팀의 부지급/삭감 통보 내용을 붙여넣으면, 약관 조항을 근거로 한 <b className="text-slate-300">이의(재검토) 요청서</b>를
              만들어 드립니다.
            </p>
            <textarea
              value={rejection}
              onChange={(e) => setRejection(e.target.value)}
              rows={3}
              placeholder='예: "상해수술비는 약관상 수술 정의에 해당하지 않아 부지급 처리되었습니다" (문자/통화 내용 그대로)'
              className="mt-3 w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-[13px] leading-6 text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
            />
            <button
              type="button"
              onClick={() => void runAppeal()}
              disabled={!rejection.trim() || appealLoading}
              className={[
                'mt-2 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-extrabold transition',
                rejection.trim() && !appealLoading
                  ? 'bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] text-[#e6c877] hover:brightness-125'
                  : 'cursor-not-allowed bg-slate-200 text-slate-400'
              ].join(' ')}
            >
              {appealLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
              {appealLoading ? '약관 근거로 반박문 작성 중…' : '재검토 요청서 생성'}
            </button>
            {appealError ? <div className="mt-2 text-[12px] font-medium text-rose-600">{appealError}</div> : null}

            {appeal ? (
              <div className="mt-4 space-y-3">
                {appeal.keyPoints.length > 0 ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                    <div className="mb-1 text-[12px] font-extrabold text-emerald-700">핵심 반박 포인트</div>
                    <ul className="space-y-0.5 text-[12px] leading-6 text-emerald-800">
                      {appeal.keyPoints.map((k, i) => (
                        <li key={i}>· {k}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="relative">
                  <div className="whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-4 pr-12 text-[13px] leading-7 text-slate-100">
                    {appeal.appealLetter}
                  </div>
                  <button
                    type="button"
                    onClick={() => writeClipboard(appeal.appealLetter, setCopiedAppeal)}
                    aria-label="요청서 복사"
                    className="absolute right-3 top-3 rounded-lg border border-slate-800 bg-white p-1.5 text-slate-400 hover:text-[#b0821f]"
                  >
                    {copiedAppeal ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <p className="pb-2 text-center text-[11px] text-slate-500">
            본 분석은 AI 손해사정 추정으로, 실제 지급액·지급 여부는 보험사 심사 결과에 따라 달라질 수 있습니다.
          </p>
        </>
      ) : null}
    </div>
  )
}

/** 분석 진행 패널 — 준비(압축) → 배치 판독 → 종합 계산 3단계 진행률. */
function AnalyzingPanel({ progress, fileCount }: { progress: ClaimProgress | null; fileCount: number }): JSX.Element {
  const stage = progress?.stage ?? 'prepare'
  const pct = !progress
    ? 3
    : stage === 'prepare'
      ? Math.round((progress.batch / Math.max(progress.totalBatches, 1)) * 12) + 3
      : stage === 'extract'
        ? Math.round((Math.max(progress.batch - 1, 0) / Math.max(progress.totalBatches, 1)) * 65) + 15
        : 85
  const title = stage === 'prepare' ? '서류 압축·준비 중…' : stage === 'extract' ? '서류 정밀 판독 중…' : '회사별 보험금 계산 · 약관 대조 중…'
  const detail =
    stage === 'prepare' && progress
      ? `파일 ${progress.batch}/${progress.totalBatches} — ${(progress.fileNames ?? []).join(', ')}`
      : stage === 'extract' && progress
        ? `배치 ${progress.batch}/${progress.totalBatches} — ${(progress.fileNames ?? []).join(', ')}`
        : stage === 'synthesize'
          ? '담보별 금액 · 근거 조항 · 숨은 청구 · 고객 안내문 작성'
          : `서류 ${fileCount}개 준비 중`
  return (
    <div className="rounded-2xl border border-slate-800 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0e1e3a]">
          <Loader2 className="h-5 w-5 animate-spin text-[#e6c877]" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-slate-100">{title}</div>
          <div className="mt-0.5 truncate text-[12px] text-slate-500">{detail}</div>
        </div>
      </div>
      <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#0e1e3a] via-[#1b3a6b] to-[#c6982f] transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">
        서류가 많을수록 시간이 걸립니다(배치당 30초~1분). 화면을 닫지 마세요 — 판독이 끝나면 자동으로 결과가 열립니다.
      </p>
    </div>
  )
}

/** Copy text to the clipboard and flash a "copied" flag for 2s. */
function writeClipboard(text: string, setFlag: (v: boolean) => void): void {
  const done = (): void => {
    setFlag(true)
    window.setTimeout(() => setFlag(false), 2000)
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).then(done).catch(done)
  } else {
    done()
  }
}
