import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, Loader2, Printer, RefreshCw } from 'lucide-react'
import {
  buildCareRecords, CARE_PERIODS, careKpis, claimRecordKey, CLAIM_LABELS, localYmd, matchCareGuides,
  type CarePeriod, type CareRecord, type ClaimState, type HrUnderwritingContext
} from '@renderer/services/health-record/careWorkspace'
import { healthClaimStore, type ClaimChecks } from '@renderer/services/health-record/claimStateStore'
import { printCareRecords } from '@renderer/services/health-record/printCareRecords'
import { listUnderwriting, UNDERWRITING_INSURERS, UNDERWRITING_STATUS_LABEL, type UnderwritingDisease, type UnderwritingStatus } from '@renderer/services/underwriting/underwritingService'
import { ClaimRow, CLAIM_GRID } from './ClaimRecordList'
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
}

export default function HealthRecordWorkspace({ result, requestId, period, mode, onContextChange, onGuideStatusChange }: Props): JSX.Element {
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const scope = useRef(0)
  useEffect(() => {
    const generation = ++scope.current
    setReady(false); setStates({}); setKeys({}); setSelected(new Set()); setExpanded(new Set()); setFilter('all'); setError(''); setNotice(''); setSaving(false)
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
  const statusOf = (row: CareRecord): ClaimState => states[keys[row.key]]?.status ?? 'unknown'
  const visible = rows.filter(r => (filter === 'all' || statusOf(r) === filter)
    && (kind === 'all' || (kind === '수술' ? r.surgery : r.kind === kind))
    && `${r.hospital} ${r.disease} ${r.code} ${r.medications.map(m=>m.name).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  // Changing a filter never makes hidden selected rows eligible for a bulk update.
  const visibleSelected = visible.filter(r => selected.has(r.key))
  const save = async (status: ClaimState): Promise<void> => {
    if (!requestId || !ready || saving || !visibleSelected.length) return
    const generation = scope.current
    setSaving(true); setError(''); setNotice('')
    try {
      const reply = await healthClaimStore.save(requestId, visibleSelected.map(r => keys[r.key]), status)
      if (scope.current !== generation) return
      if (!reply.ok) { setError(reply.error ?? '저장에 실패했습니다.'); return }
      setStates(reply.states ?? {}); setSelected(new Set()); setNotice(`${visibleSelected.length}건을 ${CLAIM_LABELS[status]} 상태로 저장했습니다.`)
    } finally { if (scope.current === generation) setSaving(false) }
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
  const exportList = (): void => {
    if (!visible.length) return
    if (!printCareRecords(visible, statusOf, `${CARE_PERIODS.find(p=>p.value===period)?.label} · ${ready?(filter==='all'?'전체 상태':CLAIM_LABELS[filter]):'청구 상태 미조회'} · 기준일 ${dateLabel(localYmd())}`)) setError('출력 창을 열지 못했습니다. 팝업 허용 여부를 확인하세요.')
  }
  if (mode === 'summary') {
    // 핵심 숫자 3개 — 아래 최근 진료 목록과 같은 기간·같은 기록(rows)으로 계산. 미청구 수는 청구 관리 탭에만 둔다.
    const k = careKpis(rows)
    // 기록 0건이면 입원·수술을 0으로 단정하지 않고 '-'로 둔다(기록 없음 ≠ 입원·수술 없음).
    const none = k.records === 0
    const admissionValue = k.admissionKnownDays > 0 ? `약 ${k.admissionKnownDays}일` : k.admissionUnknown ? '확인 필요' : (none ? '-' : '0일')
    const kpis: [string, string, string][] = [
      ['진료기록', `${k.records}건`, ''],
      ['입원일수', admissionValue, k.admissionUnknown ? `일수 미확인 ${k.admissionUnknown}건` : ''],
      ['수술 추정', none ? '-' : `${k.surgeries}회`, '']
    ]
    return (
      <section className="mt-3 grid grid-cols-3 gap-2" aria-label="핵심 숫자">
        {kpis.map(([label, value, sub]) => (
          <div key={label} className="min-w-0 rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-2.5 sm:px-3" data-kpi={label}>
            <div className="text-[12px] font-semibold text-slate-400 sm:text-[13px]">{label}</div>
            <strong className="mt-0.5 block break-words text-[19px] leading-tight text-[#0e1e3a] sm:text-[22px]">{value}</strong>
            {sub ? <div className="mt-0.5 text-[12px] text-amber-700">{sub}</div> : null}
          </div>
        ))}
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
  const tooMany = visibleSelected.length > 200
  const saveDisabled = !ready || saving || loading || !visibleSelected.length || tooMany
  return (
    <section className="mt-3 space-y-3 rounded-xl border border-slate-800 bg-white p-3" aria-label="청구 관리">
      {!requestId ? <p className="rounded-lg bg-amber-50 p-2 text-[13px] text-amber-800">청구 상태 저장은 아래 ‘최근 요청’에서 완료된 결과를 선택한 후 사용할 수 있습니다.</p> : null}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <input aria-label="건강기록 검색" placeholder="병원 · 상병 · 코드 · 약물 검색" value={query} onChange={e=>{setQuery(e.target.value);resetSelection()}} className="min-h-11 w-full min-w-0 rounded-lg border border-slate-700 bg-white px-3 text-[14px] text-slate-100" />
        <select aria-label="진료 유형 필터" value={kind} onChange={e=>{setKind(e.target.value);resetSelection()}} className={control}><option value="all">모든 유형</option>{['입원','통원','수술','확인 필요'].map(s=><option key={s}>{s}</option>)}</select>
        <select aria-label="청구 상태 필터" value={filter} disabled={!ready} onChange={e=>{setFilter(e.target.value as ClaimState|'all');resetSelection()}} className={control}><option value="all">전체 상태</option>{Object.entries(CLAIM_LABELS).map(([s,label])=><option key={s} value={s}>{label}</option>)}</select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={exportList} disabled={!visible.length || loading} className={`${controlBase} border-[#0e1e3a] bg-white text-[#0e1e3a]`}><Printer className="mr-1 inline h-4 w-4"/>현재 목록 {visible.length}건 인쇄 / PDF</button>
        <button type="button" onClick={()=>setRevision(n=>n+1)} disabled={!requestId || loading || saving} className={`${controlBase} border-transparent bg-white text-slate-300`}><RefreshCw className="mr-1 inline h-4 w-4"/>상태 새로고침</button>
        <p className="w-full text-[12px] text-slate-500">인쇄·PDF는 선택한 행이 아니라 지금 검색·필터로 보이는 목록 전체({visible.length}건)를 출력합니다.</p>
      </div>
      {loading?<p role="status" className="flex items-center gap-1 text-[13px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin"/>저장된 청구 상태를 확인하는 중… (확인 전에는 저장할 수 없습니다)</p>:null}
      {error?<div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 p-2 text-[13px] text-rose-700"><span className="min-w-0 flex-1">{error}</span>{loadFailed?<button type="button" onClick={()=>setRevision(n=>n+1)} className={`${controlBase} border-rose-600 bg-white text-rose-700`}>다시 불러오기</button>:null}</div>:null}
      {notice?<p role="status" className="text-[13px] text-emerald-700">{notice}</p>:null}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1">
        <label className="inline-flex min-h-11 items-center gap-2 text-[13px] font-semibold text-slate-200">
          <input type="checkbox" className="h-5 w-5" aria-label="현재 목록 전체 선택" disabled={!ready || !visible.length || saving}
            ref={el=>{ if (el) el.indeterminate = someVisibleSelected }} checked={allVisibleSelected}
            onChange={e=>setSelected(new Set(e.target.checked?visible.map(r=>r.key):[]))}/>
          현재 목록 전체 선택
        </label>
        {visibleSelected.length ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto" role="group" aria-label="선택한 기록 작업">
            <span className="text-[13px] font-bold text-[#0e1e3a]">선택 {visibleSelected.length}건</span>
            <button type="button" onClick={()=>void save('claimed')} disabled={saveDisabled} className={`${controlBase} border-[#0e1e3a] bg-[#0e1e3a] text-white`}>{saving?<Loader2 className="mr-1 inline h-4 w-4 animate-spin"/>:null}청구 완료로 저장</button>
            <button type="button" onClick={()=>void save('unclaimed')} disabled={saveDisabled} className={control}>미청구로 저장</button>
            <button type="button" onClick={()=>void save('unknown')} disabled={saveDisabled} className={control}>미확인으로 저장</button>
            {tooMany?<span className="w-full text-[12px] text-rose-700">한 번에 200건까지 저장할 수 있습니다. 검색·필터로 범위를 줄이세요.</span>:null}
          </div>
        ) : (
          <span className="text-[13px] text-slate-500">{requestId ? '체크는 상태 변경이 아니라 작업할 기록 선택입니다. 기록을 선택하면 저장 버튼이 나타납니다.' : '완료된 요청을 선택하면 기록을 선택해 상태를 저장할 수 있습니다.'}</span>
        )}
      </div>
      <div className="max-h-[36rem] overflow-y-auto overflow-x-hidden rounded-lg border border-slate-800">
        <div className={`hidden border-b border-slate-800 bg-slate-950 px-3 py-1.5 text-[12px] font-semibold text-slate-400 sm:grid sm:gap-x-2 ${CLAIM_GRID}`} aria-hidden="true">
          <span>선택</span><span>진료일</span><span>병원·약국</span><span>상병·코드</span><span>진료유형·입원일수</span><span>청구 상태(수동)</span>
        </div>
        <ul className="divide-y divide-slate-800">
          {visible.map(r=><ClaimRow key={r.key} r={r} status={statusOf(r)} ready={ready} checkedAt={states[keys[r.key]]?.checked_at} selected={selected.has(r.key)} selectDisabled={!ready || saving} open={expanded.has(r.key)} onToggle={()=>toggleOpen(r.key)}
            onSelect={checked=>setSelected(prev=>{const next=new Set(prev);if(checked)next.add(r.key);else next.delete(r.key);return next})}/>)}
        </ul>
        {!visible.length?<p className="p-5 text-center text-[13px] text-slate-500">조건에 맞는 기록이 없습니다.</p>:null}
      </div>
      <p className="text-[12px] leading-relaxed text-slate-500">청구 상태는 이 저장된 조회 건에만 적용되는 수동 확인입니다. 새로 조회한 자료와 자동 대조하지 않으며 담보별 청구·지급 완료를 뜻하지 않습니다. 약물·수술은 날짜·기관 매칭 추정이며 독감 약물 표시는 지급 확정이 아닙니다.</p>
    </section>
  )
}
