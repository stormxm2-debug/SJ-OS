import { ChevronDown } from 'lucide-react'
import { useId } from 'react'
import { validCareDate, type CareRecord, type ClaimState } from '@renderer/services/health-record/careWorkspace'
import { diseaseLabel } from './RecentCareTable'

/**
 * 청구 관리 목록 — PC에서는 6열 행 목록, 375px 모바일에서는 같은 DOM이 간결한 카드로 쌓인다.
 * 기본 행: 선택·날짜·병원·병명(+좌우)·청구 상태·자세히 보기. 코드·진료 구분·수술/독감약/고액 표시·
 * 처방약 전체(이름·성분·투약일수)·세부 치료·확인일은 자세히 보기에만 둔다(약 이름은 기본 행에 표시하지 않음).
 * 상태(선택·펼침)는 HealthRecordWorkspace가 보유하고 여기서는 표시·이벤트 전달만 한다.
 */
const dateLabel = (s: string): string => (validCareDate(s) ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}` : '날짜 미확인')
const daysLabel = (d: number): string => (d > 0 ? `${d}일분` : '일수 미확인')
/** 화면 표시용 쉬운 라벨 — 내부 상태값(unknown/unclaimed/claimed)과 저장 키는 바꾸지 않는다. */
export const CLAIM_VIEW_LABELS: Record<ClaimState, string> = { unknown: '확인 필요', unclaimed: '미청구', claimed: '청구 완료' }
export const CLAIM_GRID = 'sm:grid-cols-[2.75rem_6.5rem_minmax(0,1fr)_minmax(0,1.3fr)_6.5rem_7rem]'

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
  if (!ready) return <span className="text-[12px] text-slate-500">상태 미조회</span>
  const tone = status === 'claimed' ? 'border-emerald-700 bg-emerald-50 text-emerald-800'
    : status === 'unclaimed' ? 'border-orange-700 bg-orange-50 text-orange-800' : 'border-slate-600 bg-slate-950 text-slate-300'
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-bold ${tone}`}>{CLAIM_VIEW_LABELS[status]}</span>
}

function Detail({ r, id, checkedAt }: { r: CareRecord; id: string; checkedAt?: string }): JSX.Element {
  const flu = r.medications.some((m) => m.flu)
  const dt = 'font-semibold text-slate-400'
  return (
    <dl id={id} className="mt-1 grid gap-x-3 gap-y-1 rounded-lg bg-slate-950 p-2.5 text-[13px] text-slate-200 sm:ml-[3.25rem] sm:grid-cols-[7rem_minmax(0,1fr)]">
      <dt className={dt}>질병코드</dt><dd className="break-words">{r.code || <span className="text-slate-400">미제공</span>}</dd>
      <dt className={dt}>진료 구분</dt>
      <dd>{r.kind === '입원' ? `입원 · ${r.admissionDays == null ? '일수 미확인' : `${r.admissionDays}일`}` : r.kind === '통원' ? '통원' : <span className="text-slate-400">확인 필요</span>}</dd>
      {r.surgery || flu || r.selfPay >= 300000 ? (
        <>
          <dt className={dt}>참고 표시</dt>
          <dd className="flex flex-wrap gap-1.5">
            {r.surgery ? <span className="rounded border border-rose-600 px-1.5 py-0.5 text-[12px] font-bold text-rose-700">수술 추정</span> : null}
            {flu ? <span className="rounded border border-emerald-700 px-1.5 py-0.5 text-[12px] font-bold text-emerald-800">독감약 · 보장 확인 필요</span> : null}
            {r.selfPay >= 300000 ? <span className="rounded border border-orange-700 px-1.5 py-0.5 text-[12px] font-bold text-orange-800">본인부담 30만 원 이상</span> : null}
          </dd>
        </>
      ) : null}
      <dt className={dt}>처방약</dt>
      <dd>
        {r.medications.length ? (
          <ul className="space-y-0.5">
            {r.medications.map((m, i) => (
              <li key={i} className="break-words">{m.name}{m.ingredient ? <span className="text-slate-500"> ({m.ingredient})</span> : null} · {daysLabel(m.days)}{m.flu ? <b className="ml-1 text-emerald-800">독감약</b> : null}</li>
            ))}
          </ul>
        ) : <span className="text-slate-400">연결된 처방약 없음</span>}
      </dd>
      <dt className={dt}>치료 내용</dt><dd className="break-words">{r.procedures.length ? r.procedures.join(', ') : <span className="text-slate-400">미제공</span>}</dd>
      <dt className={dt}>표시한 날</dt><dd>{checkedAt ? new Date(checkedAt).toLocaleDateString('ko-KR') : <span className="text-slate-400">기록 없음</span>}</dd>
      <dd className="text-[12px] text-slate-500 sm:col-span-2">처방약·수술 연결은 진료일·병원이 같은 기록으로 추정한 것이며 보험금 지급 여부가 아닙니다.</dd>
    </dl>
  )
}

export function ClaimRow({ r, status, ready, checkedAt, selected, selectDisabled, open, onSelect, onToggle }: RowProps): JSX.Element {
  // 원자료 key(병원명 등 비ASCII 포함)를 치환하면 서로 다른 행이 같은 id가 될 수 있어 React 고유 id를 쓴다.
  const detailId = `claim-detail-${useId()}`
  const hospital = r.hospital || '병원 미확인'
  return (
    <li className={`px-2 py-2 sm:px-3 ${selected ? 'bg-[#fdf7ea]' : ''}`} data-claim-row>
      <div className={`grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-2 text-[13px] ${CLAIM_GRID}`}>
        <label className="row-span-3 inline-flex h-11 w-11 cursor-pointer items-center justify-center self-start sm:row-span-1 sm:self-center" title="표시할 대상으로 선택(저장 아님)">
          <input type="checkbox" className="h-5 w-5" aria-label={`${dateLabel(r.date)} ${hospital} 대상 선택`}
            disabled={selectDisabled} checked={selected} onChange={(e) => onSelect(e.target.checked)} />
        </label>
        <b className="min-w-0 text-slate-100">{dateLabel(r.date)}</b>
        <div className="justify-self-end sm:hidden"><StatusBadge status={status} ready={ready} /></div>
        <div className="col-span-2 min-w-0 break-words text-slate-200 sm:col-span-1">{hospital}</div>
        <div className="col-span-2 min-w-0 break-words font-semibold text-slate-100 sm:col-span-1">
          {diseaseLabel(r)}{r.side && r.side !== '미확인' ? <span className="font-normal text-slate-400"> · {r.side}</span> : null}
        </div>
        <div className="hidden sm:block"><StatusBadge status={status} ready={ready} /></div>
        <div className="col-start-2 col-end-4 sm:col-auto sm:text-right">
          <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={detailId}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-[#7a5c14] hover:bg-[#fdf7ea]">
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            {open ? '접기' : '자세히 보기'}
          </button>
        </div>
      </div>
      {open ? <Detail r={r} id={detailId} checkedAt={checkedAt} /> : null}
    </li>
  )
}
