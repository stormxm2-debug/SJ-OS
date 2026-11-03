import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Compass, AlertTriangle, Loader2, FileSearch, UploadCloud, Save } from 'lucide-react'
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
  type ClaimStatus,
  type TreatmentEvent
} from '@renderer/services/claim-finder/claimRules'
import {
  treatmentsFromHealthRecordResult,
  contractsFromCoverageAnalysis,
  attachPolicyTerms
} from '@renderer/services/claim-finder/adapters'
import { claimUiReducer, INITIAL_UI_STATE } from '@renderer/services/claim-finder/uiState'
import { ingestFile, INGEST_LIMITS, type IngestResult } from '@renderer/services/claim-finder/ingest'
import { extractPdfPagesForIngest } from '@renderer/services/claim-finder/pdfExtractor'
import { createGenerationGuard } from '@renderer/services/claim-finder/asyncGuard'
import { claimFinderStore, isClaimFinderPersistenceConfigured, type SavedRunSummary } from '@renderer/services/claim-finder/claimFinderStore'
import { validateSavedRun, reviewsToLatestMap } from '@renderer/services/claim-finder/restore'

/**
 * SJ CLAIM FINDER — 보험금 발굴(검토 지원).
 * 심평원 진료기록(JSON) × 보장분석 × 약관을 대조해 "검토 후보"와 "부족 서류"를 보여준다.
 * ★ 지급조건·금액은 결정론 규칙 + 검증된 약관으로만 판단(AI는 추출/후보검색 보조). 금액 미확정은 null(미산정).
 * ★ 이 결과는 "검토 전 후보"이며 "받을 수 있는 보험금"이 아니다. 보험사 지급확정과 별개.
 * ★ 상태 위생: 고객 변경/동의 철회/DEMO 전환 시 이전 결과·검토메모는 reducer(uiState)가 초기화한다.
 * ★ 경쟁 상태: 고객 전환 시 진료기록 로드/업로드 파싱의 늦은 응답은 세대 가드로 폐기한다.
 * ★ 저장: 사용자 세션(JWT)로 supabase 저장 → 서버 RLS 가 소유권·동의·교차접근을 강제. 미구성 시 비활성.
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

type DataSource = 'record' | 'upload'
/**
 * 분석 '당시' 입력 스냅샷. 저장은 이 스냅샷으로 하고(라이브 값 사용 금지),
 * 현재 입력이 스냅샷과 달라지면 결과를 무효화한다. gen 은 결과 scope 세대(늦은 저장/리뷰 폐기용).
 */
interface AnalyzedLink {
  gen: number
  kind: 'record' | 'upload' | 'demo'
  customerId: string | null
  customerName: string | null
  analysisId: string
  source: DataSource | null
  healthRecordRequestId?: string | null
}

