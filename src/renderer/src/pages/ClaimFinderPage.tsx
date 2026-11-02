import { useEffect, useMemo, useReducer, useState } from 'react'
import { Compass, AlertTriangle, Loader2, FileSearch, UploadCloud } from 'lucide-react'
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
  type ClaimCandidate,
  type ClaimStatus
} from '@renderer/services/claim-finder/claimRules'
import {
  treatmentsFromHealthRecordResult,
  contractsFromCoverageAnalysis,
  attachPolicyTerms
} from '@renderer/services/claim-finder/adapters'
import { buildDemoInput } from '@renderer/services/claim-finder/fixtures'
import { claimUiReducer, INITIAL_UI_STATE } from '@renderer/services/claim-finder/uiState'
import { ingestFile, type IngestResult } from '@renderer/services/claim-finder/ingest'
import { extractPdfPagesForIngest } from '@renderer/services/claim-finder/pdfExtractor'

/**
 * SJ CLAIM FINDER — 보험금 발굴(검토 지원).
 * 심평원 진료기록(JSON) × 보장분석 × 약관을 대조해 "검토 후보"와 "부족 서류"를 보여준다.
 * ★ 지급조건·금액은 결정론 규칙 + 검증된 약관으로만 판단(AI는 추출/후보검색 보조). 금액 미확정은 null(미산정).
 * ★ 이 결과는 "검토 전 후보"이며 "받을 수 있는 보험금"이 아니다. 보험사 지급확정과 별개.
 * ★ 상태 위생: 고객 변경/동의 철회/DEMO 전환 시 이전 결과·검토메모는 reducer(uiState)가 초기화한다.
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

  const [records, setRecords] = useState<HealthRecordRequest[]>([])
  const [recordId, setRecordId] = useState<string>('')
  const [analyses, setAnalyses] = useState<CoverageAnalysis[]>([])
  const [analysisId, setAnalysisId] = useState<string>('')
  const [terms, setTerms] = useState<PolicyTerm[]>([])

  // 결과 수명주기(결과/검토/동의/DEMO/필터/안내) — 순수 reducer 로 상태 위생 보장.
  const [ui, dispatch] = useReducer(claimUiReducer, { ...INITIAL_UI_STATE, customerId: customer?.id ?? null })
  const { consent, result, isDemo, review, filter, notice, error } = ui

  const [busy, setBusy] = useState<string | null>(null)

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

  // 고객 바뀌면(외부 hub 변경 포함) 결과/검토/동의 초기화 + 그 고객 자료 로드.
  useEffect(() => {
    dispatch({ type: 'SELECT_CUSTOMER', customerId: customer?.id ?? null })
    setRecordId('')
    setAnalysisId('')
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
  }

  const custAnalyses = useMemo(
    () => (customer ? analyses.filter((a) => !a.customerName || a.customerName === customer.name) : analyses),
    [analyses, customer]
  )

  const onAnalyze = (): void => {
    if (!customer) return dispatch({ type: 'SET_ERROR', error: '먼저 고객을 선택하세요.' })
    if (!consent) return dispatch({ type: 'SET_ERROR', error: '고객 동의 확인이 필요합니다(동의 없이는 분석할 수 없습니다).' })
    const rec = records.find((r) => r.id === recordId)
    if (!rec?.result) return dispatch({ type: 'SET_ERROR', error: '연결할 진료기록(완료된 건강기록 조회)을 선택하세요.' })
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
      dispatch({
        type: 'ANALYZE_DONE',
        result: res,
        notice: `분석 완료 — 후보 ${res.candidates.length}건 (규칙 ${res.rulesVersion}). ${
          ca ? '' : '※ 보장분석 미연결 → 대부분 「서류/약관 필요」로 표시됩니다.'
        }`
      })
    } catch {
      dispatch({ type: 'SET_ERROR', error: '분석 중 오류가 발생했습니다.' })
    } finally {
      setBusy(null)
    }
  }

  const onDemo = (): void => {
    const res = analyzeClaims(buildDemoInput())
    dispatch({ type: 'DEMO_DONE', result: res, notice: 'DEMO 합성 데이터로 분석했습니다 (실제 HIRA/KB 포맷 미검증).' })
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
            <input type="checkbox" checked={consent} onChange={(e) => dispatch({ type: 'SET_CONSENT', consent: e.target.checked })} className="mt-0.5" />
            <span>고객 동의 확인 — 본 고객의 진료기록·보장자료 대조 분석에 동의받았음. <span className="text-slate-500">(동의 없이는 분석 불가. 동의를 해제하면 표시된 결과·검토메모가 즉시 제거됩니다. 서버에서도 소유권·동의를 검증합니다.)</span></span>
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
          <p className="mt-1 text-[10px] text-slate-500">약관 보관함 {terms.length}건 연결 대기 — 담보명이 일치하면 조항·버전이 자동 연결됩니다.</p>
        </div>
      </div>

      {/* 원본 파일 점검(수집 기반) — 선택. 자동 분석 파이프라인과 분리된 검증 도구. */}
      <IngestPanel />

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
            <Chip active={filter === 'ALL'} onClick={() => dispatch({ type: 'SET_FILTER', filter: 'ALL' })}>전체 {candidates.length}</Chip>
            {STATUS_ORDER.map((s) => (
              <Chip key={s} active={filter === s} onClick={() => dispatch({ type: 'SET_FILTER', filter: s })}>{STATUS_LABEL[s]} {counts[s] ?? 0}</Chip>
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
                  onReview={(patch) => dispatch({ type: 'SET_REVIEW', id: c.id, patch })}
                />
              ))
            )}
          </div>
          <p className="mt-3 text-[10px] text-slate-500">
            ※ 사람 검토(상태 수정·메모)는 현재 화면 세션에 보관됩니다. 영구 보관 테이블(claim_finder_runs/검토이력)은 마이그레이션으로 준비돼 있으나 운영 DB에는 아직 적용하지 않았습니다. 저장을 연결하면 supabase 인증(JWT) 경로로 RLS 가 소유권·동의·교차접근을 서버에서 강제합니다.
          </p>
        </div>
      ) : null}
    </div>
  )
}

