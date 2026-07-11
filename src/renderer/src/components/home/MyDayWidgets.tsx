import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, BarChart3, MapPin, ChevronRight } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { listScheduleEvents, filterToday } from '@renderer/services/commercial/scheduleService'
import type { ScheduleWithCustomer } from '@renderer/services/commercial/supabaseScheduleAdapter'
import { SCHEDULE_TYPE_LABEL } from '@renderer/services/commercial/scheduleValidation'
import {
  listEntriesMonth,
  listExcelMonth,
  buildEffectiveMonthly,
  weightedTotal,
  currentMonth,
  SHORT_TERM_RATE
} from '@renderer/services/commercial/performanceRecordsService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

/**
 * 홈 화면 "내 하루" 위젯 — 본인 일정 + 본인 이번 달 매출.
 * 실적/일정 데이터는 전 직원 공개(RLS)지만 여기서는 session.id 로 **본인 것만** 골라 보여준다.
 * 카드를 누르면 각 전체 화면(일정/매출현황)으로 이동한다.
 */

const RT_TABLES = ['schedule_events', 'performance_entries', 'performance_records']

interface MyPerf {
  life: number
  nonLife: number
  shortTerm: number
}

function hhmm(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function comma(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}
function schedName(e: ScheduleWithCustomer): string {
  return e.customerName || e.manualCustomerName || e.title || SCHEDULE_TYPE_LABEL[e.type] || '일정'
}

export default function MyDayWidgets(): JSX.Element {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const [events, setEvents] = useState<ScheduleWithCustomer[]>([])
  const [perf, setPerf] = useState<MyPerf | null>(null)

  const load = async (): Promise<void> => {
    const month = currentMonth()
    const [sch, en, ex] = await Promise.all([listScheduleEvents(), listEntriesMonth(month), listExcelMonth(month)])
    setEvents(sch.ok ? sch.events.filter((e) => e.staffId === session.id) : [])
    const eff = buildEffectiveMonthly(ex.ok ? ex.data : [], en.ok ? en.data : [])
    const mine = eff.find((e) => e.staffId === session.id)
    setPerf(mine ? { life: mine.life, nonLife: mine.nonLife, shortTerm: mine.shortTerm } : { life: 0, nonLife: 0, shortTerm: 0 })
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])
  useRealtimeSync(RT_TABLES, () => void load())

  const today = useMemo(
    () => filterToday(events).filter((e) => e.status !== 'cancelled').sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [events]
  )
  const upcoming = useMemo(() => {
    const nowIso = new Date().toISOString()
    return events
      .filter((e) => e.status === 'planned' && e.startsAt >= nowIso)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, 3)
  }, [events])
  const list = today.length > 0 ? today : upcoming
  const total = perf ? weightedTotal(perf) : 0

  return (
    <div className="space-y-3">
      {/* 내 이번 달 매출 (본인 실적만) — 골드 카드 */}
      <button
        type="button"
        onClick={() => navigate({ name: 'performance' })}
        className="block w-full rounded-2xl border border-[#c6982f]/40 bg-gradient-to-br from-[#0e1e3a] to-[#1b3a6b] p-4 text-left"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#e6c877]">
            <BarChart3 className="h-3.5 w-3.5" /> 이번 달 내 매출
          </span>
          <ChevronRight className="h-4 w-4 text-white/50" />
        </div>
        <div className="mt-1 text-2xl font-black text-white">{comma(total)}원</div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-300">
          <span>생보 {comma(perf?.life ?? 0)}</span>
          <span>손보 {comma(perf?.nonLife ?? 0)}</span>
          <span>
            단기납 {comma(perf?.shortTerm ?? 0)}
            <span className="ml-0.5 text-[9px] text-[#e6c877]">×{SHORT_TERM_RATE}</span>
          </span>
        </div>
      </button>

      {/* 내 일정 (오늘 우선, 없으면 다가오는 일정) */}
      <button
        type="button"
        onClick={() => navigate({ name: 'schedule' })}
        className="block w-full rounded-2xl border border-slate-800 bg-white p-3 text-left"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
            <CalendarDays className="h-3.5 w-3.5 text-[#c6982f]" /> {today.length > 0 ? '오늘 일정' : '다가오는 일정'}
          </span>
          <ChevronRight className="h-4 w-4 text-slate-400" />
        </div>
        {list.length === 0 ? (
          <p className="py-1 text-[12px] text-slate-500">예정된 일정이 없습니다.</p>
        ) : (
          <ul className="space-y-1.5">
            {list.map((e) => (
              <li key={e.id} className="flex items-center gap-2">
                <span className="shrink-0 rounded-md bg-[#0e1e3a] px-1.5 py-0.5 text-[10px] font-bold text-[#e6c877]">
                  {SCHEDULE_TYPE_LABEL[e.type] ?? e.type}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-100">{schedName(e)}</span>
                  {e.location ? (
                    <span className="flex items-center gap-0.5 truncate text-[10px] text-slate-500">
                      <MapPin className="h-2.5 w-2.5 shrink-0" />
                      {e.location}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[12px] font-bold text-slate-300">{hhmm(e.startsAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </button>
    </div>
  )
}
