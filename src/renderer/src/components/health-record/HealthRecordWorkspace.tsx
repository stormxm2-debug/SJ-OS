import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Printer, RefreshCw } from 'lucide-react'
import {
  admissionSummary, buildCareRecords, CARE_PERIODS, claimRecordKey, CLAIM_LABELS, localYmd, matchCareGuides,
  type CarePeriod, type CareRecord, type ClaimState, type HrUnderwritingContext
} from '@renderer/services/health-record/careWorkspace'
import { healthClaimStore, type ClaimChecks } from '@renderer/services/health-record/claimStateStore'
import { printCareRecords } from '@renderer/services/health-record/printCareRecords'
import { listUnderwriting, UNDERWRITING_INSURERS, UNDERWRITING_STATUS_LABEL, type UnderwritingDisease, type UnderwritingStatus } from '@renderer/services/underwriting/underwritingService'
import { ClaimRow, CLAIM_GRID } from './ClaimRecordList'
import { listExceptions, type ExceptionRule } from '@renderer/services/underwriting/exceptionDiseaseService'

const button = 'min-h-9 rounded-lg border border-slate-700 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-200 disabled:opacity-40'
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
}

export default function HealthRecordWorkspace({ result, requestId, period, mode, onContextChange }: Props): JSX.Element {
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
  const admission = admissionSummary(rows)
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
  const [guideLoaded, setGuideLoaded] = useState(false)
  const context = useMemo(() => matchCareGuides(rows, guides, exceptions, insurers), [rows, guides, exceptions, insurers])
  useEffect(() => { onContextChange(context) }, [context, onContextChange])
  const loadGuides = async (): Promise<void> => {
    setGuideBusy(true); setGuideError('')
    try {
      const [g, e] = await Promise.all([listUnderwriting(), listExceptions()])
      setGuides(g.ok ? g.items : []); setExceptions(e.ok ? e.data : []); setGuideLoaded(g.ok && e.ok)
      if (!g.ok || !e.ok) setGuideError([!g.ok ? g.error : '', !e.ok ? e.message : ''].filter(Boolean).join(' / '))
    } catch { setGuideError('인수 기준을 불러오지 못했습니다.'); setGuideLoaded(false); setGuides([]); setExceptions([]) }
    finally { setGuideBusy(false) }
  }
  const exportList = (): void => {
    if (!visible.length) return
    if (!printCareRecords(visible, statusOf, `${CARE_PERIODS.find(p=>p.value===period)?.label} · ${ready?(filter==='all'?'전체 상태':CLAIM_LABELS[filter]):'청구 상태 미조회'} · 기준일 ${dateLabel(localYmd())}`)) setError('출력 창을 열지 못했습니다. 팝업 허용 여부를 확인하세요.')
  }
  if (mode === 'summary') {
    const periodText = period === 'all' ? '조회 전체' : `최근 ${CARE_PERIODS.find(p=>p.value===period)?.label ?? ''}`
    const kpis: [string, string, string][] = [
      ['기록', `${rows.length}건`, ''],
      ['입원 일수(추정)', `${admission.knownDays}일`, admission.unknown ? `일수 미확인 ${admission.unknown}건 별도` : ''],
      ['수술(명칭 기반 추정)', `${new Set(rows.filter(r=>r.surgery).map(r=>JSON.stringify([r.date,r.hospital]))).size}회`, ''],
      ['미청구로 확인', ready ? `${rows.filter(r=>statusOf(r)==='unclaimed').length}건` : '상태 확인 필요', ready ? '수동 확인 기준' : (requestId ? (loading ? '청구 상태 조회 중' : '청구 상태 미조회') : '저장된 요청에서 확인')]
    ]
    return (
      <section className="mt-3 rounded-xl border border-slate-800 bg-white p-3" aria-labelledby="hr-kpi-title">
        <h3 id="hr-kpi-title" className="flex flex-wrap items-center gap-2 text-[14px] font-bold text-slate-100">
          한눈에 요약
          <span className="rounded-full border border-[#c6982f] bg-[#fdf7ea] px-2.5 py-0.5 text-[12px] font-bold text-[#0e1e3a]">선택 기간 · {periodText}</span>
        </h3>
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {kpis.map(([label, value, sub]) => (
            <div key={label} className="min-w-0 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5">
              <div className="text-[12px] font-semibold text-slate-400">{label}</div>
              <strong className="mt-0.5 block break-words text-[22px] leading-tight text-[#0e1e3a]">{value}</strong>
              {sub ? <div className="mt-0.5 text-[12px] text-slate-500">{sub}</div> : null}
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (mode === 'review') return (
    <section className="mt-3 space-y-2 rounded-xl border border-slate-800 bg-white p-3" aria-label="보험사 기준 조회">
      <h3 className="text-[13px] font-bold text-slate-100">1. 보험사 기준 조회</h3>
      <p className="text-[12px] leading-relaxed text-slate-500">보험사를 선택하고 등록된 인수 가이드·유병자 예외질환 기준을 불러오세요. 병명·별칭이 정확히 일치한 참고 기준만 연결합니다. 미매칭·미검수는 가입 가능을 뜻하지 않습니다.</p>
        <div className="flex flex-wrap gap-x-3 gap-y-2">{[...new Set([...UNDERWRITING_INSURERS,...exceptions.map(e=>e.insurer)])].map(i=><label key={i} className="inline-flex min-h-8 items-center gap-1.5 text-[12px] text-slate-300"><input type="checkbox" className="h-4 w-4" checked={insurers.includes(i)} onChange={e=>setInsurers(prev=>e.target.checked?[...prev,i]:prev.filter(s=>s!==i))}/>{i}</label>)}</div>
        <button type="button" disabled={guideBusy} onClick={()=>void loadGuides()} className={button}>{guideBusy?'기준 조회 중…':'등록된 인수·예외 기준 불러오기'}</button>
        {guideError?<p role="alert" className="text-[12px] text-rose-600">{guideError}</p>:null}
        {guideLoaded?<p className="text-[12px] text-slate-500">일치한 인수 기준 {context.guides.length}건 · 예외 기준 {context.exceptions.length}건. 상품·기준일·치료 경과 조건을 확인해야 합니다.</p>:null}
        <ul className="space-y-1">{context.guides.map((g,i)=><li key={i} className="rounded-lg bg-slate-950 p-2 text-[12px] text-slate-300"><b>{g.insurer} · {g.disease}</b> — 등록 기준: {UNDERWRITING_STATUS_LABEL[g.status as UnderwritingStatus]??'추가 확인'} · {g.verified?'검수됨':'검수 전'}<p className="mt-1 text-slate-500">{g.note||'세부 조건 미입력'} · 상품명·기준일 미제공 / 최종 심사 아님</p></li>)}{context.exceptions.map(e=><li key={e.id} className="rounded-lg bg-slate-950 p-2 text-[12px] text-slate-300"><b>{e.insurer} · {e.disease}</b> — 상품구분 {e.productClass||'미제공'} · {e.verified?'검수됨':'검수 전'}<p className="mt-1 text-slate-500">경과 {e.minElapsed||'확인 필요'} / 치료 {e.treatmentPeriod||'확인 필요'} / 수술 {e.surgery||'확인 필요'} · 갱신 {e.updatedAt?new Date(e.updatedAt).toLocaleDateString('ko-KR'):'미제공'}</p>{e.note?<p>{e.note}</p>:null}</li>)}</ul>
    </section>
  )

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