/** 원본 파일(JSON/PDF) 검증·미리보기 도구. 수집 기반(ingest)을 실제 앱에서 end-to-end 로 확인. */
function IngestPanel(): JSX.Element {
  const [res, setRes] = useState<IngestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const r = await ingestFile(
        { name: file.name, declaredType: file.type, bytes },
        { extractPdfPages: extractPdfPagesForIngest } // PDF 추출기 연결(미연결 시 안전 비활성)
      )
      setRes(r)
    } catch {
      setRes(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <UploadCloud className="h-4 w-4 text-[#c6982f]" />
        <span className="text-sm font-bold text-slate-100">원본 파일 점검 (JSON/PDF) · 선택</span>
        <span className="ml-auto text-[11px] text-slate-500">{open ? '접기' : '열기'}</span>
      </button>
      {open ? (
        <div className="mt-3">
          <p className="text-[11px] leading-relaxed text-slate-500">
            심평원 진료 <b>JSON</b> 또는 KB 보장분석 <b>PDF</b> 원본의 형식·크기를 검증하고, 원본 해시(provenance)와 추출 가능 여부를 확인합니다.
            JSON 은 관측된 필드만 매핑하며(추측 안 함), PDF 는 <b>자동으로 담보·금액을 추출하지 않고</b> 페이지 원문만 제공합니다(사람이 약관과 대조·입력). 실제 HIRA/KB 포맷 정확도는 미검증입니다.
          </p>
          <input
            type="file"
            accept=".json,application/json,.pdf,application/pdf"
            onChange={(e) => void onFile(e.target.files?.[0])}
            className="mt-2 block w-full text-[12px] text-slate-300 file:mr-3 file:rounded-lg file:border file:border-slate-700 file:bg-white file:px-3 file:py-1.5 file:text-[12px] file:font-bold file:text-slate-200"
          />
          {busy ? <p className="mt-2 text-[12px] text-slate-500"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />검증 중…</p> : null}
          {res ? (
            <div className={`mt-2 rounded-xl border px-3 py-2.5 text-[12px] ${res.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              <div className="font-bold">{res.ok ? '검증 통과' : '검증 실패/확인 필요'} — {res.fileName} ({res.bytes.toLocaleString('ko-KR')}B)</div>
              <div className="mt-0.5 text-[11px]">
                종류: {res.kind ?? '미상'} {res.fileHash ? `· hash:${res.fileHash.slice(0, 12)}…` : ''}
                {res.kind === 'health_record_json' && res.events ? ` · 진료 이벤트 ${res.events.length}건` : ''}
                {res.kind === 'coverage_pdf' && res.pages ? ` · 페이지 ${res.pages.length}개(사람 확인 필요)` : ''}
              </div>
              {res.errors.length ? <ul className="mt-1 list-disc pl-5">{res.errors.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
              {res.warnings.length ? (
                <details className="mt-1 text-[11px]">
                  <summary className="cursor-pointer font-semibold">경고 {res.warnings.length}건</summary>
                  <ul className="mt-1 list-disc pl-5">{res.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </details>
              ) : null}
            </div>
          ) : null}
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
