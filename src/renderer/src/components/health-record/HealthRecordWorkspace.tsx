import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Printer, RefreshCw } from 'lucide-react'
import {
  admissionSummary, buildCareRecords, CARE_PERIODS, claimRecordKey, CLAIM_LABELS, localYmd, matchCareGuides,
  type CarePeriod, type CareRecord, type ClaimState, type HrUnderwritingContext
} from '@renderer/services/health-record/careWorkspace'
import { healthClaimStore, type ClaimChecks } from '@renderer/services/health-record/claimStateStore'
import { printCareRecords } from '@renderer/services/health-record/printCareRecords'
import { listUnderwriting, UNDERWRITING_INSURERS, UNDERWRITING_STATUS_LABEL, type UnderwritingDisease, type UnderwritingStatus } from '@renderer/services/underwriting/underwritingService'
import { listExceptions, type ExceptionRule } from '@renderer/services/underwriting/exceptionDiseaseService'

const button = 'min-h-9 rounded-lg border border-slate-700 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-200 disabled:opacity-40'
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
    setReady(false); setStates({}); setKeys({}); setSelected(new Set()); setFilter('all'); setError(''); setNotice(''); setSaving(false)
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
  if (mode === 'summary') return (
    <section className="mt-3 space-y-2 rounded-xl border border-slate-800 bg-white p-3" aria-label="핵심 수치">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[['기록',`${rows.length}건`],['입원 일수',`${admission.knownDays}일${admission.unknown?` + 미확인 ${admission.unknown}건`:''}`],['수술(명칭 기반 추정)',`${new Set(rows.filter(r=>r.surgery).map(r=>JSON.stringify([r.date,r.hospital]))).size}회`],['미청구로 확인',ready?`${rows.filter(r=>statusOf(r)==='unclaimed').length}건`:'상태 확인 필요']].map(([label,value])=><div key={label} className="min-w-0 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2"><div className="text-[11px] text-slate-500">{label}</div><strong className="break-words text-[16px] text-slate-100">{value}</strong></div>)}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">입원일수는 동일 날짜·기관의 최대값을 한 번 합산한 원자료 추정 합계입니다. 연속 입원·여러 기관의 중복 기간은 추가 확인하세요. 최근 기록이라는 사실만으로 고지 의무가 확정되지 않습니다.</p>
    </section>
  )

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

  return (
    <section className="mt-3 space-y-3 rounded-xl border border-slate-800 bg-white p-3" aria-label="청구 관리">
      {!requestId ? <p className="rounded-lg bg-amber-50 p-2 text-[12px] text-amber-800">청구 상태 저장은 아래 ‘최근 요청’에서 완료된 결과를 선택한 후 사용할 수 있습니다.</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="건강기록 검색" placeholder="병원 · 상병 · 코드 · 약물 검색" value={query} onChange={e=>{setQuery(e.target.value);setSelected(new Set())}} className="min-h-9 w-full min-w-0 flex-1 rounded-lg border border-slate-700 bg-white px-3 py-1.5 text-[13px] text-slate-100 sm:w-auto" />
        <select aria-label="진료 유형 필터" value={kind} onChange={e=>{setKind(e.target.value);setSelected(new Set())}} className={button}><option value="all">모든 유형</option>{['입원','통원','수술','확인 필요'].map(s=><option key={s}>{s}</option>)}</select>
        <select aria-label="청구 상태 필터" value={filter} disabled={!ready} onChange={e=>{setFilter(e.target.value as ClaimState|'all');setSelected(new Set())}} className={button}><option value="all">전체 상태</option>{Object.entries(CLAIM_LABELS).map(([s,label])=><option key={s} value={s}>{label}</option>)}</select>
        <button type="button" onClick={exportList} disabled={!visible.length || loading} className={button}><Printer className="mr-1 inline h-3 w-3"/>현재 목록 인쇄 / PDF</button>
        <button type="button" onClick={()=>setRevision(n=>n+1)} disabled={!requestId || loading || saving} className={button}><RefreshCw className="mr-1 inline h-3 w-3"/>상태 새로고침</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
        <span className="w-full sm:w-auto">{visibleSelected.length}건 선택 · 체크박스는 작업할 행 선택</span>
        {(Object.keys(CLAIM_LABELS) as ClaimState[]).map(s=><button key={s} type="button" onClick={()=>void save(s)} disabled={!ready || saving || !visibleSelected.length || visibleSelected.length>200} className={button}>{saving?<Loader2 className="mr-1 inline h-3 w-3 animate-spin"/>:null}{CLAIM_LABELS[s]}로 저장</button>)}
      </div>
      {loading?<p role="status" className="text-[11px] text-slate-500">저장된 청구 상태를 확인하는 중…</p>:null}
      {error?<p role="alert" className="rounded-lg bg-rose-50 p-2 text-[11px] text-rose-700">{error}</p>:null}
      {notice?<p role="status" className="text-[11px] text-emerald-700">{notice}</p>:null}
      <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-800">
        <table className="w-full text-left text-[11px]"><thead className="bg-slate-950 text-slate-400"><tr><th className="p-2"><input type="checkbox" aria-label="현재 목록 전체 선택" disabled={!ready || !visible.length || saving} checked={!!visible.length && visible.every(r=>selected.has(r.key))} onChange={e=>setSelected(new Set(e.target.checked?visible.map(r=>r.key):[]))}/></th><th className="p-2">진료일 · 병원</th><th className="p-2">상병 · 질병코드 · 좌우</th><th className="p-2">구분 · 입원일수</th><th className="p-2">약물 · 투약일수</th><th className="p-2">청구 상태</th></tr></thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">{visible.map(r=><tr key={r.key}><td className="p-2 align-top"><input type="checkbox" aria-label={`${dateLabel(r.date)} ${r.hospital} 선택`} disabled={!ready || saving} checked={selected.has(r.key)} onChange={e=>{const checked=e.target.checked;setSelected(prev=>{const next=new Set(prev);checked?next.add(r.key):next.delete(r.key);return next})}}/></td><td className="p-2 align-top">{dateLabel(r.date)}<br/>{r.hospital||'기관 미확인'}</td><td className="p-2 align-top"><strong>{r.disease}</strong><div className="text-[10px] text-slate-500">{r.code||'코드 미제공'} · {r.side}</div></td><td className="p-2 align-top">{r.kind}{r.surgery?<b className="ml-1 text-rose-600">수술(추정)</b>:null}{r.kind==='입원'?<div>입원 {r.admissionDays==null?'일수 미확인':`${r.admissionDays}일`}</div>:null}{r.selfPay>=300000?<b className="text-orange-700">고액 본인부담</b>:null}</td><td className="p-2 align-top">{r.medications.length?r.medications.map((m,i)=><div key={i}>{m.name} <span className="text-slate-500">{m.days?`${m.days}일분`:'일수 미확인'}</span>{m.flu?<div className="font-bold text-emerald-700">독감 치료 약물 · 담보 확인 대상</div>:null}</div>):'정보 없음'}</td><td className="p-2 align-top"><span className={statusOf(r)==='claimed'?'font-bold text-emerald-700':statusOf(r)==='unclaimed'?'font-bold text-orange-700':'text-slate-500'}>{ready?CLAIM_LABELS[statusOf(r)]:'상태 미조회'}</span>{states[keys[r.key]]?.checked_at?<div className="text-[9px] text-slate-500">수동 확인 {new Date(states[keys[r.key]].checked_at).toLocaleDateString('ko-KR')}</div>:null}</td></tr>)}</tbody>
        </table>{!visible.length?<p className="p-5 text-center text-[12px] text-slate-500">조건에 맞는 기록이 없습니다.</p>:null}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">청구 상태는 이 저장된 조회 건에만 적용되는 수동 확인입니다. 새로 조회한 자료와 자동 대조하지 않으며 담보별 청구·지급 완료를 뜻하지 않습니다. 약물·수술은 날짜·기관 매칭 추정이며 독감 약물 표시는 지급 확정이 아닙니다.</p>
    </section>
  )
}