export default function ClaimFinderPage(): JSX.Element {
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [customer, setCustomer] = useState<CustomerRecord | null>(getHubCustomer())

  const [records, setRecords] = useState<HealthRecordRequest[]>([])
  const [recordId, setRecordId] = useState<string>('')
  const [analyses, setAnalyses] = useState<CoverageAnalysis[]>([])
  const [analysisId, setAnalysisId] = useState<string>('')
  const [analysisConfirmed, setAnalysisConfirmed] = useState(false) // 보장분석은 안정 고객ID 없음 → 수동 확인
  const [terms, setTerms] = useState<PolicyTerm[]>([])

  const [source, setSource] = useState<DataSource>('record')
  // 업로드(원본 점검) 상태 — 고객/동의 scope. 늦은 파싱 응답은 세대 가드로 폐기.
  const [ingestBusy, setIngestBusy] = useState(false)
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null)
  const [ingestConfirmed, setIngestConfirmed] = useState(false) // 업로드가 현재 고객의 자료임을 수동 확인

  const [ui, dispatch] = useReducer(claimUiReducer, { ...INITIAL_UI_STATE, customerId: customer?.id ?? null })
  const { consent, result, review, filter, notice, error, savedRunId } = ui

  const [busy, setBusy] = useState<string | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [reviewBusy, setReviewBusy] = useState<string | null>(null)
  const [link, setLink] = useState<AnalyzedLink | null>(null)
  const persistenceConfigured = isClaimFinderPersistenceConfigured()

  // 저장된 분석 이력(요약 목록) + 로딩/불러오기 상태.
  const [savedRuns, setSavedRuns] = useState<SavedRunSummary[]>([])
  const [listBusy, setListBusy] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [loadBusyId, setLoadBusyId] = useState<string | null>(null)

  const recordsGuard = useRef(createGenerationGuard())
  const ingestGuard = useRef(createGenerationGuard())
  const resultGuard = useRef(createGenerationGuard()) // 결과 scope — 늦은 저장/리뷰 완료 폐기용
  const listGuard = useRef(createGenerationGuard()) // 저장 이력 목록 — 늦은 응답 폐기용

  // 업로드 상태 초기화 + 진행 중 파싱 폐기 + busy 해제(멈춤 방지).
  const resetIngest = (): void => {
    ingestGuard.current.invalidate()
    setIngestResult(null)
    setIngestConfirmed(false)
    setIngestBusy(false)
  }
  // 저장/검토 진행 플래그 해제. 결과 scope 가 바뀔 때마다 호출해 새 scope 에서 즉시 버튼이 살아나게 한다.
  // (이전 in-flight 작업의 finally 는 isCurrent(gen) 일 때만 busy 를 만지므로 새 scope 를 덮어쓰지 않는다.)
  const resetBusy = (): void => {
    setSaveBusy(false)
    setReviewBusy(null)
  }
  // 결과 scope 를 떠난다: 세대 무효화 + 링크/진행상태 비움(스테일 완료 폐기). 결과 비움은 선택.
  const leaveResultScope = (clearResult: boolean): void => {
    resultGuard.current.invalidate()
    setLink(null)
    resetBusy()
    if (clearResult) dispatch({ type: 'CLEAR_RESULT' })
  }
  // 결과가 입력과 불일치하게 되면 결과·검토·저장상태 무효화(스테일 완료도 폐기).
  const invalidateResult = (): void => leaveResultScope(true)
  // 동의 토글: 해제 시 결과·검토·업로드·진행상태를 모두 비우고 스테일 완료 폐기.
  const onConsent = (v: boolean): void => {
    if (!v) {
      leaveResultScope(false) // 결과는 reducer(SET_CONSENT)가 비움 — 여기선 scope/busy 만 정리
      resetIngest()
    }
    dispatch({ type: 'SET_CONSENT', consent: v })
  }

  // 저장된 분석 이력 새로고침(RLS 로 본인/관리자·유효 run 만 반환). 늦은 응답은 세대 가드로 폐기.
  const refreshSavedRuns = (): void => {
    if (!persistenceConfigured) return
    setListError(null)
    setListBusy(true)
    const gen = listGuard.current.next()
    void (async () => {
      const r = await claimFinderStore.listVisibleRuns()
      if (!listGuard.current.isCurrent(gen)) return // 그 사이 고객 전환/재조회 → 폐기
      if (r.ok) setSavedRuns(r.data ?? [])
      else if (!r.disabled) setListError(r.error ?? '목록을 불러오지 못했습니다.')
      setListBusy(false)
    })()
  }

  // 저장된 run 불러오기: 결과·검토 복원(규칙버전/shape 검증, 최신 검토값). 로드 후 중복 저장 방지(savedRunId).
  const loadRun = (summary: SavedRunSummary): void => {
    const gen = resultGuard.current.next() // 새 결과 scope — 늦은 완료 폐기
    resetBusy()
    setLoadBusyId(summary.id)
    dispatch({ type: 'SET_ERROR', error: null })
    void (async () => {
      const runRes = await claimFinderStore.getRun(summary.id)
      const revRes = await claimFinderStore.listReviews(summary.id)
      if (!resultGuard.current.isCurrent(gen)) return // 로드 중 고객 전환/재분석 → 폐기
      setLoadBusyId((cur) => (cur === summary.id ? null : cur))
      if (!runRes.ok || !runRes.data) {
        dispatch({ type: 'SET_ERROR', error: runRes.error ?? '저장된 분석을 찾을 수 없습니다(RLS 로 숨겨졌거나 삭제됨).' })
        return
      }
      const run = runRes.data
      if (run.isDemo) {
        // 운영 UI 는 DEMO(합성) 실행을 노출/불러오지 않는다(로드 가드).
        dispatch({ type: 'SET_ERROR', error: 'DEMO(합성) 분석은 운영 화면에서 불러올 수 없습니다.' })
        return
      }
      const v = validateSavedRun(run, CLAIM_RULES_VERSION)
      if (!v.ok || !v.result) {
        dispatch({ type: 'SET_ERROR', error: '저장된 결과를 복원할 수 없습니다: ' + v.errors.join(' ') })
        return
      }
      if (v.warnings.length) v.result.warnings = [...v.warnings, ...v.result.warnings]
      const reviewMap = revRes.ok ? reviewsToLatestMap((revRes.data ?? []) as never[]) : {}
      // 로드된 run 은 이미 저장됨 → link 설정(savable 표시는 '저장됨' 비활성). 입력 스냅샷도 run 기준.
      setLink({
        gen,
        kind: 'record',
        customerId: run.customerId,
        customerName: run.customerName,
        analysisId: run.coverageAnalysisRef ?? '',
        source: null,
        healthRecordRequestId: run.healthRecordRequestId
      })
      dispatch({
        type: 'LOADED_RUN',
        result: v.result,
        review: reviewMap,
        isDemo: false, // 운영 UI 는 DEMO 미노출(위 가드로 demo run 은 로드되지 않음)
        runId: run.id,
        notice: `저장된 분석 불러옴 (run ${run.id.slice(0, 8)}… · 규칙 ${run.rulesVersion} · ${new Date(run.createdAt).toLocaleString('ko-KR')}).${v.warnings.length ? ' ⚠️ 규칙 버전 차이 — 경고 참고.' : ''}`
      })
    })()
  }

  useEffect(() => {
    void (async () => {
      const c = await listCustomers()
      if (c.ok) setCustomers(c.customers)
      setAnalyses(listAnalyses())
      const t = await listPolicyTerms()
      if (t.ok) setTerms(t.items)
      refreshSavedRuns()
    })()
    return subscribeHubCustomer((cu) => setCustomer(cu))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 고객 바뀌면(외부 hub 변경 포함): 결과/검토/동의 초기화 + 즉시 자료 비움 + 늦은 응답 폐기 + 자료 로드.
  useEffect(() => {
    dispatch({ type: 'SELECT_CUSTOMER', customerId: customer?.id ?? null })
    // 즉시 초기화(이전 고객 자료가 잠깐이라도 남지 않도록).
    setRecords([])
    setRecordId('')
    setAnalysisId('')
    setAnalysisConfirmed(false)
    setIngestResult(null)
    setIngestConfirmed(false)
    setIngestBusy(false) // 전환 중 진행 스피너 멈춤 방지
    setLink(null)
    resetBusy() // 저장/검토 진행 플래그 해제 — 새 고객 결과의 버튼이 영구 비활성화되지 않도록
    ingestGuard.current.invalidate() // 진행 중 파싱 폐기
    resultGuard.current.invalidate() // 진행 중 저장/리뷰 완료 폐기
    const gen = recordsGuard.current.next()
    if (!customer) return
    void (async () => {
      const r = await listHealthRecords(customer.id)
      if (!recordsGuard.current.isCurrent(gen)) return // 그 사이 고객이 또 바뀜 → 폐기
      if (r.ok) setRecords(r.items.filter((x) => x.status === 'completed' && x.result))
    })()
    refreshSavedRuns() // 저장 이력도 현재 고객 기준으로 갱신
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer])

  const selectCustomer = (id: string): void => {
    const c = customers.find((x) => x.id === id) ?? null
    setCustomer(c)
    setHubCustomer(c)
  }

  // 보장분석 후보: 안정 고객ID가 없으므로 이름 일치로 '좁히기'만 하고, 사용 전 수동 확인을 요구한다.
  const custAnalyses = useMemo(
    () => (customer ? analyses.filter((a) => !a.customerName || a.customerName === customer.name) : analyses),
    [analyses, customer]
  )

  const onIngestFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    // ★ 새 선택은 먼저 이전 파싱 세대를 무효화(과대파일 경로 포함) → 늦은 이전 응답이 덮어쓰지 못함.
    const gen = ingestGuard.current.next()
    setIngestResult(null)
    setIngestConfirmed(false)
    setIngestBusy(false)
    // 결과가 업로드 입력에 의존했다면(업로드 소스) 새 파일로 결과 무효화.
    if (source === 'upload') invalidateResult()
    // 파싱 전 크기 제한(과대 업로드 즉시 차단).
    if (file.size > INGEST_LIMITS.maxBytes) {
      setIngestResult({ ok: false, fileName: file.name, bytes: file.size, warnings: [], errors: [`파일이 너무 큽니다(${file.size.toLocaleString('ko-KR')}B > 최대 ${INGEST_LIMITS.maxBytes.toLocaleString('ko-KR')}B).`] })
      return
    }
    setIngestBusy(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const r = await ingestFile({ name: file.name, declaredType: file.type, bytes }, { extractPdfPages: extractPdfPagesForIngest })
      if (!ingestGuard.current.isCurrent(gen)) return // 고객 전환/새 업로드로 무효 → 폐기
      setIngestResult(r)
    } catch {
      if (!ingestGuard.current.isCurrent(gen)) return
      setIngestResult({ ok: false, fileName: file.name, bytes: file.size, warnings: [], errors: ['파일을 읽는 중 오류가 발생했습니다.'] })
    } finally {
      if (ingestGuard.current.isCurrent(gen)) setIngestBusy(false)
    }
  }

  const onAnalyze = (): void => {
    if (!customer) return dispatch({ type: 'SET_ERROR', error: '먼저 고객을 선택하세요.' })
    if (!consent) return dispatch({ type: 'SET_ERROR', error: '고객 동의 확인이 필요합니다(동의 없이는 분석할 수 없습니다).' })

    let events: TreatmentEvent[]
    let analyzedLink: AnalyzedLink
    const warnings: string[] = []

    const snap = { gen: 0, customerId: customer.id, customerName: customer.name, analysisId, source }
    if (source === 'record') {
      const rec = records.find((r) => r.id === recordId)
      if (!rec?.result) return dispatch({ type: 'SET_ERROR', error: '연결할 진료기록(완료된 건강기록 조회)을 선택하세요.' })
      // ★ 경쟁 상태 방어: 레코드 고객이 현재 고객과 **정확히 일치**해야 함(값 없음도 차단 — fail-closed).
      if (rec.customerId !== customer.id) {
        return dispatch({ type: 'SET_ERROR', error: '선택한 진료기록이 현재 고객과 정확히 일치하지 않습니다(고객 식별자 누락/불일치 — 고객을 다시 확인하세요).' })
      }
      const t = treatmentsFromHealthRecordResult(rec.result, { requestId: rec.id })
      events = t.events
      warnings.push(...t.warnings)
      analyzedLink = { ...snap, kind: 'record', healthRecordRequestId: rec.id }
    } else {
      if (!ingestResult?.ok || ingestResult.kind !== 'health_record_json' || !ingestResult.events?.length) {
        return dispatch({ type: 'SET_ERROR', error: '업로드한 진료 JSON 이 유효하지 않습니다(원본 점검에서 먼저 확인하세요).' })
      }
      if (!ingestConfirmed) {
        return dispatch({ type: 'SET_ERROR', error: '업로드 자료가 현재 고객의 것임을 수동으로 확인(체크)해야 분석할 수 있습니다.' })
      }
      events = ingestResult.events
      analyzedLink = { ...snap, kind: 'upload', healthRecordRequestId: null } // 동의 앵커 없음 → 저장 불가(검토용)
    }

    // 보장분석은 안정 고객ID가 없어 자동 연결하지 않는다 — 선택 시 수동 확인 필수.
    const ca = analysisId ? custAnalyses.find((a) => a.id === analysisId) ?? null : null
    if (analysisId && !analysisConfirmed) {
      return dispatch({ type: 'SET_ERROR', error: '선택한 보장분석이 현재 고객의 것인지 수동 확인(체크)이 필요합니다(동명이인·무명 자료 혼입 방지).' })
    }

    setBusy('대조·분석 중…')
    try {
      const base = contractsFromCoverageAnalysis(ca)
      warnings.push(...base.warnings)
      const withTerms = attachPolicyTerms(base.contracts, terms)
      warnings.push(...withTerms.warnings)

      const res = analyzeClaims({ treatments: events, contracts: withTerms.contracts, claimHistory: [], demo: false })
      res.warnings.push(...warnings)
      resetBusy() // 새 결과 scope 진입 — 이전 작업 플래그 즉시 해제
      setLink({ ...analyzedLink, gen: resultGuard.current.next() }) // 새 결과 scope 세대
      dispatch({
        type: 'ANALYZE_DONE',
        result: res,
        notice: `분석 완료 — 후보 ${res.candidates.length}건 (규칙 ${res.rulesVersion}). ${
          analyzedLink.kind === 'upload' ? '※ 업로드 원본은 서버 동의 앵커가 없어 저장 불가(검토용). ' : ''
        }${ca ? '' : '※ 보장분석 미연결 → 대부분 「서류/약관 필요」로 표시됩니다.'}`
      })
    } catch {
      dispatch({ type: 'SET_ERROR', error: '분석 중 오류가 발생했습니다.' })
    } finally {
      setBusy(null)
    }
  }

  // 저장: record(동의 앵커 보유)만 가능. upload 는 서버 저장 불가. (DEMO 는 운영 UI 에서 제거됨)
  const savable = Boolean(result) && link?.kind === 'record'
  const onSave = async (): Promise<void> => {
    if (!result || !link) return
    if (link.kind !== 'record') {
      return dispatch({ type: 'SET_ERROR', error: '업로드 원본 분석은 서버에 저장할 수 없습니다(동의 앵커 없음). 저장하려면 건강기록 조회 레코드를 연결해 분석하세요.' })
    }
    const gen = link.gen // 분석 당시 결과 scope 세대
    setSaveBusy(true)
    dispatch({ type: 'SET_ERROR', error: null })
    try {
      // ★ 저장은 분석 '당시 스냅샷'(link.*)으로 — 라이브 customer/analysisId 사용 금지. (실데이터만)
      const r = await claimFinderStore.saveRun({
        customerId: link.customerId,
        customerName: link.customerName,
        healthRecordRequestId: link.healthRecordRequestId ?? null,
        coverageAnalysisRef: link.analysisId || null,
        rulesVersion: result.rulesVersion,
        isDemo: false,
        consentAt: new Date().toISOString(),
        result: result.candidates,
        warnings: result.warnings
      })
      // ★ 스테일 완료 폐기: 저장 대기 중 고객 전환/재분석/DEMO/동의철회 했으면 새 화면에 반영 금지.
      if (!resultGuard.current.isCurrent(gen)) return
      if (r.ok && r.id) {
        dispatch({ type: 'SAVE_DONE', runId: r.id, notice: `저장 완료(run ${r.id.slice(0, 8)}…). 이제 후보별 검토를 서버에 기록할 수 있습니다.` })
        refreshSavedRuns() // 새 run 이 이력 목록에 보이도록 갱신
      } else {
        dispatch({ type: 'SET_ERROR', error: (r.disabled ? '' : '저장 실패: ') + (r.error ?? '알 수 없는 오류') })
      }
    } finally {
      if (resultGuard.current.isCurrent(gen)) setSaveBusy(false)
    }
  }

  const onSaveReview = async (c: ClaimCandidate): Promise<void> => {
    if (!savedRunId || !link) return
    const gen = link.gen
    const runId = savedRunId
    setReviewBusy(c.id)
    try {
      const rv = review[c.id]
      const r = await claimFinderStore.addReview({ runId, candidateId: c.id, statusOverride: rv?.status ?? c.status, note: rv?.note ?? null })
      // ★ 스테일 완료 폐기: 대기 중 scope 가 바뀌었으면(다른 고객/결과) 반영 금지.
      if (!resultGuard.current.isCurrent(gen)) return
      if (r.ok) dispatch({ type: 'SET_NOTICE', notice: `검토 저장됨(${c.coverageName}).` })
      else dispatch({ type: 'SET_ERROR', error: (r.disabled ? '' : '검토 저장 실패: ') + (r.error ?? '') })
    } finally {
      if (resultGuard.current.isCurrent(gen)) setReviewBusy(null)
    }
  }

  const candidates = result?.candidates ?? []
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of candidates) m[c.status] = (m[c.status] ?? 0) + 1
    return m
  }, [candidates])
  const shown = filter === 'ALL' ? candidates : candidates.filter((c) => c.status === filter)
  const sum = useMemo(() => sumConfirmedAmounts(candidates), [candidates])

  // 저장 이력: 실데이터만, 현재 고객+동의 scope 로 표시(DEMO 는 운영 UI 에서 제외 — 서버 조회에서도 제외됨).
  const customerSaved = useMemo(
    () => (customer && consent ? savedRuns.filter((r) => !r.isDemo && r.customerId === customer.id) : []),
    [savedRuns, customer, consent]
  )

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="rounded-2xl border border-slate-800 bg-[#0e1e3a] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Compass className="h-4 w-4 text-[#e6c877]" />
          <h1 className="text-sm font-extrabold text-white">보험금 발굴 (검토 지원)</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">진료기록 × 보장분석 × 약관 · 규칙 {CLAIM_RULES_VERSION}</span>
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
          <select value={customer?.id ?? ''} onChange={(e) => selectCustomer(e.target.value)} data-testid="customer-select"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]">
            <option value="">— 고객 선택 —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>
            ))}
          </select>
          <label className="mt-3 flex items-start gap-2 text-[12px] text-slate-200">
            <input type="checkbox" checked={consent} onChange={(e) => onConsent(e.target.checked)} className="mt-0.5" data-testid="consent" />
            <span>고객 동의 확인 — 본 고객의 진료기록·보장자료 대조 분석에 동의받았음. <span className="text-slate-500">(동의 없이는 분석 불가. 동의를 해제하면 표시된 결과·검토메모가 즉시 제거됩니다. 서버에서도 소유권·동의를 검증합니다.)</span></span>
          </label>
        </div>

        {/* ② 자료 연결 */}
        <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-100">② 자료 연결</h2>
          <div className="mt-2 flex gap-1.5 text-[11px]">
            <Chip active={source === 'record'} onClick={() => { setSource('record'); invalidateResult() }}>저장된 진료기록</Chip>
            <Chip active={source === 'upload'} onClick={() => { setSource('upload'); invalidateResult() }}>업로드 원본(검토용)</Chip>
          </div>
          {source === 'record' ? (
            <>
              <label className="mt-2 block text-[11px] font-semibold text-slate-400">진료기록(건강기록 조회 결과)</label>
              <select value={recordId} onChange={(e) => { setRecordId(e.target.value); invalidateResult() }} disabled={!customer} data-testid="record-select"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f] disabled:opacity-50">
                <option value="">{customer ? (records.length ? '— 진료기록 선택 —' : '완료된 진료기록 없음(건강기록 조회에서 먼저 조회)') : '먼저 고객 선택'}</option>
                {records.map((r) => (
                  <option key={r.id} value={r.id}>{r.product} · {new Date(r.createdAt).toLocaleDateString('ko-KR')}</option>
                ))}
              </select>
            </>
          ) : (
            <IngestControls
              busy={ingestBusy}
              result={ingestResult}
              confirmed={ingestConfirmed}
              onFile={onIngestFile}
              onConfirm={setIngestConfirmed}
            />
          )}
          <label className="mt-2 block text-[11px] font-semibold text-slate-400">보장분석(KB 등 보유 담보) <span className="text-slate-500">· 선택</span></label>
          <select value={analysisId} onChange={(e) => { setAnalysisId(e.target.value); setAnalysisConfirmed(false); invalidateResult() }} data-testid="analysis-select"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]">
            <option value="">— 미연결(약관/서류 필요로 표시) —</option>
            {custAnalyses.map((a) => (
              <option key={a.id} value={a.id}>{a.customerName || '무제'} · {new Date(a.updatedAt).toLocaleDateString('ko-KR')}</option>
            ))}
          </select>
          {analysisId ? (
            <label className="mt-1.5 flex items-start gap-2 text-[11px] text-slate-200">
              <input type="checkbox" checked={analysisConfirmed} onChange={(e) => setAnalysisConfirmed(e.target.checked)} className="mt-0.5" data-testid="analysis-confirm" />
              <span>이 보장분석이 <b>현재 고객</b>의 것임을 확인했습니다. <span className="text-slate-500">(보장분석에는 안정적 고객 ID가 없어 자동 연결하지 않습니다 — 동명이인·무명 자료 혼입 방지.)</span></span>
            </label>
          ) : null}
          <p className="mt-1 text-[10px] text-slate-500">약관 보관함 {terms.length}건 연결 대기 — 담보명이 일치하면 조항·버전이 자동 연결됩니다.</p>
        </div>
      </div>

      {/* ③ 실행 */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onAnalyze} disabled={Boolean(busy)} data-testid="analyze"
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0e1e3a] px-4 py-2.5 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />} 대조·분석 실행
        </button>
      </div>

      {notice ? <div className="rounded-xl border border-slate-800 bg-white px-4 py-2.5 text-[12px] font-semibold text-emerald-700" data-testid="notice">{notice}</div> : null}
      {error ? <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-[12px] font-semibold text-rose-700" data-testid="error">{error}</div> : null}

      {/* 저장된 분석 이력 — 불러오기(결과·검토 복원). 현재 고객(동의 시) 실데이터만 표시. */}
      {persistenceConfigured ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm" data-testid="history">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-slate-100">저장된 분석 이력</h2>
            <span className="text-[10px] text-slate-500">사용자 세션(JWT)·RLS 로 본인/관리자 것만 표시</span>
            <button type="button" onClick={refreshSavedRuns} disabled={listBusy} data-testid="history-refresh"
              className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-200 disabled:opacity-50">
              {listBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}새로고침
            </button>
          </div>
          {listError ? <p className="mt-1 text-[11px] text-rose-700">{listError}</p> : null}

          <div className="mt-2">
            <div className="text-[11px] font-semibold text-slate-400">현재 고객 {customer ? `· ${customer.name}` : ''}</div>
            {!customer || !consent ? (
              <p className="mt-1 text-[11px] text-slate-500">고객 선택 + 동의 확인 시 해당 고객의 저장 분석이 표시됩니다.</p>
            ) : customerSaved.length === 0 ? (
              <p className="mt-1 text-[11px] text-slate-500">저장된 분석이 없습니다.</p>
            ) : (
              <ul className="mt-1 space-y-1" data-testid="history-customer-list">
                {customerSaved.map((r) => (
                  <SavedRunRow key={r.id} r={r} busy={loadBusyId === r.id} active={savedRunId === r.id} onLoad={() => loadRun(r)} />
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {/* ④ 결과 */}
      {result ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm" data-testid="result">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-100">④ 검토 결과</h2>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500">규칙 {result.rulesVersion} · {new Date(result.generatedAt).toLocaleString('ko-KR')}</span>
              {savable ? (
                <button type="button" onClick={() => void onSave()} disabled={saveBusy || Boolean(savedRunId)} data-testid="save"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-200 disabled:opacity-50">
                  {saveBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {savedRunId ? '저장됨' : '서버에 저장'}
                </button>
              ) : null}
            </div>
          </div>

          {!persistenceConfigured ? (
            <p className="mt-1 text-[10px] text-amber-700">저장 비활성: Supabase 미구성 또는 로그인 세션 없음. 현재는 화면에만 보관됩니다.</p>
          ) : null}
          {link?.kind === 'upload' ? (
            <p className="mt-1 text-[10px] text-slate-500">업로드 원본 분석은 서버 동의 앵커가 없어 저장할 수 없습니다(검토용). 저장하려면 "저장된 진료기록" 을 연결해 분석하세요.</p>
          ) : null}

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
                  canSaveReview={Boolean(savedRunId)}
                  reviewBusy={reviewBusy === c.id}
                  onSaveReview={() => void onSaveReview(c)}
                />
              ))
            )}
          </div>
          <p className="mt-3 text-[10px] text-slate-500">
            ※ 사람 검토(상태 수정·메모)는 화면에 즉시 반영됩니다. 서버 검토이력은 먼저 "서버에 저장" 후 후보별 "검토 저장" 으로 기록합니다(사용자 세션 JWT → RLS 가 소유권·동의·교차접근을 강제).
          </p>
        </div>
      ) : null}
    </div>
  )
}

/** 업로드 원본 점검 컨트롤(부모가 scope/세대 관리). */
function IngestControls({
  busy,
  result,
  confirmed,
  onFile,
  onConfirm
}: {
  busy: boolean
  result: IngestResult | null
  confirmed: boolean
  onFile: (f: File | undefined) => void | Promise<void>
  onConfirm: (v: boolean) => void
}): JSX.Element {
  return (
    <div className="mt-2">
      <p className="text-[11px] leading-relaxed text-slate-500">
        심평원 진료 <b>JSON</b> 또는 KB 보장분석 <b>PDF</b> 원본의 형식·크기를 검증하고, 원본 해시(provenance)·추출 가능 여부를 확인합니다.
        JSON 은 관측된 필드만 매핑(추측 안 함), PDF 는 <b>자동 담보 추출 안 함</b>(페이지 원문만, 사람이 약관 대조·입력). 실포맷 정확도 미검증.
      </p>
      <input type="file" accept=".json,application/json,.pdf,application/pdf" data-testid="ingest-file"
        onChange={(e) => void onFile(e.target.files?.[0])}
        className="mt-2 block w-full text-[12px] text-slate-300 file:mr-3 file:rounded-lg file:border file:border-slate-700 file:bg-white file:px-3 file:py-1.5 file:text-[12px] file:font-bold file:text-slate-200" />
      {busy ? <p className="mt-2 text-[12px] text-slate-500"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />검증 중…</p> : null}
      {result ? (
        <div className={`mt-2 rounded-xl border px-3 py-2.5 text-[12px] ${result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`} data-testid="ingest-result">
          <div className="font-bold">{result.ok ? '검증 통과' : '검증 실패/확인 필요'} — {result.fileName} ({result.bytes.toLocaleString('ko-KR')}B)</div>
          <div className="mt-0.5 text-[11px]">
            종류: {result.kind ?? '미상'} {result.fileHash ? `· hash:${result.fileHash.slice(0, 12)}…` : ''}
            {result.kind === 'health_record_json' && result.events ? ` · 진료 이벤트 ${result.events.length}건` : ''}
            {result.kind === 'coverage_pdf' && result.pages ? ` · 페이지 ${result.pages.length}개(사람 확인 필요)` : ''}
          </div>
          {result.errors.length ? <ul className="mt-1 list-disc pl-5">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
          {result.warnings.length ? (
            <details className="mt-1 text-[11px]">
              <summary className="cursor-pointer font-semibold">경고 {result.warnings.length}건</summary>
              <ul className="mt-1 list-disc pl-5">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          ) : null}
          {result.ok && result.kind === 'health_record_json' ? (
            <label className="mt-1.5 flex items-start gap-2 text-[11px]">
              <input type="checkbox" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} className="mt-0.5" data-testid="ingest-confirm" />
              <span>이 업로드 자료가 <b>현재 고객</b>의 진료기록임을 확인했습니다(업로드엔 고객 식별자가 없어 수동 확인 필요).</span>
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function SavedRunRow({ r, busy, active, onLoad }: { r: SavedRunSummary; busy: boolean; active: boolean; onLoad: () => void }): JSX.Element {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px]">
      <span className="font-mono text-slate-400">{r.id.slice(0, 8)}…</span>
      <span className="text-slate-500">규칙 {r.rulesVersion || '?'}</span>
      <span className="text-slate-500">{r.createdAt ? new Date(r.createdAt).toLocaleString('ko-KR') : ''}</span>
      {active ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">현재 로드됨</span> : null}
      <button type="button" onClick={onLoad} disabled={busy || active} data-testid="history-load"
        className="ml-auto rounded border border-slate-700 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-200 disabled:opacity-50">
        {busy ? '불러오는 중…' : active ? '불러옴' : '불러오기'}
      </button>
    </li>
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
  onReview,
  canSaveReview,
  reviewBusy,
  onSaveReview
}: {
  c: ClaimCandidate
  review?: { status?: ClaimStatus; note?: string }
  onReview: (patch: { status?: ClaimStatus; note?: string }) => void
  canSaveReview: boolean
  reviewBusy: boolean
  onSaveReview: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const effStatus = review?.status ?? c.status
  return (
    <div className="rounded-xl border border-slate-800 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[effStatus]}`}>{STATUS_LABEL[effStatus]}</span>
        <span className="text-[13px] font-bold text-slate-100">{c.coverageName}</span>
        <span className="text-[11px] text-slate-500">{c.insurer} · {c.category}</span>
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
            <select value={review?.status ?? c.status} onChange={(e) => onReview({ status: e.target.value as ClaimStatus })} data-testid="review-status"
              className="rounded border border-slate-700 bg-white px-1.5 py-1 text-[11px] text-slate-100">
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            <input value={review?.note ?? ''} onChange={(e) => onReview({ note: e.target.value })} placeholder="검토 메모" data-testid="review-note"
              className="min-w-0 flex-1 rounded border border-slate-700 bg-white px-2 py-1 text-[11px] text-slate-100" />
            {canSaveReview ? (
              <button type="button" onClick={onSaveReview} disabled={reviewBusy}
                className="rounded border border-slate-700 bg-white px-2 py-1 text-[11px] font-bold text-slate-200 disabled:opacity-50">
                {reviewBusy ? '저장 중…' : '검토 저장'}
              </button>
            ) : (
              <span className="text-[10px] text-slate-500">검토 서버 저장은 "서버에 저장" 후 가능</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
