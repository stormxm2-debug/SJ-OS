import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Megaphone } from 'lucide-react'
import { monthMatrix, groupByDay, kstHm, kstTodayKey, kstYmd, shiftMonth, type MonthCell } from '@renderer/services/schedule/calendarMonth'
import { noticesByDayKey, truncateTitle, type CalendarNotice } from '@renderer/services/schedule/calendarNotices'
import { typeStyle } from '@renderer/services/schedule/typeColors'

/**
 * 월간 캘린더 (일요일→토요일 7열, 큰 칸, 일정 블록 + 공지 상단).
 *
 * 디자인: 화이트 배경 · 네이비 중심 · 미니멀(그림자/그라데이션 없음). 날짜·그룹핑은
 * 전부 Asia/Seoul 고정(calendarMonth) — 기기 타임존과 무관하게 같은 날짜 칸에 놓인다.
 * 표시 전용(데이터 변경 없음). 날짜 칸을 누르면 onSelectDay 로 그 날 상세로 이동한다.
 */

const NAVY = '#0e1e3a'
const DOW = ['일', '월', '화', '수', '목', '금', '토']

export interface MonthEvent {
  id: string
  startsAt: string
  title: string
  type?: string
}
interface MonthViewProps {
  events: MonthEvent[]
  /** 처음 보여줄 달 기준 날짜(기본: 오늘). */
  initialDate?: Date
  /** 회사 공지 목록. 날짜 없는 공지는 자동으로 제외된다(calendarNotices). 미연동이면 [] */
  notices?: CalendarNotice[]
  /** 날짜 칸 터치 시: 그 날짜(로컬 Date)로 상세 이동. */
  onSelectDay: (date: Date) => void
  /** 칸당 표시할 최대 일정 수(초과분은 +N). 기본 3. */
  maxPerCell?: number
  /** 보고 있는 달이 바뀔 때 알림(PDF 출력 등). */
  onAnchorChange?: (year: number, monthIndex0: number) => void
}

