import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Printer, RefreshCw, Undo2 } from 'lucide-react'
import {
  buildCareRecords, CARE_PERIODS, careKpis, claimRecordKey, CLAIM_LABELS, localYmd, matchCareGuides,
  type CarePeriod, type CareRecord, type ClaimState, type HrUnderwritingContext, type SummaryKindFilter
} from '@renderer/services/health-record/careWorkspace'
import { healthClaimStore, type ClaimChecks } from '@renderer/services/health-record/claimStateStore'
import { printCareRecords } from '@renderer/services/health-record/printCareRecords'
import { listUnderwriting, UNDERWRITING_INSURERS, UNDERWRITING_STATUS_LABEL, type UnderwritingDisease, type UnderwritingStatus } from '@renderer/services/underwriting/underwritingService'
import { ClaimRow, CLAIM_GRID, CLAIM_VIEW_LABELS } from './ClaimRecordList'
import { claimCounts, CLAIM_SAVE_LIMIT, createUndoToken, runClaimUndo, type ClaimUndoToken } from '@renderer/services/health-record/claimUndo'
import { listExceptions, type ExceptionRule } from '@renderer/services/underwriting/exceptionDiseaseService'
import { guideLoadStatus, type GuideLoadStatus } from '@renderer/services/health-record/guideLoadState'

const controlBase = 'min-h-11 rounded-lg border px-3 text-[13px] font-bold disabled:opacity-40'
const control = `${controlBase} border-slate-700 bg-white text-slate-200`
const dateLabel = (s: string): string => s.length === 8 ? `${s.slice(0,4)}.${s.slice(4,6)}.${s.slice(6)}` : '날짜 미확인'
interface Props {
  result: Record<string, unknown>
  requestId?: string
  period: CarePeriod
  /** 결과 탭별 표시 영역. 한 번만 마운트되고 표시만 바뀌므로 청구 상태·검색·선택·기준 조회 상태가 탭 전환에 유지된다. */
  mode: 'summary' | 'claims' | 'review'
  onContextChange: (context: HrUnderwritingContext) => void
  /** 기준 조회 상태(표시용 메타데이터). AI 패널이 기준 미확인·부분 실패를 안내하는 데만 쓴다. */
  onGuideStatusChange?: (status: GuideLoadStatus) => void
  /** 한눈에 요약 숫자 카드 바로가기(목록 표시 필터). 숫자 자체는 항상 선택 기간 전체 기록으로 계산한다. */
  summaryFilter?: SummaryKindFilter
  onSummaryFilterChange?: (filter: SummaryKindFilter) => void
}

