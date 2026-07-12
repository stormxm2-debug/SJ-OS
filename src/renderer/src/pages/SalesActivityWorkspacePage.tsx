import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CalendarCheck,
  CalendarClock,
  ListChecks,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Trophy,
  Users,
  RefreshCw,
  Loader2,
  Sparkles,
  Clock,
  MapPin
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { ROLE_LABEL, type UserRole } from '@renderer/navigation/roleAccess'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'
import { SCHEDULE_STATUS_LABEL, SCHEDULE_TYPE_LABEL } from '@renderer/services/commercial/scheduleValidation'
import type { ScheduleType } from '@renderer/services/commercial/scheduleValidation'
import {
  loadSalesActivityLive,
  summarize,
  rankByStaff,
  breakdownByType,
  isSalesActivity,
  isTodayActivity,
  isMissed,
  type LiveActivity
} from '@renderer/services/commercial/salesActivityLiveService'
import type { ScheduleDataMode } from '@renderer/services/commercial/scheduleService'

/**
 * 영업활동 현황 (실데이터) — 회원(직원)들이 등록한 일정(schedule_events)을 그대로
 * 영업활동으로 자동 집계한다. 대표/관리자는 전 직원, FC는 본인 활동이 RLS로 스코프된다.
 * 실시간 구독(schedule_events)으로 다른 기기에서 일정이 바뀌면 즉시 반영된다. 읽기 전용.
 */

const RT_TABLES = ['schedule_events']

const STATUS_TONE: Record<string, string> = {
  planned: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  done: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  cancelled: 'border-slate-500/30 bg-slate-500/10 text-slate-400'
}

const MODE_NOTICE: Record<ScheduleDataMode, string | null> = {
  supabase: null,
  'local-mock': '데모(로컬) 모드입니다. 실제 회원 데이터는 서버 로그인 후 표시됩니다.',
  'not-configured': '서버가 아직 연결되지 않았습니다. 연결 후 회원 영업활동이 자동 집계됩니다.',
  'no-session': '로그인 후 회원 영업활동이 자동으로 표시됩니다.'
}

