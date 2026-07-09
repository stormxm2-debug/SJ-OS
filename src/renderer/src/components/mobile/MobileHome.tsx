import { useEffect, useState } from 'react'
import { Clock, UserPlus, ClipboardList, CalendarDays, Bot, Users, UserRound } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { ROLE_LABEL, isAdminRole } from '@renderer/navigation/roleAccess'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'
import RecentAnnouncementsWidget from '@renderer/components/home/RecentAnnouncementsWidget'
import {
  getAttendanceSummary,
  listAttendanceRecords,
  listMyTodayAttendance
} from '@renderer/services/commercial/attendanceService'
import { listCustomers } from '@renderer/services/commercial/customerService'
import { listConsultations, filterToday as todayConsultations } from '@renderer/services/commercial/consultationService'
import { listScheduleEvents, filterToday as todaySchedules } from '@renderer/services/commercial/scheduleService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

/** Tables whose changes should live-refresh the home summary (stable ref for the hook). */
const RT_TABLES = ['attendance_records', 'customers', 'consultations', 'schedule_events']

interface HomeSummary {
  mode: 'supabase' | 'local'
  myWorkState: '출근 전' | '근무중' | '퇴근 완료'
  attendanceRatio: string
  todaySchedules: number
  todayConsultations: number
  customers: number
}

const EMPTY: HomeSummary = {
  mode: 'local',
  myWorkState: '출근 전',
  attendanceRatio: '-',
  todaySchedules: 0,
  todayConsultations: 0,
  customers: 0
}

/**
 * Mobile staff home (role-aware). Quick actions + REAL summaries through the same
 * commercial services the full pages use (Supabase when configured, local-mock
 * otherwise) — RLS already scopes each list to the viewer's role, so the numbers
 * here are per-person for FC, per-team for team leaders, and company-wide for the
 * owner. Live-refreshes via realtime sync like every other screen.
 */
export default function MobileHome(): JSX.Element {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const role = session.role
  const [sum, setSum] = useState<HomeSummary>(EMPTY)

  const load = async (): Promise<void> => {
    const [all, my, cust, cons, sched] = await Promise.all([
      listAttendanceRecords(),
      listMyTodayAttendance(),
      listCustomers(),
      listConsultations(),
      listScheduleEvents()
    ])
    const hasIn = my.records.some((r) => r.type === 'check-in')
    const hasOut = my.records.some((r) => r.type === 'check-out')
    const att = getAttendanceSummary(all.records)
    setSum({
      mode: all.mode === 'supabase' ? 'supabase' : 'local',
      myWorkState: !hasIn ? '출근 전' : hasOut ? '퇴근 완료' : '근무중',
      attendanceRatio: att.total > 0 ? `${att.checkedIn}/${att.total}` : '-',
      todaySchedules: todaySchedules(sched.events).length,
      todayConsultations: todayConsultations(cons.consultations).length,
      customers: cust.customers.length
    })
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useRealtimeSync(RT_TABLES, load)

  const quick = [
    { label: '출퇴근', icon: <Clock className="h-5 w-5" />, onClick: () => navigate({ name: 'attendance' }) },
    { label: '고객 등록', icon: <UserPlus className="h-5 w-5" />, onClick: () => navigate({ name: 'customer' }) },
    { label: '상담 작성', icon: <ClipboardList className="h-5 w-5" />, onClick: () => navigate({ name: 'consultation' }) },
    { label: '일정', icon: <CalendarDays className="h-5 w-5" />, onClick: () => navigate({ name: 'schedule' }) }
  ]

  const teamScope = isAdminRole(role) ? '전체' : role === 'team-leader' ? '팀' : '내'

  return (
    <div className="space-y-3">
      {/* Greeting */}
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-r from-blue-50 to-indigo-50 p-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-slate-100">{session.name || '직원'}님</h1>
          <span className="rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-[10px] font-bold text-indigo-600">{ROLE_LABEL[role]}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
          <span>SJ INVEST 모바일</span>
          {sum.mode === 'supabase' ? (
            <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-600">실시간 연동</span>
          ) : (
            <span className="rounded-full border border-slate-700 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-400">로컬 데이터</span>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-2">
        {quick.map((q) => (
          <button key={q.label} type="button" onClick={q.onClick} className="flex flex-col items-center gap-1 rounded-2xl border border-slate-800 bg-white py-3 text-slate-300 transition active:bg-slate-950">
            <span className="text-indigo-500">{q.icon}</span>
            <span className="text-[11px] font-medium">{q.label}</span>
          </button>
        ))}
      </div>

      {/* Role-scoped summary (RLS already narrows each list to the viewer). */}
      <div className="grid grid-cols-2 gap-2">
        {role === 'fc' ? (
          <Card icon={<Clock />} label="오늘 출근" value={sum.myWorkState} tone="emerald" />
        ) : (
          <Card icon={<Users />} label={`${teamScope} 출근`} value={sum.attendanceRatio} tone="emerald" />
        )}
        <Card icon={<CalendarDays />} label="오늘 일정" value={`${sum.todaySchedules}건`} tone="indigo" />
        <Card icon={<ClipboardList />} label="오늘 상담" value={`${sum.todayConsultations}건`} tone="amber" />
        <Card icon={<UserRound />} label={`${teamScope} 고객`} value={`${sum.customers}명`} tone="indigo" />
      </div>

      {/* Recent announcements */}
      <RecentAnnouncementsWidget />

      {/* Jarvis */}
      <button type="button" onClick={() => jarvisService.open()} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3 text-sm font-semibold text-white">
        <Bot className="h-4 w-4" /> 자비스 도움받기
      </button>

    </div>
  )
}

function Card({ icon, label, value, tone }: { icon: JSX.Element; label: string; value: string; tone?: 'emerald' | 'indigo' | 'amber' }): JSX.Element {
  const t = tone === 'emerald' ? 'text-emerald-600' : tone === 'indigo' ? 'text-indigo-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-300'
  return (
    <div className="rounded-2xl border border-slate-800 bg-white p-3">
      <div className={['mb-1 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-950 [&>svg]:h-4 [&>svg]:w-4', t].join(' ')}>{icon}</div>
      <div className={['text-lg font-bold tabular-nums', t].join(' ')}>{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  )
}
