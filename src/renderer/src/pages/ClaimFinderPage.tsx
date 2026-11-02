import { useEffect, useMemo, useState } from 'react'
import { Compass, ShieldCheck, AlertTriangle, Loader2, FileSearch, RefreshCw } from 'lucide-react'
import { listHealthRecords, type HealthRecordRequest } from '@renderer/services/commercial/healthRecordService'
import { listAnalyses, type CoverageAnalysis } from '@renderer/services/commercial/coverageAnalysis'
import { listPolicyTerms, type PolicyTerm } from '@renderer/services/insurance-claim/policyTermsService'
import { listCustomers } from '@renderer/services/commercial/customerService'
import { getHubCustomer, setHubCustomer, subscribeHubCustomer } from '@renderer/services/insurance-hub/insuranceHubStore'
import type { CustomerRecord } from '@shared/commercial/models'
import {
  analyzeClaims,
  sumConfirmedAmounts,
  STATUS_LABEL,
  CLAIM_RULES_VERSION,
  type AnalyzeResult,
  type ClaimCandidate,
  type ClaimStatus
} from '@renderer/services/claim-finder/claimRules'
import {
  treatmentsFromHealthRecordResult,
  contractsFromCoverageAnalysis,
  attachPolicyTerms
} from '@renderer/services/claim-finder/adapters'
import { buildDemoInput } from '@renderer/services/claim-finder/fixtures'

/**
 * SJ CLAIM FINDER — 보험금 발굴(검토 지원).
 * 심평원 진료기록(JSON) × 보장분석 × 약관을 대조해 "검토 후보"와 "부족 서류"를 보여준다.
 * ★ 지급조건·금액은 결정론 규칙 + 검증된 약관으로만 판단(AI는 추출/후보검색 보조). 금액 미확정은 null(미산정).
 * ★ 이 결과는 "검토 전 후보"이며 "받을 수 있는 보험금"이 아니다. 보험사 지급확정과 별개.
 */

const STATUS_TONE: Record<ClaimStatus, string> = {
  CONFIRMED_CONDITIONS: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  POTENTIAL: 'bg-sky-50 text-sky-700 border-sky-200',
  NEED_DOCUMENTS: 'bg-amber-50 text-amber-700 border-amber-200',
  EXCLUDED: 'bg-slate-100 text-slate-500 border-slate-200',
  ALREADY_PAID: 'bg-slate-100 text-slate-500 border-slate-200'
}
const STATUS_ORDER: ClaimStatus[] = ['CONFIRMED_CONDITIONS', 'POTENTIAL', 'NEED_DOCUMENTS', 'ALREADY_PAID', 'EXCLUDED']
const wonOrNull = (n: number | null): string => (n == null ? '미산정(null)' : `${n.toLocaleString('ko-KR')}원`)

