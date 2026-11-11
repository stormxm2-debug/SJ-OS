import { useMemo } from 'react'
import { kstDayKey as kstKeyOf, kstTodayKey } from '@renderer/services/schedule/calendarMonth'
import { gridHeight, layoutDay, type TimedEvent } from '@renderer/services/schedule/weekLayout'
import { typeStyle } from '@renderer/services/schedule/typeColors'

/**
 * 주간 시간표 (읽기 전용). 세로=시간, 가로=요일(일→토).
 * 일정 블록 위치·겹침 레인은 weekLayout 순수 로직으로 계산한다(KST 기준).
 * 드래그 이동/복사는 충돌 검사 저장이 필요해 다음 단계(별도 PR)에서 붙인다.
 *
 * 모바일은 가로 스크롤로 7일을 넓게 보여준다(가로 스크롤은 의도된 동작).
 */

const DOW = ['일', '월', '화', '수', '목', '금', '토']
const START_HOUR = 7
const END_HOUR = 22
const PX_PER_MIN = 1.1

export type WeekEvent = TimedEvent

/** 'YYYY-MM-DD' 에 n일을 더한 키 (UTC 산술이라 타임존 무관). */
export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

/** 'YYYY-MM-DD' 가 속한 주의 일요일 키. */
export function sundayOfKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDaysKey(key, -dow)
}

interface WeekTimeGridProps {
  events: WeekEvent[]
  /** 보여줄 주의 일요일 키 'YYYY-MM-DD' (KST). */
  weekStartKey: string
  onSelectDay?: (dayKey: string) => void
}

export default function WeekTimeGrid({ events, weekStartKey, onSelectDay }: WeekTimeGridProps): JSX.Element {
  const dayKeys = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysKey(weekStartKey, i)), [weekStartKey])
  const todayKey = kstTodayKey()
  const height = gridHeight({ startHour: START_HOUR, endHour: END_HOUR, pxPerMinute: PX_PER_MIN })
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)

  // 날짜별 블록 계산 (KST 날짜 키로 묶은 뒤 각 날짜를 독립 배치)
  const blocksByDay = useMemo(() => {
    const map = new Map<string, ReturnType<typeof layoutDay>>()
    for (const key of dayKeys) {
      const dayEvents = events.filter((e) => {
        const k = kstKeyOf(e.startsAt)
        return k === key
      })
      map.set(key, layoutDay(dayEvents, { startHour: START_HOUR, endHour: END_HOUR, pxPerMinute: PX_PER_MIN }))
    }
    return map
  }, [events, dayKeys])

  return (
    <div className="overflow-hidden rounded-2xl border border-[#cbd5e1] bg-white">
      {/* 중첩 스크롤을 두지 않는다 — 안쪽 가로 스크롤이 세로 스와이프를 먹어 버려 두 번 해야 했음 */}
      <div>
        <div>
          {/* 요일 헤더 */}
          <div className="grid border-b border-[#e2e8f0] bg-[#f8fafc]" style={{ gridTemplateColumns: '40px repeat(7, minmax(0, 1fr))' }}>
            <div />
            {dayKeys.map((key, i) => {
              const dayNum = Number(key.split('-')[2])
              const isToday = key === todayKey
              const color = i === 0 ? 'text-rose-500' : i === 6 ? 'text-sky-600' : 'text-[#64748b]'
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectDay?.(key)}
                  className="py-1.5 text-center transition hover:bg-[#f1f5f9]"
                  aria-label={`${key} 일정 보기`}
                >
                  <div className={`text-[11px] font-bold ${color}`}>{DOW[i]}</div>
                  <div className={isToday ? 'mx-auto inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#0e1e3a] text-[12px] font-bold text-white' : 'text-[13px] font-bold text-[#0e1e3a]'}>
                    {dayNum}
                  </div>
                </button>
              )
            })}
          </div>

          {/* 시간축 + 7개 일 열 */}
          <div className="grid" style={{ gridTemplateColumns: '40px repeat(7, minmax(0, 1fr))' }}>
            {/* 시간 라벨 */}
            <div className="relative" style={{ height }}>
              {hours.map((h) => (
                <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-[#94a3b8]" style={{ top: Math.max((h - START_HOUR) * 60 * PX_PER_MIN, 7) }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {dayKeys.map((key) => (
              <div key={key} className="relative border-l border-[#e2e8f0]" style={{ height }}>
                {/* 시간 가이드 라인 */}
                {hours.map((h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-[#e2e8f0]" style={{ top: (h - START_HOUR) * 60 * PX_PER_MIN }} />
                ))}
                {(blocksByDay.get(key) ?? []).map((b) => {
                  const width = 100 / b.lanes
                  return (
                    <div
                      key={b.id}
                      title={`${b.startHm}–${b.endHm} ${b.title}`}
                      className="absolute overflow-hidden rounded border border-[#94a3b8] bg-[#f1f5f9] px-1 py-[2px] text-[10px] leading-tight text-[#1e293b]"
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
    </div>
  )
}