export default function MonthView({ events, initialDate, notices = [], onSelectDay, maxPerCell = 3, onAnchorChange }: MonthViewProps): JSX.Element {
  const init = kstYmd(initialDate ?? new Date())
  const [anchor, setAnchor] = useState<{ year: number; monthIndex0: number }>({
    year: Number.isNaN(init.y) ? new Date().getFullYear() : init.y,
    monthIndex0: Number.isNaN(init.m) ? new Date().getMonth() : init.m
  })

  useEffect(() => {
    onAnchorChange?.(anchor.year, anchor.monthIndex0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor])
  const cells = useMemo(() => monthMatrix(anchor.year, anchor.monthIndex0), [anchor])
  const byDay = useMemo(() => groupByDay(events, (e) => e.startsAt), [events])
  // 보이는 날짜 칸에 해당하는 공지만 계산 (날짜 없는 공지는 noticesByDayKey 가 제외)
  const noticesByDay = useMemo(() => noticesByDayKey(notices, cells.map((c) => c.key)), [notices, cells])
  const todayKey = kstTodayKey()

  const go = (delta: number): void => setAnchor((a) => shiftMonth(a.year, a.monthIndex0, delta))
  const goToday = (): void => {
    const t = kstYmd(new Date())
    setAnchor({ year: t.y, monthIndex0: t.m })
  }

  // 좌우 스와이프로 월 이동 (모바일)
  const touchX = useRef<number | null>(null)
  const onTouchStart = (e: React.TouchEvent): void => {
    touchX.current = e.changedTouches[0]?.clientX ?? null
  }
  const onTouchEnd = (e: React.TouchEvent): void => {
    if (touchX.current === null) return
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX.current
    touchX.current = null
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1) // 왼쪽으로 밀면 다음 달
  }

  const dowColor = (dow: number): string => (dow === 0 ? 'text-rose-500' : dow === 6 ? 'text-sky-600' : 'text-[#64748b]')

  const renderCell = (c: MonthCell): JSX.Element => {
    const dayEvents = byDay.get(c.key) ?? []
    const dayNotices = noticesByDay.get(c.key) ?? []
    const isToday = c.key === todayKey
    const dateNumColor = !c.inMonth ? 'text-[#cbd5e1]' : c.dow === 0 ? 'text-rose-500' : c.dow === 6 ? 'text-sky-600' : 'text-[#0e1e3a]'
    const visibleEvents = dayEvents.slice(0, Math.max(0, maxPerCell - Math.min(dayNotices.length, 1)))
    const hiddenCount = dayEvents.length - visibleEvents.length
    return (
      <button
        key={c.key}
        type="button"
        onClick={() => onSelectDay(new Date(c.y, c.m, c.d))}
        aria-label={`${c.y}년 ${c.m + 1}월 ${c.d}일, 일정 ${dayEvents.length}건${dayNotices.length ? `, 공지 ${dayNotices.length}건` : ''}`}
        className={[
          'flex min-h-[86px] flex-col gap-0.5 border-b border-r border-[#e2e8f0] p-1 text-left align-top transition sm:min-h-[112px]',
          c.inMonth ? 'bg-white hover:bg-[#f8fafc]' : 'bg-[#f8fafc]/60 hover:bg-[#f1f5f9]'
        ].join(' ')}
      >
        <div className="flex items-center justify-between">
          <span
            className={[
              'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums sm:text-[12px]',
              isToday ? 'bg-[#0e1e3a] text-white' : dateNumColor
            ].join(' ')}
          >
            {c.d}
          </span>
        </div>

        {/* 회사 공지 — 날짜 칸 최상단, 네이비 블록 + 아이콘 */}
        {dayNotices.slice(0, 1).map((n) => (
          <span
            key={n.id}
            title={n.title}
            className="flex items-center gap-0.5 truncate rounded px-1 py-[1px] text-[10px] font-semibold text-white sm:text-[11px]"
            style={{ backgroundColor: NAVY }}
          >
            <Megaphone className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{truncateTitle(n.title)}</span>
          </span>
        ))}
        {dayNotices.length > 1 ? <span className="px-1 text-[9px] font-medium text-[#0e1e3a]">공지 +{dayNotices.length - 1}</span> : null}

        {/* 일반 일정 — 공지 아래, 제목 직사각형 블록 */}
        {visibleEvents.map((ev) => {
          const st = typeStyle(ev.type)
          return (
          <span
            key={ev.id}
            title={ev.title}
            className="truncate rounded border px-1 py-[1px] text-[10px] sm:text-[11px]"
            style={{ backgroundColor: st.bg, borderColor: st.border, color: st.text }}
          >
            {/* 모바일(좁은 칸)에선 제목 우선 — 시간은 sm+에서만 표시해 제목이 읽히게 한다. */}
            <span className="hidden font-semibold tabular-nums text-[#64748b] sm:inline">{kstHm(ev.startsAt)} </span>
            {ev.title}
          </span>
          )
        })}
        {hiddenCount > 0 ? <span className="px-1 text-[10px] font-semibold text-indigo-600">+{hiddenCount}건</span> : null}
      </button>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#cbd5e1] bg-white" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* 월 이동 헤더 */}
      <div className="flex items-center justify-between border-b border-[#e2e8f0] px-3 py-2.5">
        <button type="button" onClick={() => go(-1)} aria-label="이전 달" className="rounded-lg p-1.5 text-[#64748b] transition hover:bg-[#f1f5f9] hover:text-[#0e1e3a]">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-bold tabular-nums text-[#0e1e3a]">
            {anchor.year}년 {anchor.monthIndex0 + 1}월
          </span>
          <button type="button" onClick={goToday} className="rounded-full border border-[#cbd5e1] px-2 py-0.5 text-[11px] font-semibold text-[#64748b] transition hover:border-[#0e1e3a] hover:text-[#0e1e3a]">
            오늘
          </button>
        </div>
        <button type="button" onClick={() => go(1)} aria-label="다음 달" className="rounded-lg p-1.5 text-[#64748b] transition hover:bg-[#f1f5f9] hover:text-[#0e1e3a]">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* 요일 헤더 (일→토) */}
      <div className="grid grid-cols-7 border-b border-[#e2e8f0] bg-[#f8fafc]">
        {DOW.map((n, i) => (
          <div key={n} className={['py-1.5 text-center text-[11px] font-bold sm:text-[12px]', dowColor(i)].join(' ')}>
            {n}
          </div>
        ))}
      </div>

      {/* 6주 x 7열 — 왼쪽/위 테두리는 칸의 border-r/b 로 그린다 */}
      <div className="grid grid-cols-7 border-l border-t border-[#e2e8f0]">{cells.map(renderCell)}</div>
    </div>
  )
}
