import { ChevronDown } from 'lucide-react'
import { CLAIM_LABELS, type CareRecord, type ClaimState } from '@renderer/services/health-record/careWorkspace'

/**
 * 청구 관리 목록 — PC에서는 간결한 행 목록, 375px 모바일에서는 같은 DOM이 카드로 쌓인다.
 * 상태(선택·펼침)는 HealthRecordWorkspace가 보유하고 여기서는 표시·이벤트 전달만 한다.
 * 원자료에 없는 값은 추정하지 않고 '미확인/미제공'으로 표시한다.
 */
const dateLabel = (s: string): string => (s.length === 8 ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}` : '날짜 미확인')
const daysLabel = (d: number): string => (d > 0 ? `${d}일분` : '투약일수 미확인')
export const CLAIM_GRID = 'sm:grid-cols-[2.75rem_6.5rem_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,9rem)_minmax(0,7.5rem)]'
const label = 'sm:hidden mr-1 text-[12px] font-semibold text-slate-500'

interface RowProps {
  r: CareRecord
  status: ClaimState
  ready: boolean
  checkedAt?: string
  selected: boolean
  selectDisabled: boolean
  open: boolean
  onSelect: (checked: boolean) => void
  onToggle: () => void
}

function StatusBadge({ status, ready }: { status: ClaimState; ready: boolean }): JSX.Element {
  if (!ready) return <span className="text-[13px] text-slate-500">상태 미조회</span>
  const tone = status === 'claimed' ? 'border-emerald-700 bg-emerald-50 text-emerald-800'
    : status === 'unclaimed' ? 'border-orange-700 bg-orange-50 text-orange-800' : 'border-slate-600 bg-slate-950 text-slate-300'
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[12px] font-bold ${tone}`}>{CLAIM_LABELS[status]}</span>
}

export function ClaimRow({ r, status, ready, checkedAt, selected, selectDisabled, open, onSelect, onToggle }: RowProps): JSX.Element {
  const detailId = `claim-detail-${r.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  const flu = r.medications.some((m) => m.flu)
  return (
    <li className={`px-3 py-2 ${selected ? 'bg-[#fdf7ea]' : ''}`}>
      <div className={`grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[13px] sm:items-start ${CLAIM_GRID}`}>
        <label className="row-span-5 inline-flex h-11 w-11 cursor-pointer items-center justify-center sm:row-span-1" title="작업 대상 선택">
          <input type="checkbox" className="h-5 w-5" aria-label={`${dateLabel(r.date)} ${r.hospital || '기관 미확인'} 작업 대상 선택`}
            disabled={selectDisabled} checked={selected} onChange={(e) => onSelect(e.target.checked)} />
        </label>
        <div className="min-w-0 sm:pt-2.5"><span className={label}>진료일</span><b className="text-slate-100">{dateLabel(r.date)}</b></div>
        <div className="min-w-0 break-words sm:pt-2.5"><span className={label}>병원·약국</span><span className={r.hospital ? 'text-slate-100' : 'text-slate-400'}>{r.hospital || '기관 미확인'}</span></div>
        <div className="min-w-0 break-words sm:pt-2.5">
          <span className={label}>상병</span><span className="font-semibold text-slate-100">{r.disease}</span>
          <div className="text-[12px] text-slate-500">{r.code || '코드 미제공'}</div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1 sm:pt-2">
          <span className={label}>구분</span>
          {r.kind === '입원'
            ? <span className="font-semibold text-slate-100">입원 · {r.admissionDays == null ? '일수 미확인' : `${r.admissionDays}일`}</span>
            : r.kind === '통원' ? <span className="text-slate-200">통원</span> : <span className="text-slate-400">구분 확인 필요</span>}
        </div>
        <div className="col-start-2 min-w-0 sm:col-start-auto sm:pt-2"><span className={label}>청구 상태</span><StatusBadge status={status} ready={ready} /></div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-[3.25rem] sm:pl-[3.25rem]">
        {r.surgery ? <span className="rounded border border-rose-600 px-1.5 py-0.5 text-[12px] font-bold text-rose-700">수술(추정)</span> : null}
        {flu ? <span className="rounded border border-emerald-700 px-1.5 py-0.5 text-[12px] font-bold text-emerald-800">독감 약물 · 담보 확인 대상</span> : null}
        {r.selfPay >= 300000 ? <span className="rounded border border-orange-700 px-1.5 py-0.5 text-[12px] font-bold text-orange-800">고액 본인부담</span> : null}
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={detailId}
          className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-[#7a5c14] hover:bg-[#fdf7ea]">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          {open ? '상세 접기' : '상세 보기'}
        </button>
      </div>
      {open ? (
        <div id={detailId} className="ml-0 mt-1 space-y-1.5 rounded-lg bg-slate-950 p-2.5 text-[13px] text-slate-200 sm:ml-[3.25rem]">
          <div><b>좌우</b> · {r.side && r.side !== '미확인' ? r.side : '미확인'}</div>
          <div>
            <b>약물·성분·투약일수</b>
            {r.medications.length ? (
              <ul className="mt-0.5 space-y-0.5">
                {r.medications.map((m, i) => (
                  <li key={i} className="break-words">{m.name}<span className="text-slate-500"> ({m.ingredient || '성분 미제공'})</span> · {daysLabel(m.days)}{m.flu ? <b className="ml-1 text-emerald-800">독감 약물</b> : null}</li>
                ))}
              </ul>
            ) : <span className="text-slate-400"> · 연결된 약물 미제공</span>}
          </div>
          <div className="break-words"><b>세부 처치</b> · {r.procedures.length ? r.procedures.join(', ') : <span className="text-slate-400">미제공</span>}</div>
          <div><b>수동 확인일</b> · {checkedAt ? new Date(checkedAt).toLocaleDateString('ko-KR') : <span className="text-slate-400">기록 없음</span>}</div>
          <p className="text-[12px] text-slate-500">약물·수술 연결은 진료일·기관 일치 기반 추정이며 지급 확정이 아닙니다.</p>
        </div>
      ) : null}
    </li>
  )
}