export default function HealthRecordWorkspace({ result, requestId, period, mode, onContextChange, onGuideStatusChange, summaryFilter = 'all', onSummaryFilterChange }: Props): JSX.Element {
  const rows = useMemo(() => buildCareRecords(result), [result])
  const [states, setStates] = useState<ClaimChecks>({})
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<ClaimState | 'all'>('all')
  const [kind, setKind] = useState('all')
  const [query, setQuery] = useState('')
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  // 저장·되돌리기 진행 표시. 실제 재진입 차단은 lock ref가 맡는다(더블클릭 등 같은 틱 중복 호출).
  const [busy, setBusy] = useState<null | 'save' | 'undo'>(null)
  const saving = busy !== null
  const lock = useRef<object | null>(null)
  // 마지막 성공한 표시 변경 1건만 되돌릴 수 있다. 메모리에만 두며 요청·고객·기간 전환·새로고침·새 저장 시 폐기.
  const [undo, setUndo] = useState<ClaimUndoToken | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const scope = useRef(0)
  useEffect(() => {
    const generation = ++scope.current
    setReady(false); setStates({}); setKeys({}); setSelected(new Set()); setExpanded(new Set()); setFilter('all'); setError(''); setNotice(''); setBusy(null); setUndo(null)
    // 이전 범위의 저장·복원 잠금을 풀되, 그 요청의 늦은 finally는 새 잠금을 건드리지 못한다(release는 자기 토큰만).
    lock.current = null
    if (!requestId) { setLoading(false); return }
    setLoading(true)
    void Promise.all([Promise.all(rows.map(async row => [row.key, await claimRecordKey(row)] as const)), healthClaimStore.load(requestId)])
      .then(([entries, saved]) => {
        if (scope.current !== generation) return
        setKeys(Object.fromEntries(entries))
        if (!saved.ok) setError(saved.error ?? '청구 상태를 불러오지 못했습니다.')
        else { setStates(saved.states ?? {}); setReady(true) }
      }).catch(() => { if (scope.current === generation) setError('청구 상태를 준비하지 못했습니다. 서버 연결과 브라우저 보안 연결을 확인하세요.') })
      .finally(() => { if (scope.current === generation) setLoading(false) })
    return () => { ++scope.current }
  }, [requestId, rows, revision])
  // 저장된 states에 없는 키는 성공 조회(ready) 후에만 '확인 필요'(unknown)로 본다. 준비 전에는 건수를 집계하지 않는다.
  const statusOf = (row: CareRecord): ClaimState => states[keys[row.key]]?.status ?? 'unknown'
  const q = query.trim().toLowerCase()
  // 상태 버튼 건수·'미청구 출력'의 기반 목록 — 기간(rows)·검색·진료 유형만 적용하고 상태 필터는 제외한다.
  const base = rows.filter(r => (kind === 'all' || (kind === '수술' ? r.surgery : r.kind === kind))
    && `${r.hospital} ${r.disease} ${r.code} ${r.medications.map(m=>m.name).join(' ')}`.toLowerCase().includes(q))
  const statusFilter: ClaimState | 'all' = ready ? filter : 'all'
  const visible = statusFilter === 'all' ? base : base.filter(r => statusOf(r) === statusFilter)
  const counts = claimCounts(base, statusOf, ready)
  const unclaimedRows = ready ? base.filter(r => statusOf(r) === 'unclaimed') : []
  // Changing a filter never makes hidden selected rows eligible for a bulk update.
  const visibleSelected = visible.filter(r => selected.has(r.key))
  const acquire = (): object | null => { if (lock.current) return null; const held = {}; lock.current = held; return held }
  const release = (held: object): void => { if (lock.current === held) lock.current = null }
  const save = async (status: ClaimState): Promise<void> => {
    if (!requestId || !ready || loading || !visibleSelected.length || visibleSelected.length > CLAIM_SAVE_LIMIT) return
    const recordKeys = visibleSelected.map(r => keys[r.key])
    if (recordKeys.some(k => !k)) return
    const held = acquire()
    if (!held) return
    const generation = scope.current, before = states, count = visibleSelected.length
    setBusy('save'); setError(''); setNotice(''); setUndo(null)
    try {
      const reply = await healthClaimStore.save(requestId, recordKeys, status)
      if (scope.current !== generation) return
      if (!reply.ok || !reply.states) { setError(reply.error ?? '저장에 실패했습니다.'); return }
      // 성공 응답을 확인한 뒤에만 되돌리기를 만든다(실제로 상태가 바뀐 키만 대상).
      const token = createUndoToken({ requestId, scope: generation, status, keys: recordKeys, before, reply: reply.states })
      setStates(reply.states); setSelected(new Set()); setUndo(token)
      setNotice(token ? `${count}건을 ‘${CLAIM_VIEW_LABELS[status]}’(으)로 표시했습니다.` : `선택한 ${count}건은 이미 ‘${CLAIM_VIEW_LABELS[status]}’ 상태입니다.`)
    } catch { if (scope.current === generation) setError('저장에 실패했습니다.') }
    finally { release(held); if (scope.current === generation) setBusy(null) }
  }
  const undoLast = async (): Promise<void> => {
    const token = undo
    if (!token || !requestId || !ready || loading) return
    if (token.requestId !== requestId || token.scope !== scope.current) { setUndo(null); return }
    const held = acquire()
    if (!held) return
    const generation = scope.current
    const isCurrent = (): boolean => scope.current === generation
    // 한 번만 쓸 수 있다 — 결과와 무관하게 이 토큰은 폐기한다.
    setBusy('undo'); setError(''); setNotice(''); setUndo(null)
    try {
      const outcome = await runClaimUndo(token, { load: healthClaimStore.load, save: healthClaimStore.save, isCurrent })
      if (!isCurrent() || outcome.kind === 'aborted') return
      if (outcome.kind === 'done') { setStates(outcome.states); setNotice(`${outcome.restored}건을 이전 상태로 되돌렸습니다.`); return }
      if (outcome.kind === 'conflict') { setStates(outcome.states); setError(`표시한 뒤 다른 변경(${outcome.changed}건)이 있어 되돌리지 않았습니다. 최신 상태를 다시 불러왔으니 확인 후 다시 표시하세요.`); return }
      // 복원 직전 조회 실패 — 쓰기는 보내지 않았지만 현재 서버 상태를 모르므로 기존 값을 확정 표시하지 않도록 잠근다.
      if (outcome.kind === 'load-failed') { setReady(false); setStates({}); setSelected(new Set()); setError('현재 상태를 확인하지 못해 되돌리지 않았습니다. 상태 표시를 잠갔습니다. ‘다시 불러오기’를 누르세요.'); return }
      // 부분 실패 — 이미 되돌린 묶음은 유지하고 자동 재시도하지 않는다. 실제 상태를 다시 조회한다.
      // 실패한 묶음은 응답만 확인하지 못했을 뿐 서버에서는 반영됐을 수 있으므로 '되돌리지 못했다'고 단정하지 않는다.
      const head = `${outcome.restored}건은 복원 응답을 확인했고, 나머지 ${outcome.remaining}건은 결과 확인이 필요합니다.`
      let fresh: { ok: boolean; states?: ClaimChecks }
      try { fresh = await healthClaimStore.load(requestId) } catch { fresh = { ok: false } }
      if (!isCurrent()) return
      if (fresh.ok && fresh.states) { setStates(fresh.states); setError(`${head} 실제 상태를 다시 불러왔습니다. 확인 후 필요한 기록만 다시 표시하세요.`) }
      // 재조회까지 실패하면 미확인 상태를 확정 표시하지 않도록 잠근다(다시 불러오기 버튼 노출).
      else { setReady(false); setStates({}); setSelected(new Set()); setError(`${head} 실제 상태도 불러오지 못해 상태 표시를 잠갔습니다. ‘다시 불러오기’를 누르세요.`) }
    } catch { if (isCurrent()) { setReady(false); setStates({}); setSelected(new Set()); setError('되돌리기 결과를 확인하지 못했습니다. ‘다시 불러오기’를 누르세요.') } }
    finally { release(held); if (isCurrent()) setBusy(null) }
  }

  const [insurers, setInsurers] = useState<string[]>(['삼성화재'])
  const [guides, setGuides] = useState<UnderwritingDisease[]>([])
  const [exceptions, setExceptions] = useState<ExceptionRule[]>([])
  const [guideBusy, setGuideBusy] = useState(false)
  const [guideError, setGuideError] = useState('')
  // 두 소스의 응답 ok 값을 각각 기록한다(null = 미조회). 실패 종류를 추측하지 않고 표시하기 위한 UI 메타데이터.
  const [guideMeta, setGuideMeta] = useState<{ underwritingOk: boolean | null; exceptionOk: boolean | null }>({ underwritingOk: null, exceptionOk: null })
  const guideStatus = guideLoadStatus({ busy: guideBusy, ...guideMeta })
  const [pickerOpen, setPickerOpen] = useState(false)
  // 펼침 상태는 보험사명에 귀속 — 다른 카드 선택 변경으로 펼침이 옮겨가지 않는다.
  const [openCards, setOpenCards] = useState<Set<string>>(new Set())
  const reviewId = useId()
  const context = useMemo(() => matchCareGuides(rows, guides, exceptions, insurers), [rows, guides, exceptions, insurers])
  useEffect(() => { onContextChange(context) }, [context, onContextChange])
  useEffect(() => { onGuideStatusChange?.(guideStatus) }, [guideStatus, onGuideStatusChange])
  const loadGuides = async (): Promise<void> => {
    setGuideBusy(true); setGuideError('')
    try {
      const [g, e] = await Promise.all([listUnderwriting(), listExceptions()])
      setGuides(g.ok ? g.items : []); setExceptions(e.ok ? e.data : []); setGuideMeta({ underwritingOk: g.ok, exceptionOk: e.ok })
      if (!g.ok || !e.ok) setGuideError([!g.ok ? g.error : '', !e.ok ? e.message : ''].filter(Boolean).join(' / '))
    } catch { setGuideError('인수 기준을 불러오지 못했습니다.'); setGuideMeta({ underwritingOk: false, exceptionOk: false }); setGuides([]); setExceptions([]) }
    finally { setGuideBusy(false) }
  }
  const periodLabel = CARE_PERIODS.find(p=>p.value===period)?.label
  const exportList = (): void => {
    if (!visible.length) return
    if (!printCareRecords(visible, statusOf, `${periodLabel} · ${ready?(statusFilter==='all'?'전체 상태':CLAIM_LABELS[statusFilter]):'청구 상태 미조회'} · 기준일 ${dateLabel(localYmd())}`)) setError('출력 창을 열지 못했습니다. 팝업 허용 여부를 확인하세요.')
  }
  // 미청구 바로가기 — 상태 필터·체크 선택과 무관하게 현재 기간·검색·유형 범위의 미청구만 출력한다.
  const exportUnclaimed = (): void => {
    if (!ready || saving || loading || !unclaimedRows.length) return
    if (!printCareRecords(unclaimedRows, statusOf, `${periodLabel} · 미청구만 · 기준일 ${dateLabel(localYmd())}`)) setError('출력 창을 열지 못했습니다. 팝업 허용 여부를 확인하세요.')
  }
  if (mode === 'summary') {
    // 핵심 숫자 3개 — 아래 최근 진료 목록과 같은 기간·같은 기록(rows)으로 계산. 미청구 수는 청구 관리 탭에만 둔다.
    const k = careKpis(rows)
    // 기록 0건이면 입원·수술을 0으로 단정하지 않고 '-'로 둔다(기록 없음 ≠ 입원·수술 없음).
    const none = k.records === 0
    const admissionValue = k.admissionKnownDays > 0 ? `약 ${k.admissionKnownDays}일` : k.admissionUnknown ? '확인 필요' : (none ? '-' : '0일')
    // 카드는 아래 최근 진료 목록의 바로가기 — 누르면 목록만 좁힌다(숫자·기간·다른 탭 데이터는 그대로). 0건이어도 누를 수 있다.
    const kpis: [string, string, string, SummaryKindFilter][] = [
      ['진료기록', `${k.records}건`, '', 'all'],
      ['입원일수', admissionValue, k.admissionUnknown ? `일수 미확인 ${k.admissionUnknown}건` : '', 'inpatient'],
      ['수술 추정', none ? '-' : `${k.surgeries}회`, '', 'surgery']
    ]
    const pick = (f: SummaryKindFilter): void => onSummaryFilterChange?.(f === summaryFilter ? 'all' : f)
    return (
      <section className="mt-3 grid grid-cols-3 gap-2" aria-label="핵심 숫자 · 누르면 최근 진료 목록을 바로 봅니다">
        {kpis.map(([label, value, sub, f]) => {
          const on = summaryFilter === f
          return (
            <button key={label} type="button" aria-pressed={on} onClick={() => pick(f)} data-kpi={label} disabled={!onSummaryFilterChange}
              className={`min-w-0 rounded-xl border px-2.5 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c6982f] sm:px-3 ${on ? 'border-[#c6982f] bg-[#fdf7ea] ring-1 ring-[#c6982f]' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}>
              <span className="flex items-center justify-between gap-1 text-[12px] font-semibold text-slate-400 sm:text-[13px]">
                <span className="min-w-0 break-words">{label}</span>
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${on ? 'text-[#7a5c14]' : 'text-slate-500'}`} aria-hidden="true" />
              </span>
              <strong className="mt-0.5 block break-words text-[19px] leading-tight text-[#0e1e3a] sm:text-[22px]">{value}</strong>
              {sub ? <span className="mt-0.5 block text-[12px] text-amber-700">{sub}</span> : null}
            </button>
          )
        })}
      </section>
    )
  }

  if (mode === 'review') {
    // 현재 선택 보험사도 포함 — 예외 기준 조회 실패로 확장 보험사가 목록에서 사라져 해제 불가가 되지 않게 한다.
    const insurerOptions = [...new Set([...UNDERWRITING_INSURERS, ...exceptions.map(e => e.insurer), ...insurers])]
    const pickerId = `${reviewId}-insurers`
    const guideLoading = guideStatus === 'loading'
    const sourceText = (ok: boolean | null, count: number): string => guideLoading ? '조회 중' : ok === null ? '미조회' : ok ? `${count}건` : '조회 실패'
    const toggleCard = (insurer: string): void => setOpenCards(prev => { const next = new Set(prev); if (next.has(insurer)) next.delete(insurer); else next.add(insurer); return next })
    const statusLine: Record<GuideLoadStatus, string> = {
      idle: '아직 기준을 확인하지 않았습니다. 버튼을 눌러 등록된 기준을 불러오세요.',
      loading: '등록 기준을 조회하는 중입니다…',
      ok: `조회 완료 · 일치한 인수 기준 ${context.guides.length}건 · 예외 기준 ${context.exceptions.length}건${context.guides.length + context.exceptions.length === 0 ? ' — 일치 0건은 가입 가능을 뜻하지 않습니다.' : ''}`,
      partial: `일부 조회 실패 (${guideMeta.underwritingOk ? '' : '인수 가이드'}${guideMeta.exceptionOk ? '' : '예외질환'}). 성공한 자료만 참고로 표시합니다. 다시 시도하세요.`,
      failed: '기준을 불러오지 못했습니다. 다시 시도하세요.'
    }
    return (
      <section className="mt-3 space-y-3 rounded-xl border border-slate-800 bg-white p-3" aria-label="가입 검토 기준">
        {/* 1. 보험사 선택 — 요약을 먼저 보여주고 목록은 펼쳐서 바꾼다. */}
        <div className="space-y-2">
          <h3 className="text-[14px] font-bold text-slate-100">1. 보험사 선택</h3>
          {insurers.length
            ? <p className="break-words text-[13px] text-slate-200"><span className="font-bold text-[#0e1e3a]">{insurers.length}곳</span> · {insurers.join(', ')}</p>
            : <p role="status" className="text-[13px] font-semibold text-amber-800">선택한 보험사가 없습니다. ‘보험사 선택 변경’을 눌러 확인할 보험사를 고르세요.</p>}
          <button type="button" aria-expanded={pickerOpen} aria-controls={pickerId} onClick={() => setPickerOpen(o => !o)} className={`${control} inline-flex items-center gap-1`}>
            <ChevronDown className={`h-4 w-4 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} aria-hidden="true" />보험사 선택 변경
          </button>
          {/* display는 클래스로 직접 제어 — hidden 속성만 두면 Tailwind .flex가 [hidden]을 덮어 닫혀도 보인다. */}
          <div id={pickerId} hidden={!pickerOpen} className={`${pickerOpen ? 'flex' : 'hidden'} flex-wrap gap-x-4 gap-y-1 rounded-lg border border-slate-800 bg-slate-950 p-2`}>
            {insurerOptions.map(i => <label key={i} className="inline-flex min-h-11 min-w-0 items-center gap-2 break-words text-[13px] text-slate-200"><input type="checkbox" className="h-5 w-5 shrink-0" checked={insurers.includes(i)} onChange={e => setInsurers(prev => e.target.checked ? [...prev, i] : prev.filter(s => s !== i))} />{i}</label>)}
          </div>
        </div>

        {/* 2. 등록 기준 확인 — 버튼을 눌러야만 조회한다. 상태는 두 소스의 응답 ok 값으로 표시한다. */}
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <h3 className="text-[14px] font-bold text-slate-100">2. 등록 기준 확인</h3>
          <button type="button" disabled={guideLoading} onClick={() => void loadGuides()} className={`${controlBase} inline-flex w-full items-center justify-center gap-1 border-[#0e1e3a] bg-[#0e1e3a] text-white sm:w-auto`}>
            {guideLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4 text-[#e6c877]" aria-hidden="true" />}
            {guideLoading ? '기준 조회 중…' : guideStatus === 'idle' ? '등록된 인수·예외 기준 확인하기' : guideStatus === 'ok' ? '기준 다시 확인' : '다시 시도'}
          </button>
          <p role={guideStatus === 'partial' || guideStatus === 'failed' ? 'alert' : 'status'}
            className={`text-[13px] ${guideStatus === 'partial' || guideStatus === 'failed' ? 'font-semibold text-rose-700' : guideStatus === 'ok' ? 'text-[#0e1e3a]' : 'text-slate-500'}`}>
            {statusLine[guideStatus]}
          </p>
          {guideError && !guideLoading ? <p className="break-words text-[12px] text-rose-700">상세: {guideError}</p> : null}
          {insurers.length ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {insurers.map((ins, idx) => {
                const gs = context.guides.filter(g => g.insurer === ins)
                const es = context.exceptions.filter(e => e.insurer === ins)
                const all = [...gs.map(g => g.verified), ...es.map(e => e.verified)]
                const verified = all.filter(Boolean).length
                const showable = !guideLoading && guideStatus !== 'idle' && all.length > 0
                const open = showable && openCards.has(ins)
                const bodyId = `${reviewId}-card-${idx}`
                return (
                  <li key={ins} className="min-w-0 rounded-lg border border-slate-800 bg-slate-950 p-2.5">
                    <p className="break-words text-[13px] font-bold text-[#0e1e3a]">{ins}</p>
                    <p className="mt-0.5 text-[13px] text-slate-300">인수 기준 {sourceText(guideMeta.underwritingOk, gs.length)} · 예외 기준 {sourceText(guideMeta.exceptionOk, es.length)}</p>
                    {showable ? <p className="text-[12px] text-slate-500">검수됨 {verified}건 · 검수 전 {all.length - verified}건 (등록 참고 기준)</p> : null}
                    {showable ? (
                      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => toggleCard(ins)} className={`${control} mt-1 inline-flex items-center gap-1`}>
                        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />세부 조건 {open ? '접기' : '보기'}
                      </button>
                    ) : null}
                    <ul id={bodyId} hidden={!open} className={`${open ? 'block' : 'hidden'} mt-2 space-y-1`}>
                      {gs.map((g, i) => <li key={`g${i}`} className="break-words rounded-lg bg-white p-2 text-[12px] text-slate-300"><b>{g.disease}</b> — 등록 기준(참고): {UNDERWRITING_STATUS_LABEL[g.status as UnderwritingStatus] ?? '추가 확인'} · {g.verified ? '검수됨' : '검수 전'}<p className="mt-1 text-slate-500">{g.note || '세부 조건 미입력'} · 상품명·기준일 미제공</p></li>)}
                      {es.map(e => <li key={e.id} className="break-words rounded-lg bg-white p-2 text-[12px] text-slate-300"><b>{e.disease}</b> — 예외 기준 · 상품구분 {e.productClass || '미제공'} · {e.verified ? '검수됨' : '검수 전'}<p className="mt-1 text-slate-500">경과 {e.minElapsed || '확인 필요'} / 치료 {e.treatmentPeriod || '확인 필요'} / 수술 {e.surgery || '확인 필요'} · 자료 수정일 {e.updatedAt ? new Date(e.updatedAt).toLocaleDateString('ko-KR') : '미제공'}</p>{e.note ? <p className="mt-1">{e.note}</p> : null}</li>)}
                    </ul>
                  </li>
                )
              })}
            </ul>
          ) : null}
          <details className="rounded-lg border border-slate-800 px-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-bold text-slate-300">자료 기준 안내</summary>
            <ul className="list-disc space-y-1 pb-2 pl-5 text-[12px] leading-relaxed text-slate-400">
              <li>병명·별칭이 정확히 일치한 등록 기준만 연결합니다. 일치 0건·검수 전·미조회는 가입 가능 또는 불가를 뜻하지 않습니다.</li>
              <li>등록 기준(인수 가이드)에는 상품명·기준일이 없어 ‘미제공’으로 표시합니다.</li>
              <li>예외 기준의 날짜는 자료 수정일이며 공식 심사 기준일이 아닙니다.</li>
              <li>보험사 최종 심사·특정 상품 가입 가능 여부를 확정하지 않습니다.</li>
            </ul>
          </details>
        </div>
      </section>
    )
  }

  const allVisibleSelected = !!visible.length && visibleSelected.length === visible.length
  const someVisibleSelected = visibleSelected.length > 0 && !allVisibleSelected
  const resetSelection = (): void => setSelected(new Set())
  const toggleOpen = (key: string): void => setExpanded(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const loadFailed = !!requestId && !ready && !loading && !!error
  const tooMany = visibleSelected.length > CLAIM_SAVE_LIMIT
  const saveDisabled = !ready || saving || loading || !visibleSelected.length || tooMany
  const statusButtons: { value: ClaimState | 'all'; label: string; count: number | null }[] = [
    { value: 'all', label: '전체', count: counts ? counts.all : null },
    { value: 'unknown', label: CLAIM_VIEW_LABELS.unknown, count: counts ? counts.unknown : null },
    { value: 'unclaimed', label: CLAIM_VIEW_LABELS.unclaimed, count: counts ? counts.unclaimed : null },
    { value: 'claimed', label: CLAIM_VIEW_LABELS.claimed, count: counts ? counts.claimed : null }
  ]
  return (
    <section className="mt-3 space-y-3 rounded-xl border border-slate-800 bg-white p-3" aria-label="청구 관리">
      <p className="text-[13px] font-semibold text-slate-200">조회된 진료마다 보험 청구 여부를 직접 표시합니다. <span className="font-normal text-slate-500">(보험사 청구 내역 자동 조회 아님)</span></p>
      <details className="rounded-lg border border-slate-800 px-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-bold text-slate-300">이용 안내</summary>
        <ul className="list-disc space-y-1 pb-2 pl-5 text-[12px] leading-relaxed text-slate-400">
          <li>체크는 표시할 기록을 고르는 것뿐입니다. ‘청구 완료로 표시’ 등 버튼을 눌러야 저장되며 한 번에 {CLAIM_SAVE_LIMIT}건까지 표시할 수 있습니다.</li>
          <li>표시는 이 조회 건에만 남기는 직접 기록입니다. 보험사 접수·지급 내역을 불러오거나 대조하지 않으며 보장(담보)별 지급 완료를 뜻하지 않습니다.</li>
          <li>‘확인 필요’는 아직 표시하지 않은 기록이며 미청구라는 뜻이 아닙니다.</li>
          <li>‘현재 목록 출력’은 지금 보이는 목록 전체, ‘미청구 출력’은 기간·검색·유형 범위의 미청구만 출력합니다. 체크 선택은 출력 범위를 바꾸지 않습니다.</li>
          <li>‘되돌리기’는 마지막 표시 변경 1회만 가능합니다. 그 사이 다른 변경이 확인되면 되돌리지 않습니다. 표시한 적 없던 기록은 ‘확인 필요’로 돌아가며 표시한 날은 새로 기록됩니다.</li>
          <li>처방약·수술은 진료일·병원 일치로 추정한 것이며 독감약 표시는 지급 확정이 아닙니다.</li>
        </ul>
      </details>
      {!requestId ? <p className="rounded-lg bg-amber-50 p-2 text-[13px] text-amber-800">청구 여부 표시는 아래 ‘최근 요청’에서 완료된 결과를 선택한 후 사용할 수 있습니다.</p> : null}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input aria-label="건강기록 검색" placeholder="병원 · 병명 · 코드 · 약 이름 검색" value={query} onChange={e=>{setQuery(e.target.value);resetSelection()}} className="min-h-11 w-full min-w-0 rounded-lg border border-slate-700 bg-white px-3 text-[14px] text-slate-100" />
        <select aria-label="진료 유형 필터" value={kind} onChange={e=>{setKind(e.target.value);resetSelection()}} className={control}><option value="all">모든 유형</option>{['입원','통원','수술','확인 필요'].map(s=><option key={s}>{s}</option>)}</select>
      </div>
      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="청구 상태로 보기">
        {statusButtons.map(b => {
          const pressed = statusFilter === b.value
          return (
            <button key={b.value} type="button" aria-pressed={pressed} disabled={!ready} data-claim-filter={b.value}
              onClick={()=>{setFilter(b.value);resetSelection()}}
              className={`min-h-12 min-w-0 rounded-lg border px-1 py-1 text-center disabled:opacity-50 ${pressed ? 'border-[#0e1e3a] bg-[#0e1e3a] text-white' : 'border-slate-700 bg-white text-slate-200'}`}>
              <span className="block break-keep text-[12px] font-semibold leading-tight">{b.label}</span>
              <strong className="block text-[16px] leading-tight">{b.count == null ? '-' : b.count}</strong>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={exportUnclaimed} disabled={!ready || saving || loading || !unclaimedRows.length} className={`${controlBase} border-orange-700 bg-white text-orange-800`}><Printer className="mr-1 inline h-4 w-4"/>미청구 {ready ? unclaimedRows.length : '-'}건 출력</button>
        <button type="button" onClick={exportList} disabled={!visible.length || loading} className={`${controlBase} border-[#0e1e3a] bg-white text-[#0e1e3a]`}><Printer className="mr-1 inline h-4 w-4"/>현재 목록 {visible.length}건 출력</button>
        <button type="button" onClick={()=>setRevision(n=>n+1)} disabled={!requestId || loading || saving} className={`${controlBase} border-transparent bg-white text-slate-300`}><RefreshCw className="mr-1 inline h-4 w-4"/>상태 새로고침</button>
      </div>
      {loading?<p role="status" className="flex items-center gap-1 text-[13px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin"/>저장된 청구 상태를 확인하는 중… (확인 전에는 표시할 수 없습니다)</p>:null}
      {busy === 'undo'?<p role="status" className="flex items-center gap-1 text-[13px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin"/>이전 상태로 되돌리는 중…</p>:null}
      {error?<div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 p-2 text-[13px] text-rose-700"><span className="min-w-0 flex-1">{error}</span>{loadFailed?<button type="button" onClick={()=>setRevision(n=>n+1)} className={`${controlBase} border-rose-600 bg-white text-rose-700`}>다시 불러오기</button>:null}</div>:null}
      {notice || undo ? (
        <div role="status" className="flex flex-wrap items-center gap-2 text-[13px] text-emerald-700">
          <span className="min-w-0 flex-1">{notice}</span>
          {undo ? <button type="button" onClick={()=>void undoLast()} disabled={!ready || loading || saving} className={`${controlBase} inline-flex items-center gap-1 border-slate-700 bg-white text-slate-200`}><Undo2 className="h-4 w-4" aria-hidden="true"/>되돌리기</button> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1">
        <label className="inline-flex min-h-11 items-center gap-2 text-[13px] font-semibold text-slate-200">
          <input type="checkbox" className="h-5 w-5" aria-label="현재 목록 전체 대상 선택" disabled={!ready || !visible.length || saving}
            ref={el=>{ if (el) el.indeterminate = someVisibleSelected }} checked={allVisibleSelected}
            onChange={e=>setSelected(new Set(e.target.checked?visible.map(r=>r.key):[]))}/>
          전체 선택
        </label>
        {visibleSelected.length ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto" role="group" aria-label="선택한 기록 표시">
            <span className="text-[13px] font-bold text-[#0e1e3a]">선택 {visibleSelected.length}건</span>
            <button type="button" onClick={()=>void save('claimed')} disabled={saveDisabled} className="min-h-12 rounded-lg border border-[#0e1e3a] bg-[#0e1e3a] px-4 text-[14px] font-bold text-white disabled:opacity-40">{busy === 'save'?<Loader2 className="mr-1 inline h-4 w-4 animate-spin"/>:null}청구 완료로 표시</button>
            <details className="relative">
              <summary className={`${control} inline-flex cursor-pointer items-center gap-1 list-none`}><ChevronDown className="h-4 w-4" aria-hidden="true"/>다른 상태로 표시</summary>
              <div className="mt-1 flex flex-wrap gap-2">
                <button type="button" onClick={()=>void save('unclaimed')} disabled={saveDisabled} className={control}>미청구로 표시</button>
                <button type="button" onClick={()=>void save('unknown')} disabled={saveDisabled} className={control}>확인 필요로 표시</button>
              </div>
            </details>
            {tooMany?<span className="w-full text-[12px] text-rose-700">한 번에 {CLAIM_SAVE_LIMIT}건까지 표시할 수 있습니다. 검색·필터로 범위를 줄이세요.</span>:null}
          </div>
        ) : (
          <span className="text-[13px] text-slate-500">{requestId ? '체크는 대상 선택일 뿐 저장되지 않습니다.' : '완료된 요청을 선택하면 표시할 수 있습니다.'}</span>
        )}
      </div>
      <div className="max-h-[36rem] overflow-y-auto overflow-x-hidden rounded-lg border border-slate-800">
        <div className={`hidden border-b border-slate-800 bg-slate-950 px-3 py-1.5 text-[12px] font-semibold text-slate-400 sm:grid sm:items-center sm:gap-x-2 ${CLAIM_GRID}`} aria-hidden="true" data-claim-header>
          <span>선택</span><span>날짜</span><span>병원</span><span>병명</span><span>청구 상태</span><span />
        </div>
        <ul className="divide-y divide-slate-800">
          {visible.map(r=><ClaimRow key={r.key} r={r} status={statusOf(r)} ready={ready} checkedAt={states[keys[r.key]]?.checked_at} selected={selected.has(r.key)} selectDisabled={!ready || saving} open={expanded.has(r.key)} onToggle={()=>toggleOpen(r.key)}
            onSelect={checked=>setSelected(prev=>{const next=new Set(prev);if(checked)next.add(r.key);else next.delete(r.key);return next})}/>)}
        </ul>
        {!visible.length?<p className="p-5 text-center text-[13px] text-slate-500">조건에 맞는 기록이 없습니다.</p>:null}
      </div>
    </section>
  )
}
