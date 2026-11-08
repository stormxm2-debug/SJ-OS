import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { admissionBadgeLabel, careListSummary, filterSummaryRecords, validCareDate, type CarePeriod, type CareRecord, type SummaryKindFilter } from '@renderer/services/health-record/careWorkspace'

/**
 * 한눈에 요약 — 선택 기간(공통 기간)의 최근 진료 목록.
 * 핵심 숫자와 같은 기간·같은 계산(buildCareRecords(filterCareResult))을 쓴다. 저장된 결과의 표시 필터일 뿐
 * 새 기관 조회·인증·AI 요청을 일으키지 않는다. 고지 의무·인수 여부를 판정하지 않는다.
 */
const INITIAL_ROWS = 6
const dateLabel = (s: string): string => (validCareDate(s) ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}` : '날짜 미확인')
const daysLabel = (d: number): string => (d > 0 ? `${d}일분` : '일수 미확인')
const MED_ONLY = '약물 단독 기록 · 상병 연결 미확인'
/** 표시용 병명 — 내부 안내 문구를 짧은 일반 용어로 바꾼다(원자료 값은 바꾸지 않음). */
export const diseaseLabel = (r: CareRecord): string => r.disease === MED_ONLY ? '처방약 기록' : r.disease === '상병 정보 없음' ? '병명 미확인' : r.disease
/** 처방약은 기본 행에 표시하지 않고 자세히 보기에서만 보이므로, 약만 있는 기록도 버튼이 있어야 한다. */
export const hasCareDetail = (r: CareRecord): boolean =>
  !!r.code || r.kind !== '확인 필요' || r.surgery || r.procedures.length > 0 || r.medications.length > 0

/** 기본 행 병명 옆 '수술 추정' 표시 — 기존 r.surgery(명칭 기반 추정) 값을 그대로 보여줄 뿐 새 판정을 하지 않는다. */
export function SurgeryTag({ r }: { r: CareRecord }): JSX.Element | null {
  return r.surgery === true
    ? <span className="ml-1.5 inline-block whitespace-nowrap rounded border border-rose-600 px-1.5 align-middle text-[11px] font-bold leading-[1.5] text-rose-700">수술 추정</span>
    : null
}

/** 기본 행 병명 옆 입원 배지 — 기존 r.kind·r.admissionDays만 표시(일수 미확인을 0일로 쓰지 않음). 통원·확인 필요는 표시 없음. */
export function AdmissionTag({ r }: { r: CareRecord }): JSX.Element | null {
  const label = admissionBadgeLabel(r)
  return label
    ? <span className="ml-1.5 inline-block whitespace-nowrap rounded bg-rose-600 px-1.5 align-middle text-[11px] font-bold leading-[1.5] text-white">{label}</span>
    : null
}

/** 숫자 카드 바로가기로 고른 목록 조건의 짧은 이름. */
export const SUMMARY_FILTER_TITLE: Record<SummaryKindFilter, string> = { all: '최근 진료', inpatient: '입원 기록', surgery: '수술 추정 기록' }

function Detail({ r, id }: { r: CareRecord; id: string }): JSX.Element {
  return (
    <dl id={id} className="mt-2 grid gap-x-3 gap-y-1 rounded-lg bg-slate-950 p-2.5 text-[13px] text-slate-200 sm:grid-cols-[7rem_minmax(0,1fr)]">
      {r.code ? <><dt className="font-semibold text-slate-400">질병코드</dt><dd>{r.code}</dd></> : null}
      {r.kind !== '확인 필요' ? (
        <>
          <dt className="font-semibold text-slate-400">진료 구분</dt>
          <dd>{r.kind === '입원'
            ? <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[12px] font-bold text-white">입원 {r.admissionDays == null ? '· 일수 미확인' : `${r.admissionDays}일`}</span>
            : '통원'}</dd>
        </>
      ) : null}
      {r.surgery ? <><dt className="font-semibold text-slate-400">수술</dt><dd><span className="rounded border border-rose-600 px-1.5 py-0.5 text-[12px] font-bold text-rose-700">수술 추정</span></dd></> : null}
      {r.procedures.length ? <><dt className="font-semibold text-slate-400">치료 내용</dt><dd className="break-words">{r.procedures.join(', ')}</dd></> : null}
      {r.medications.length ? (
        <>
          <dt className="font-semibold text-slate-400">처방약</dt>
          <dd>
            <ul className="space-y-0.5">
              {r.medications.map((m, i) => (
                <li key={i} className="break-words">{m.name}{m.ingredient ? <span className="text-slate-500"> ({m.ingredient})</span> : null} · {daysLabel(m.days)}</li>
              ))}
            </ul>
          </dd>
        </>
      ) : null}
    </dl>
  )
}

function Row({ r, index }: { r: CareRecord; index: number }): JSX.Element {
  const [open, setOpen] = useState(false)
  const detailId = `hr-care-detail-${index}`
  const canOpen = hasCareDetail(r)
  return (
    <li className="rounded-xl border border-slate-800 bg-white p-3 sm:rounded-none sm:border-0 sm:px-3 sm:py-2.5" data-care-row>
      <div className="grid gap-y-0.5 text-[14px] sm:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1.4fr)_7.5rem] sm:items-center sm:gap-x-3 sm:text-[13px]">
        <div className="flex flex-wrap items-baseline gap-x-2 sm:block">
          <b className="text-slate-100">{dateLabel(r.date)}</b>
          <span className="min-w-0 break-words text-slate-300 sm:hidden">{r.hospital || '기관 미확인'}</span>
        </div>
        <div className="hidden min-w-0 break-words text-slate-100 sm:block">{r.hospital || '기관 미확인'}</div>
        <div className="min-w-0 break-words font-semibold text-slate-100">
          {diseaseLabel(r)}{r.side !== '미확인' ? <span className="font-normal text-slate-400"> · {r.side}</span> : null}<AdmissionTag r={r} /><SurgeryTag r={r} />
        </div>
        <div className="sm:text-right">
          {canOpen ? (
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={detailId}
              className="mt-1 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-[#8a6a1f] hover:bg-[#fdf7ea] sm:mt-0">
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
              {open ? '접기' : '자세히 보기'}
            </button>
          ) : null}
        </div>
      </div>
      {open ? <Detail r={r} id={detailId} /> : null}
    </li>
  )
}

export default function RecentCareTable({ result, period, filter = 'all', onShowAll, onClearFilter }: {
  result: Record<string, unknown>
  period: CarePeriod
  /** 요약 목록 전용 표시 필터 — 기간 전체 기록에 먼저 적용한 뒤 처음 6건만 보여준다. */
  filter?: SummaryKindFilter
  /** 기간을 '전체'로 바꾼다(타입 필터는 상위에서 함께 해제). */
  onShowAll: () => void
  /** 타입 필터만 해제(기간 유지). */
  onClearFilter?: () => void
}): JSX.Element {
  const s = useMemo(() => careListSummary(result, period), [result, period])
  const list = useMemo(() => filterSummaryRecords(s.records, filter), [s, filter])
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { setExpanded(false) }, [period, result, filter])
  const rows = expanded ? list : list.slice(0, INITIAL_ROWS)
  const filtered = filter !== 'all'
  const showAllBtn = (
    <button type="button" onClick={onShowAll} className="min-h-11 rounded-lg border border-slate-700 bg-white px-3 text-[13px] font-bold text-slate-200 hover:bg-slate-950">전체 기간 보기</button>
  )
  const clearBtn = filtered && onClearFilter ? (
    <button type="button" onClick={onClearFilter} className="min-h-11 shrink-0 rounded-lg border border-[#c6982f] bg-[#fdf7ea] px-3 text-[13px] font-bold text-[#7a5c14] hover:bg-[#f8ecd0]">전체 진료 보기</button>
  ) : null
  return (
    <section className="mt-3 rounded-xl border border-slate-800 bg-white" aria-labelledby="hr-recent-title" data-summary-filter={filter}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1.5">
        <h3 id="hr-recent-title" className="min-w-0 flex-1 py-1 text-[14px] font-bold text-slate-100" aria-live="polite">
          {SUMMARY_FILTER_TITLE[filter]} <span className="font-semibold text-slate-400">{list.length}건</span>
        </h3>
        {clearBtn}
      </div>

      {list.length ? (
        <>
          <div className="hidden border-b border-slate-800 bg-slate-950 px-3 py-1.5 text-[12px] font-semibold text-slate-400 sm:grid sm:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1.4fr)_7.5rem] sm:gap-x-3" aria-hidden="true">
            <span>날짜</span><span>병원</span><span>병명</span><span />
          </div>
          <ul className="space-y-2 p-2 sm:space-y-0 sm:divide-y sm:divide-slate-800 sm:p-0">
            {rows.map((r, i) => <Row key={r.key} r={r} index={i} />)}
          </ul>
          {list.length > INITIAL_ROWS ? (
            <div className="border-t border-slate-800 p-2">
              <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
                className="min-h-11 w-full rounded-lg border border-slate-700 bg-white px-3 text-[13px] font-bold text-slate-200 hover:bg-slate-950">
                {expanded ? '접기' : `전체 ${list.length}건 보기`}
              </button>
            </div>
          ) : null}
        </>
      ) : filtered && s.records.length ? (
        // 기록 없음 ≠ 실제 입원·수술 없음 — 조회된 자료 범위로만 안내한다.
        <div className="flex flex-wrap items-center gap-2 px-3 py-3 text-[13px] text-slate-300">
          <p className="min-w-0 flex-1">선택한 기간에 조회된 {filter === 'inpatient' ? '입원' : '수술 추정'} 기록이 없습니다.</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 px-3 py-3 text-[13px] text-slate-300">
          {s.total === 0
            ? <p>조회된 진료·처방 기록이 없습니다.</p>
            : <><p className="min-w-0 flex-1">선택한 기간에 조회된 기록이 없습니다.</p>{period !== 'all' ? showAllBtn : null}</>}
        </div>
      )}

      {period !== 'all' && s.undated ? (
        <p className="flex flex-wrap items-center gap-2 border-t border-slate-800 px-3 py-2 text-[12px] font-semibold text-amber-700">
          <span className="min-w-0 flex-1">날짜 미확인 {s.undated}건은 전체 기간에서 볼 수 있습니다.</span>
          {s.records.length ? showAllBtn : null}
        </p>
      ) : null}
    </section>
  )
}
