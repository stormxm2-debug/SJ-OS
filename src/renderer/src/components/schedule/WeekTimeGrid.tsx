import { useMemo } from 'react'
import { kstDayKey as kstKeyOf, kstTodayKey } from '@renderer/services/schedule/calendarMonth'
import { gridHeight, layoutDay, type TimedEvent } from '@renderer/services/schedule/weekLayout'
import { typeStyle } from '@renderer/services/schedule/typeColors'

/**
 * 시간표 (세로=시간, 가로=일). dayCount=7 이면 주간(일→토), dayCount=1 이면 일(하루) 뷰.
 * 일정 블록 위치·겹침 레인은 weekLayout 순수 로직(KST 기준)으로 계산한다.
 *
 * - 지금 시간선(빨간 줄): 오늘 열에 현재 시각을 표시.
 * - 빈 시간대 클릭 → onCreateAt(dayKey, 'HH:MM') (30분 단위 반올림).
 * - 일정 블록 클릭 → onSelectEvent(id).
 */

const DOW = ['일', '월', '화', '수', '목', '금', '토']
const START_HOUR = 7
const END_HOUR = 22
const PX_PER_MIN = 1.1
const pad = (n: number): string => String(n).padStart(2, '0')

export type WeekEvent = TimedEvent

/** 'YYYY-MM-DD' 에 n일을 더한 키 (UTC 산술이라 타임존 무관). */
export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** 'YYYY-MM-DD' 가 속한 주의 일요일 키. */
export function sundayOfKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDaysKey(key, -dow)
}

/** 'YYYY-MM-DD' 의 요일 인덱스(0=일). */
function dowOf(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

interface WeekTimeGridProps {
  events: WeekEvent[]
  /** 첫 열의 날짜 키 'YYYY-MM-DD' (KST). 주간이면 그 주 일요일, 일간이면 그 날짜. */
  weekStartKey: string
  /** 표시할 일 수 (7=주간, 1=일간). 기본 7. */
  dayCount?: number
  onSelectDay?: (dayKey: string) => void
  /** 빈 시간대 클릭 → 새 일정 생성 */
  onCreateAt?: (dayKey: string, hm: string) => void
  /** 일정 블록 클릭 → 상세/수정 */
  onSelectEvent?: (id: string) => void
}

export default function WeekTimeGrid({ events, weekStartKey, dayCount = 7, onSelectDay, onCreateAt, onSelectEvent }: WeekTimeGridProps): JSX.Element {
  const dayKeys = useMemo(() => Array.from({ length: dayCount }, (_, i) => addDaysKey(weekStartKey, i)), [weekStartKey, dayCount])
  const todayKey = kstTodayKey()
  const height = gridHeight({ startHour: START_HOUR, endHour: END_HOUR, pxPerMinute: PX_PER_MIN })
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)
  const cols = `40px repeat(${dayCount}, minmax(0, 1fr))`

  // 지금 시간선(오늘 열에만). START~END 범위 밖이면 숨김.
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes() - START_HOUR * 60
  const nowTop = nowMin * PX_PER_MIN
  const showNow = nowMin >= 0 && nowMin <= (END_HOUR - START_HOUR) * 60

  const blocksByDay = useMemo(() => {
    const map = new Map<string, ReturnType<typeof layoutDay>>()
    for (const key of dayKeys) {
      const dayEvents = events.filter((e) => kstKeyOf(e.startsAt) === key)
      map.set(key, layoutDay(dayEvents, { startHour: START_HOUR, endHour: END_HOUR, pxPerMinute: PX_PER_MIN }))
    }
    return map
  }, [events, dayKeys])

  const createFromClick = (key: string, e: React.MouseEvent<HTMLDivElement>): void => {
    if (!onCreateAt) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const rounded = Math.min(Math.max(0, Math.round(y / PX_PER_MIN / 30) * 30), (END_HOUR - START_HOUR) * 60)
    const total = START_HOUR * 60 + rounded
    onCreateAt(key, `${pad(Math.floor(total / 60))}:${pad(total % 60)}`)
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#cbd5e1] bg-white">
      <div>
        {/* 요일 헤더 */}
        <div className="grid border-b border-[#e2e8f0] bg-[#f8fafc]" style={{ gridTemplateColumns: cols }}>
          <div />
          {dayKeys.map((key) => {
            const wd = dowOf(key)
            const dayNum = Number(key.split('-')[2])
            const isToday = key === todayKey
            const color = wd === 0 ? 'text-rose-500' : wd === 6 ? 'text-sky-600' : 'text-[#64748b]'
            return (
              <button key={key} type="button" onClick={() => onSelectDay?.(key)} className="py-1.5 text-center transition hover:bg-[#f1f5f9]" aria-label={`${key} 일정 보기`}>
                <div className={`text-[11px] font-bold ${color}`}>{DOW[wd]}</div>
                <div className={isToday ? 'mx-auto inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#0e1e3a] text-[12px] font-bold text-white' : 'text-[13px] font-bold text-[#0e1e3a]'}>{dayNum}</div>
              </button>
            )
          })}
        </div>

        {/* 시간축 + 일 열 */}
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div className="relative" style={{ height }}>
            {hours.map((h) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-[#94a3b8]" style={{ top: Math.max((h - START_HOUR) * 60 * PX_PER_MIN, 7) }}>
                {pad(h)}:00
              </div>
            ))}
          </div>

          {dayKeys.map((key) => (
            <div
              key={key}
              className={['relative border-l border-[#e2e8f0]', onCreateAt ? 'cursor-pointer' : ''].join(' ')}
              style={{ height }}
              onClick={(e) => createFromClick(key, e)}
            >
              {hours.map((h) => (
                <div key={h} className="pointer-events-none absolute left-0 right-0 border-t border-[#e2e8f0]" style={{ top: (h - START_HOUR) * 60 * PX_PER_MIN }} />
              ))}
              {/* 지금 시간선 */}
              {showNow && key === todayKey ? (
                <div className="pointer-events-none absolute left-0 right-0 z-10" style={{ top: nowTop }}>
                  <div className="h-[2px] bg-rose-500" />
                  <div className="absolute -left-[3px] -top-[3px] h-2 w-2 rounded-full bg-rose-500" />
                </div>
              ) : null}
              {(blocksByDay.get(key) ?? []).map((b) => {
                const width = 100 / b.lanes
                return (
                  <div
                    key={b.id}
                    title={`${b.startHm}–${b.endHm} ${b.title}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectEvent?.(b.id)
                    }}
                    className={['absolute overflow-hidden rounded border border-[#94a3b8] bg-[#f1f5f9] px-1 py-[2px] text-[10px] leading-tight text-[#1e293b]', onSelectEvent ? 'cursor-pointer hover:brightness-95' : ''].join(' ')}
                    style={{
                      top: b.top,
                      height: b.height,
                      left: `calc(${b.lane * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                      backgroundColor: typeStyle(b.type).bg,
                      borderColor: typeStyle(b.type).border,
                      color: typeStyle(b.type).text
                    }}
                  >
                    <div className="font-semibold tabular-nums text-[#64748b]">{b.startHm}</div>
                    <div className="truncate">{b.title}</div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
