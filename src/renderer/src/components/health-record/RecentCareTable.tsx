import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { recentCareSummary, type CareRecord } from '@renderer/services/health-record/careWorkspace'

/**
 * 한눈에 요약 상단 — 최근 3개월(달력 기준 고정) 병원·약물 이력.
 * 공통 기간 선택과 무관하게 전체 조회 결과에서 계산한다. 고지 확인용 참고이며 고지 의무·인수 여부를 판정하지 않는다.
 */
const INITIAL_ROWS = 6
const dateLabel = (s: string): string => (s.length === 8 ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}` : '날짜 미확인')
const daysLabel = (d: number): string => (d > 0 ? `${d}일분` : '투약일수 미확인')

function KindCell({ r }: { r: CareRecord }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {r.kind === '입원' ? (
        <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[12px] font-bold text-white">입원 {r.admissionDays == null ? '· 일수 미확인' : `${r.admissionDays}일`}</span>
      ) : r.kind === '통원' ? (
        <span className="text-slate-200">통원</span>
      ) : (
        <span className="text-slate-400">구분 확인 필요</span>
      )}
      {r.surgery ? <span className="rounded border border-rose-600 px-1.5 py-0.5 text-[12px] font-bold text-rose-700">수술(명칭 기반 추정)</span> : null}
    </div>
  )
}

function Row({ r }: { r: CareRecord }): JSX.Element {
  const [open, setOpen] = useState(false)
  const shownMeds = r.medications.slice(0, 2)
  const hasMore = r.medications.length > shownMeds.length || r.procedures.length > 0 || r.medications.some((m) => m.ingredient)
  const label = 'sm:hidden text-[12px] font-semibold text-slate-500'
  return (
    <li className="px-3 py-2.5">
      <div className="grid gap-x-3 gap-y-1 text-[13px] sm:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,8.5rem)_minmax(0,1.2fr)]">
        <div><span className={label}>진료일 </span><b className="text-slate-100">{dateLabel(r.date)}</b></div>
        <div className="min-w-0 break-words"><span className={label}>병원·약국 </span><span className={r.hospital ? 'text-slate-100' : 'text-slate-400'}>{r.hospital || '기관 미확인'}</span></div>
        <div className="min-w-0 break-words">
          <span className={label}>상병 </span>
          <span className="font-semibold text-slate-100">{r.disease}</span>
          <div className="text-[12px] text-slate-500">{r.code || '코드 미제공'}{r.side !== '미확인' ? ` · ${r.side}` : ''}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1 sm:block"><span className={label}>구분 </span><KindCell r={r} /></div>
        <div className="min-w-0 break-words">
          <span className={label}>약물 </span>
          {shownMeds.length ? shownMeds.map((m, i) => (
            <div key={i} className="text-slate-200">{m.name} <span className="text-[12px] text-slate-500">· {daysLabel(m.days)}</span></div>
          )) : <span className="text-slate-400">연결된 약물 없음</span>}
          {r.medications.length > shownMeds.length ? <div className="text-[12px] text-slate-500">외 {r.medications.length - shownMeds.length}건</div> : null}
        </div>
      </div>
      {hasMore ? (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="mt-1 inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-[#8a6a1f] hover:bg-[#fdf7ea]">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          {open ? '세부 접기' : '세부 진료·약물 보기'}
        </button>
      ) : null}
      {open ? (
        <div className="mt-1 space-y-1 rounded-lg bg-slate-950 p-2 text-[13px] text-slate-200">
          {r.procedures.length ? <div><b>세부 진료·치료</b> · {r.procedures.join(', ')}</div> : null}
          {r.medications.length ? (
            <ul className="space-y-0.5">
              {r.medications.map((m, i) => (
                <li key={i}>{m.name}{m.ingredient ? <span className="text-slate-500"> ({m.ingredient})</span> : null} · {daysLabel(m.days)}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-[12px] text-slate-500">수술·약물 연결은 진료일·기관 일치 기반 추정입니다.</p>
        </div>
      ) : null}
    </li>
  )
}

export default function RecentCareTable({ result }: { result: Record<string, unknown> }): JSX.Element {
  const s = useMemo(() => recentCareSummary(result), [result])
  const [expanded, setExpanded] = useState(false)
  const rows = expanded ? s.records : s.records.slice(0, INITIAL_ROWS)
  return (
    <section className="mt-3 rounded-xl border border-slate-800 bg-white" aria-labelledby="hr-recent-title">
      <div className="border-b border-slate-800 px-3 py-2.5">
        <h3 id="hr-recent-title" className="text-[14px] font-bold text-slate-100">
          최근 3개월 병원·약물 이력 <span className="font-semibold text-slate-400">· {s.records.length}건</span>
        </h3>
        <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
          {dateLabel(s.start)} ~ {dateLabel(s.end)} 고정(위 기간 선택과 별개) · 고지 확인용 참고이며 고지 의무·인수 여부를 판정하지 않습니다.
        </p>
      </div>

      {s.records.length ? (
        <>
          <div className="hidden border-b border-slate-800 bg-slate-950 px-3 py-1.5 text-[12px] font-semibold text-slate-400 sm:grid sm:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,8.5rem)_minmax(0,1.2fr)] sm:gap-x-3" aria-hidden="true">
            <span>진료일</span><span>병원·약국</span><span>상병·질병코드</span><span>통원·입원·수술</span><span>약물·투약일수</span>
          </div>
          <ul className="divide-y divide-slate-800">
            {rows.map((r) => <Row key={r.key} r={r} />)}
          </ul>
          {s.records.length > INITIAL_ROWS ? (
            <div className="border-t border-slate-800 p-2">
              <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
                className="min-h-10 w-full rounded-lg border border-slate-700 bg-white px-3 text-[13px] font-bold text-slate-200 hover:bg-slate-950">
                {expanded ? '접기' : `전체 ${s.records.length}건 보기`}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="px-3 py-3 text-[13px] leading-relaxed text-slate-300">
          {s.total === 0
            ? '조회 응답에 진료·투약 목록이 없습니다. 기록이 없다는 것이 이상 없음·가입 가능을 뜻하지 않습니다.'
            : `최근 3개월에 날짜가 확인된 기록이 없습니다. 조회 자료의 가장 최근 날짜는 ${s.latest ? dateLabel(s.latest) : '확인되지 않음'}이며, 조회 요청 기간이 최근 3개월을 포함했는지 확인하세요(기록 없음과 조회 범위 부족을 구분할 수 없습니다).`}
        </p>
      )}

      <div className="space-y-0.5 border-t border-slate-800 px-3 py-2 text-[12px] text-slate-500">
        {s.undated ? <p className="font-semibold text-amber-700">날짜 미확인 {s.undated}건 · 최근 3개월에 포함하지 않았습니다. 전체 기록(기간 ‘조회 전체’)에서 확인하세요.</p> : null}
        {s.oldest ? <p>조회 자료에 포함된 날짜: {dateLabel(s.oldest)} ~ {dateLabel(s.latest)} (실제 기록 기준이며 요청 기간 전체가 조회됐다는 뜻은 아닙니다)</p> : null}
      </div>
    </section>
  )
}