export default function ClaimFinderPage(): JSX.Element {
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [customer, setCustomer] = useState<CustomerRecord | null>(getHubCustomer())
  const [consent, setConsent] = useState(false)

  const [records, setRecords] = useState<HealthRecordRequest[]>([])
  const [recordId, setRecordId] = useState<string>('')
  const [analyses, setAnalyses] = useState<CoverageAnalysis[]>([])
  const [analysisId, setAnalysisId] = useState<string>('')
  const [terms, setTerms] = useState<PolicyTerm[]>([])

  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [filter, setFilter] = useState<ClaimStatus | 'ALL'>('ALL')
  const [review, setReview] = useState<Record<string, { status?: ClaimStatus; note?: string }>>({})

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const c = await listCustomers()
      if (c.ok) setCustomers(c.customers)
      setAnalyses(listAnalyses())
      const t = await listPolicyTerms()
      if (t.ok) setTerms(t.items)
    })()
    return subscribeHubCustomer((cu) => setCustomer(cu))
  }, [])

  // 고객 바뀌면 그 고객의 건강기록·보장분석 후보 로드
  useEffect(() => {
    setRecordId('')
    setAnalysisId('')
    setResult(null)
    if (!customer) {
      setRecords([])
      return
    }
    void (async () => {
      const r = await listHealthRecords(customer.id)
      if (r.ok) setRecords(r.items.filter((x) => x.status === 'completed' && x.result))
    })()
  }, [customer])

  const selectCustomer = (id: string): void => {
    const c = customers.find((x) => x.id === id) ?? null
    setCustomer(c)
    setHubCustomer(c)
    setConsent(false)
  }

  const custAnalyses = useMemo(
    () => (customer ? analyses.filter((a) => !a.customerName || a.customerName === customer.name) : analyses),
    [analyses, customer]
  )

  const onAnalyze = (): void => {
    setError(null)
    setNotice(null)
    if (!customer) return setError('먼저 고객을 선택하세요.')
    if (!consent) return setError('고객 동의 확인이 필요합니다(동의 없이는 분석할 수 없습니다).')
    const rec = records.find((r) => r.id === recordId)
    if (!rec?.result) return setError('연결할 진료기록(완료된 건강기록 조회)을 선택하세요.')
    const ca = custAnalyses.find((a) => a.id === analysisId) ?? null

    setBusy('대조·분석 중…')
    try {
      const warnings: string[] = []
      const t = treatmentsFromHealthRecordResult(rec.result, { requestId: rec.id })
      warnings.push(...t.warnings)
      const base = contractsFromCoverageAnalysis(ca)
      warnings.push(...base.warnings)
      const withTerms = attachPolicyTerms(base.contracts, terms)
      warnings.push(...withTerms.warnings)

      const res = analyzeClaims({
        treatments: t.events,
        contracts: withTerms.contracts,
        claimHistory: [], // 청구 이력 테이블 미확보 → 미확인(엔진이 '미청구 단정 금지' 처리)
        demo: false
      })
      res.warnings.push(...warnings)
      setResult(res)
      setIsDemo(false)
      setReview({})
      setFilter('ALL')
      setNotice(
        `분석 완료 — 후보 ${res.candidates.length}건 (규칙 ${res.rulesVersion}). ${
          ca ? '' : '※ 보장분석 미연결 → 대부분 「서류/약관 필요」로 표시됩니다.'
        }`
      )
    } catch {
      setError('분석 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  const onDemo = (): void => {
    setError(null)
    const res = analyzeClaims(buildDemoInput())
    setResult(res)
    setIsDemo(true)
    setReview({})
    setFilter('ALL')
    setNotice('DEMO 합성 데이터로 분석했습니다 (실제 HIRA/KB 포맷 미검증).')
  }

  const candidates = result?.candidates ?? []
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of candidates) m[c.status] = (m[c.status] ?? 0) + 1
    return m
  }, [candidates])
  const shown = filter === 'ALL' ? candidates : candidates.filter((c) => c.status === filter)
  const sum = useMemo(() => sumConfirmedAmounts(candidates), [candidates])

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="rounded-2xl border border-slate-800 bg-[#0e1e3a] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Compass className="h-4 w-4 text-[#e6c877]" />
          <h1 className="text-sm font-extrabold text-white">보험금 발굴 (검토 지원)</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">진료기록 × 보장분석 × 약관 · 규칙 {CLAIM_RULES_VERSION}</span>
          {isDemo ? <span className="rounded-full bg-[#e6c877] px-2 py-0.5 text-[10px] font-extrabold text-[#0e1e3a]">DEMO</span> : null}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-white/60">
          심평원 진료기록·보장분석·약관을 대조해 <b className="text-white/80">검토 후보</b>와 부족 서류를 제시합니다. 지급조건·금액은 검증된 약관/규칙으로만 판단하며, 약관/증빙이 없으면 금액은 <b className="text-white/80">미산정(null)</b>입니다. 이 화면의 결과는 <b className="text-white/80">「검토 전 후보」</b>이며 받을 수 있는 보험금·보험사 지급확정이 아닙니다.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ① 고객 + 동의 */}
        <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-100">① 고객 · 동의</h2>
          <label className="mt-2 block text-[11px] font-semibold text-slate-400">고객 선택</label>
          <select value={customer?.id ?? ''} onChange={(e) => selectCustomer(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]">
            <option value="">— 고객 선택 —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>
            ))}
          </select>
          <label className="mt-3 flex items-start gap-2 text-[12px] text-slate-200">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            <span>고객 동의 확인 — 본 고객의 진료기록·보장자료 대조 분석에 동의받았음. <span className="text-slate-500">(동의 없이는 분석 불가. 서버에서도 소유권·동의를 검증합니다.)</span></span>
          </label>
        </div>

        {/* ② 자료 연결 */}
        <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-100">② 자료 연결</h2>
          <label className="mt-2 block text-[11px] font-semibold text-slate-400">진료기록(건강기록 조회 결과)</label>
          <select value={recordId} onChange={(e) => setRecordId(e.target.value)} disabled={!customer}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f] disabled:opacity-50">
            <option value="">{customer ? (records.length ? '— 진료기록 선택 —' : '완료된 진료기록 없음(건강기록 조회에서 먼저 조회)') : '먼저 고객 선택'}</option>
            {records.map((r) => (
              <option key={r.id} value={r.id}>{r.product} · {new Date(r.createdAt).toLocaleDateString('ko-KR')}</option>
            ))}
          </select>
          <label className="mt-2 block text-[11px] font-semibold text-slate-400">보장분석(KB 등 보유 담보) <span className="text-slate-500">· 선택</span></label>
          <select value={analysisId} onChange={(e) => setAnalysisId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]">
            <option value="">— 미연결(약관/서류 필요로 표시) —</option>
            {custAnalyses.map((a) => (
              <option key={a.id} value={a.id}>{a.customerName || '무제'} · {new Date(a.updatedAt).toLocaleDateString('ko-KR')}</option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-slate-500">약관 보관함 {terms.length}건 연결 대기 — 담보명이 일치하면 조항·버전이 자동 연결됩니다. 원본 업로드→자동추출은 추후(어댑터 필요).</p>
        </div>
      </div>

      {/* ③ 실행 */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onAnalyze} disabled={Boolean(busy)}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0e1e3a] px-4 py-2.5 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />} 대조·분석 실행
        </button>
        <button type="button" onClick={onDemo} disabled={Boolean(busy)}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-white px-4 py-2.5 text-[13px] font-bold text-slate-200 transition hover:bg-slate-950 disabled:opacity-50">
          DEMO 데이터로 보기
        </button>
      </div>

      {notice ? <div className="rounded-xl border border-slate-800 bg-white px-4 py-2.5 text-[12px] font-semibold text-emerald-700">{notice}</div> : null}
      {error ? <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-[12px] font-semibold text-rose-700">{error}</div> : null}

      {/* ④ 결과 */}
      {result ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-100">④ 검토 결과 {isDemo ? <span className="ml-1 rounded-full bg-[#e6c877] px-2 py-0.5 text-[10px] font-extrabold text-[#0e1e3a]">DEMO</span> : null}</h2>
            <span className="text-[10px] text-slate-500">규칙 {result.rulesVersion} · {new Date(result.generatedAt).toLocaleString('ko-KR')}</span>
          </div>

          {/* 합계(검토 전 후보) 경고 */}
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <b>검토 전 후보 합계(참고): {sum.total.toLocaleString('ko-KR')}원</b> — 조건 확인 후보 중 금액 산정분만, 중복(CI 등)은 1건으로 합산. 미산정 {sum.uncomputedCount}건 제외.
              <div className="mt-0.5 text-[11px]">※ 이는 "받을 수 있는 보험금"이 아니며, 보험사 지급확정과 다릅니다. 각 건은 사람 검토·증빙 확인이 필요합니다.</div>
            </div>
          </div>

          {/* 상태 필터 */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Chip active={filter === 'ALL'} onClick={() => setFilter('ALL')}>전체 {candidates.length}</Chip>
            {STATUS_ORDER.map((s) => (
              <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>{STATUS_LABEL[s]} {counts[s] ?? 0}</Chip>
            ))}
          </div>

          {result.warnings.length ? (
            <details className="mt-2 text-[11px] text-slate-500">
              <summary className="cursor-pointer font-semibold">경고/미확인 {result.warnings.length}건</summary>
              <ul className="mt-1 list-disc pl-5">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          ) : null}

          <div className="mt-3 space-y-2.5">
            {shown.length === 0 ? (
              <p className="text-[12px] text-slate-500">해당 상태의 후보가 없습니다.</p>
            ) : (
              shown.map((c) => (
                <CandidateCard
                  key={c.id}
                  c={c}
                  review={review[c.id]}
                  onReview={(patch) => setReview((prev) => ({ ...prev, [c.id]: { ...prev[c.id], ...patch } }))}
                />
              ))
            )}
          </div>
          <p className="mt-3 text-[10px] text-slate-500">
            ※ 사람 검토(상태 수정·메모)는 현재 화면 세션에 보관됩니다. 영구 보관 테이블(claim_finder_runs/검토이력)은 마이그레이션으로 준비돼 있으나 운영 DB에는 아직 적용하지 않았습니다.
          </p>
        </div>
      ) : null}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${active ? 'border-[#c6982f] bg-[#fdf7ea] text-[#8a6a1f]' : 'border-slate-700 bg-white text-slate-400'}`}>
      {children}
    </button>
  )
}

function CandidateCard({
  c,
  review,
  onReview
}: {
  c: ClaimCandidate
  review?: { status?: ClaimStatus; note?: string }
  onReview: (patch: { status?: ClaimStatus; note?: string }) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const effStatus = review?.status ?? c.status
  return (
    <div className="rounded-xl border border-slate-800 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[effStatus]}`}>{STATUS_LABEL[effStatus]}</span>
        <span className="text-[13px] font-bold text-slate-100">{c.coverageName}</span>
        <span className="text-[11px] text-slate-500">{c.insurer} · {c.category}</span>
        {c.isDemo ? <span className="rounded-full bg-[#e6c877] px-1.5 py-0.5 text-[9px] font-extrabold text-[#0e1e3a]">DEMO</span> : null}
        <span className="ml-auto text-[12px] font-bold text-[#8a6a1f]">{wonOrNull(c.estimatedAmount)}</span>
      </div>
      {c.amountBasis ? <p className="mt-1 text-[11px] text-slate-500">금액 근거: {c.amountBasis}</p> : <p className="mt-1 text-[11px] text-slate-500">금액 근거: 미산정(약관/증빙 필요)</p>}
      <ul className="mt-1.5 list-disc pl-5 text-[11px] leading-relaxed text-slate-300">
        {c.reasons.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
      {c.missingDocs.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {c.missingDocs.map((m) => (
            <span key={m.code} title={m.reason} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">필요: {m.label}</span>
          ))}
        </div>
      ) : null}
      {c.dedupeGroupId ? <p className="mt-1 text-[10px] text-slate-500">중복 합산 방지 그룹: {c.dedupeGroupId}</p> : null}

      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 text-[11px] font-semibold text-slate-400 hover:text-slate-200">
        {open ? '원본 대조·검토 접기' : '원본 대조·검토 열기'}
      </button>
      {open ? (
        <div className="mt-2 space-y-2 rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-[11px] text-slate-200">
          <div>
            <div className="font-semibold text-slate-400">원본 대조(provenance)</div>
            <ul className="mt-0.5 list-disc pl-5">
              {c.sources.map((s, i) => (
                <li key={i}>
                  {s.kind}
                  {s.jsonPath ? ` · ${s.jsonPath}` : ''}
                  {s.fileHash ? ` · hash:${s.fileHash.slice(0, 10)}…` : ''}
                  {s.page != null ? ` · p.${s.page}` : ''}
                  {s.clauseId ? ` · 약관:${s.clauseId}@${s.clauseVersion ?? '?'}` : ''}
                  {s.note ? ` · ${s.note}` : ''}
                </li>
              ))}
            </ul>
            <div className="mt-0.5 text-slate-500">연결 진료: {c.treatmentEventIds.join(', ')} · 규칙 {c.rulesVersion}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-400">사람 검토:</span>
            <select value={review?.status ?? c.status} onChange={(e) => onReview({ status: e.target.value as ClaimStatus })}
              className="rounded border border-slate-700 bg-white px-1.5 py-1 text-[11px] text-slate-100">
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            <input value={review?.note ?? ''} onChange={(e) => onReview({ note: e.target.value })} placeholder="검토 메모"
              className="min-w-0 flex-1 rounded border border-slate-700 bg-white px-2 py-1 text-[11px] text-slate-100" />
          </div>
        </div>
      ) : null}
    </div>
  )
}