function typeLabel(t: string): string {
  return SCHEDULE_TYPE_LABEL[t as ScheduleType] ?? t
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmtTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

export default function SalesActivityWorkspacePage(): JSX.Element {
  const [events, setEvents] = useState<LiveActivity[]>([])
  const [mode, setMode] = useState<ScheduleDataMode>('no-session')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    const res = await loadSalesActivityLive()
    setEvents(res.events)
    setMode(res.mode)
    setError(res.ok ? '' : res.error ?? '영업활동 데이터를 불러오지 못했습니다.')
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])
  useRealtimeSync(RT_TABLES, load)

  const summary = useMemo(() => summarize(events), [events])
  const ranking = useMemo(() => rankByStaff(events), [events])
  const funnel = useMemo(() => breakdownByType(events), [events])
  const funnelMax = useMemo(() => funnel.reduce((m, f) => Math.max(m, f.count), 0), [funnel])

  const todayList = useMemo(
    () => events.filter((e) => isSalesActivity(e) && isTodayActivity(e)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [events]
  )
  const upcoming = useMemo(() => {
    const endToday = new Date()
    endToday.setHours(24, 0, 0, 0)
    const floor = endToday.getTime()
    return events
      .filter((e) => isSalesActivity(e) && e.status === 'planned' && Date.parse(e.startsAt) >= floor)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, 12)
  }, [events])
  const missedList = useMemo(
    () => events.filter((e) => isSalesActivity(e) && isMissed(e)).sort((a, b) => b.startsAt.localeCompare(a.startsAt)).slice(0, 15),
    [events]
  )

  const notice = MODE_NOTICE[mode]
  const empty = !loading && summary.total === 0

  return (
    <div className="space-y-5">
      {/* Header + summary */}
      <Card
        title="영업활동 현황 — 회원 실시간 집계"
        icon={<Activity className="h-4 w-4" />}
        action={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700/60"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            새로고침
          </button>
        }
      >
        {notice ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-200/90">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{notice}</span>
          </div>
        ) : (
          <div className="mb-4 flex items-center gap-1.5 text-[11px] text-emerald-300/80">
            <Sparkles className="h-3.5 w-3.5" /> 회원들이 등록한 일정을 실시간으로 자동 집계 중입니다.
          </div>
        )}

        {error ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric icon={<CalendarCheck className="h-4 w-4" />} label="오늘 활동" value={`${summary.today}건`} tone="text-sky-300" />
          <Metric icon={<CalendarClock className="h-4 w-4" />} label="이번주" value={`${summary.thisWeek}건`} />
          <Metric icon={<ListChecks className="h-4 w-4" />} label="예정" value={`${summary.planned}건`} />
          <Metric icon={<CheckCircle2 className="h-4 w-4" />} label="완료" value={`${summary.done}건`} tone="text-emerald-300" />
          <Metric icon={<AlertTriangle className="h-4 w-4" />} label="놓친 활동" value={`${summary.missed}건`} tone={summary.missed > 0 ? 'text-rose-300' : 'text-slate-200'} />
          <Metric icon={<Flame className="h-4 w-4" />} label="오늘 AP" value={`${summary.apToday}건`} tone="text-amber-300" />
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>완료율 (완료 / 완료+놓침) · 전체 활동 {summary.total}건 · 취소 {summary.cancelled}건</span>
            <span className="text-emerald-300">{summary.completionRate}%</span>
          </div>
          <div className="mt-1">
            <ProgressBar value={summary.completionRate} />
          </div>
        </div>
      </Card>

      {empty ? (
        <Card title="집계할 활동 없음" icon={<Activity className="h-4 w-4" />}>
          <p className="text-sm text-slate-400">
            아직 회원들이 등록한 일정이 없습니다. 회원들이 <b>일정관리</b>에서 AP·미팅·클로징 등을 등록하면 여기에 자동으로 집계됩니다.
          </p>
        </Card>
      ) : (
        <>
          {/* 회원별 순위 + 유형별 퍼널 */}
          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="회원별 영업활동" icon={<Trophy className="h-4 w-4" />} className="lg:col-span-2"
              action={<span className="text-xs text-slate-500">{ranking.length}명</span>}>
              {ranking.length === 0 ? (
                <p className="text-sm text-slate-500">활동을 등록한 회원이 없습니다.</p>
              ) : (
                <ol className="space-y-2">
                  {ranking.map((r, i) => (
                    <li key={r.staffId} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                      <span className="w-5 shrink-0 text-center text-sm font-semibold text-slate-500">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-100">
                          {r.name} <span className="text-xs text-slate-500">· {ROLE_LABEL[r.role as UserRole] ?? r.role}</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          오늘 {r.today} · 완료 {r.done}/{r.total} · 예정 {r.planned}
                          {r.missed > 0 ? <span className="text-rose-300"> · 놓침 {r.missed}</span> : null}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-sm font-medium text-emerald-300">{r.completionRate}%</div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card title="유형별 (영업 퍼널)" icon={<Activity className="h-4 w-4" />}>
              {funnel.length === 0 ? (
                <p className="text-sm text-slate-500">활동 유형 데이터가 없습니다.</p>
              ) : (
                <div className="space-y-2.5">
                  {funnel.map((f) => (
                    <div key={f.type}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-300">{f.label}</span>
                        <span className="text-slate-400">{f.count}건</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-sky-500/70 to-indigo-500/70"
                          style={{ width: `${funnelMax > 0 ? Math.max(6, (f.count / funnelMax) * 100) : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* 오늘 일정 + 놓친 활동 */}
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="오늘 일정" icon={<CalendarCheck className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{todayList.length}건</span>}>
              {todayList.length === 0 ? (
                <p className="text-sm text-slate-500">오늘 등록된 활동이 없습니다.</p>
              ) : (
                <ul className="space-y-2">
                  {todayList.map((e) => (
                    <ActivityLine key={e.id} e={e} time={fmtTime(e.startsAt)} />
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="놓친 활동 (지난 예정)"
              icon={<AlertTriangle className="h-4 w-4" />}
              action={<span className="text-xs text-slate-500">{missedList.length}건</span>}
            >
              {missedList.length === 0 ? (
                <p className="text-sm text-emerald-300/80">놓친(지난 미완료) 활동이 없습니다.</p>
              ) : (
                <ul className="space-y-2">
                  {missedList.map((e) => (
                    <li key={e.id} className="flex items-start justify-between gap-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-rose-100">{typeLabel(e.type)} · {e.customerName ?? '고객 미지정'}</div>
                        <div className="text-[11px] text-rose-300/70">{e.staffName} · {fmtDateTime(e.startsAt)}</div>
                      </div>
                      <span className="shrink-0 rounded-full border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-300">미완료</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* 다가오는 일정 */}
          <Card title="다가오는 일정" icon={<CalendarClock className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{upcoming.length}건</span>}>
            {upcoming.length === 0 ? (
              <p className="text-sm text-slate-500">예정된 다음 일정이 없습니다.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {upcoming.map((e) => (
                  <ActivityLine key={e.id} e={e} time={fmtDateTime(e.startsAt)} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

// --- presentational helpers ------------------------------------------------

function ActivityLine({ e, time }: { e: LiveActivity; time: string }): JSX.Element {
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm text-slate-100">
          {typeLabel(e.type)} <span className="text-slate-400">· {e.customerName ?? '고객 미지정'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <Users className="h-3 w-3" /> {e.staffName}
          <span className="mx-0.5">·</span>
          <Clock className="h-3 w-3" /> {time}
          {e.location ? (
            <>
              <span className="mx-0.5">·</span>
              <MapPin className="h-3 w-3" /> <span className="truncate">{e.location}</span>
            </>
          ) : null}
        </div>
      </div>
      <span className={['shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]', STATUS_TONE[e.status] ?? STATUS_TONE.planned].join(' ')}>
        {SCHEDULE_STATUS_LABEL[e.status] ?? e.status}
      </span>
    </li>
  )
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className={['mt-1 truncate text-sm font-medium', tone ?? 'text-slate-200'].join(' ')}>{value}</div>
    </div>
  )
}
