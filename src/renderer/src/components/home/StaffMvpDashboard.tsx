import { useEffect, useState } from 'react'
import { Clock, Users, CalendarDays, UserRound, Bot, Sparkles, PhoneCall, ChevronRight } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { ROLE_LABEL, isAdminRole } from '@renderer/navigation/roleAccess'
import RecentAnnouncementsWidget from '@renderer/components/home/RecentAnnouncementsWidget'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'
import { listMyTodayAttendance, listAttendanceRecords } from '@renderer/services/commercial/attendanceService'
import { listScheduleEvents, filterToday } from '@renderer/services/commercial/scheduleService'
import { listCustomers } from '@renderer/services/commercial/customerService'
import { listAllLeads, listMyLeads } from '@renderer/services/commercial/leadService'
import { listOverviewStaff } from '@renderer/services/commercial/staffOverviewService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'
import type { View } from '@renderer/navigation/types'

/**
 * Role-aware staff home dashboard — 2026-07-13 목업 수치를 전부 실데이터로 교체.
 * FC: 내 출근/오늘 내 일정/내 고객/미콜 DB · 팀장: 팀 출근 포함 · 대표/관리자: 전체.
 * 카드를 누르면 해당 화면으로 이동. (기존 services/mvp 로컬 목업 의존 제거)
 *
 * Styling = "Direction A" (deep navy + gold, bright surfaces). NOTE: this app remaps
 * the `slate` scale to a light theme, so dark text uses text-slate-100/300/500 and
 * light surfaces use bg-white / bg-slate-950; the greeting banner uses explicit hex
 * so it stays reliably dark with white text.
 */

const RT_TABLES = ['attendance_records', 'schedule_events', 'leads']

interface DashStats {
  myAttendance: string
  myAttendanceDone: boolean
  todayMySchedules: number
  todayAllSchedules: number
  customerCount: number
  uncalledLeads: number
  presentStaff: number
  totalStaff: number
}

function hhmm(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function StaffMvpDashboard(): JSX.Element {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const role = session.role
  const admin = isAdminRole(role)
  const [stats, setStats] = useState<DashStats | null>(null)

  const load = async (): Promise<void> => {
    const wantRoster = admin || role === 'team-leader'
    const [myToday, sch, cust, leadsRes, staff, allAtt] = await Promise.all([
      listMyTodayAttendance(),
      listScheduleEvents(),
      listCustomers(),
      admin ? listAllLeads() : listMyLeads(),
      wantRoster ? listOverviewStaff() : Promise.resolve([]),
      wantRoster ? listAttendanceRecords() : Promise.resolve(null)
    ])
    const rin = myToday.records.find((r) => r.type === 'check-in')
    const rout = myToday.records.find((r) => r.type === 'check-out')
    const events = sch.ok ? sch.events : []
    const todayEvents = filterToday(events).filter((e) => e.status !== 'cancelled')
    // 오늘 출근 인원 (RLS: 팀장=팀, 관리자=전체) — 같은 사람 중복 출근은 1명으로.
    const todayKey = new Date().toDateString()
    const present = allAtt
      ? new Set(allAtt.records.filter((r) => r.type === 'check-in' && new Date(r.timestamp).toDateString() === todayKey).map((r) => r.staffId)).size
      : 0
    const scopedStaff =
      role === 'team-leader' ? staff.filter((s) => s.teamId && s.teamId === session.teamName) : staff.filter((s) => s.role === 'fc' || s.role === 'team-leader')
    setStats({
      myAttendance: rout ? `퇴근 ${hhmm(rout.timestamp)}` : rin ? `출근 ${hhmm(rin.timestamp)}` : '미출근',
      myAttendanceDone: Boolean(rin),
      todayMySchedules: todayEvents.filter((e) => e.staffId === session.id).length,
      todayAllSchedules: todayEvents.length,
      customerCount: cust.ok ? cust.customers.length : 0,
      uncalledLeads: leadsRes.ok ? leadsRes.leads.filter((l) => l.status === 'new' && !l.firstCallAt).length : 0,
      presentStaff: present,
      totalStaff: scopedStaff.length
    })
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, role])
  useRealtimeSync(RT_TABLES, () => void load())

  const jarvisExamples =
    role === 'owner' || role === 'admin'
      ? ['전체 조직 현황 보여줘', '오늘 일정 요약해줘', '이번 달 매출 보여줘']
      : role === 'team-leader'
        ? ['팀 실적 요약해줘', '오늘 팀 일정 알려줘', '이번 달 내 실적 알려줘']
        : ['오늘 상담 일정 보여줘', '고객 등록 도와줘', '이번 달 내 실적 알려줘']

  const go = (view: View): void => navigate(view)
  const dash = (n: number | undefined): string => (stats ? String(n ?? 0) : '…')

  return (
    <div className="space-y-4">
      {/* Greeting banner — deep navy + gold hairline */}
      <div
        className="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg ring-1 ring-black/5"
        style={{
          background:
            'radial-gradient(560px 200px at 90% -40%, rgba(198,152,47,0.18), rgba(198,152,47,0) 60%), linear-gradient(120deg, #0e1e3a 0%, #16294b 65%, #1d2f57 100%)'
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#c6982f] to-transparent opacity-80" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white">
                {session.name} {session.position ?? ROLE_LABEL[role]}님, 안녕하세요
              </h1>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white ring-1 ring-white/20">
                {ROLE_LABEL[role]}
              </span>
            </div>
            <p className="mt-1 text-sm text-white/70">
              SJ INVEST · 보험 업무 플랫폼{session.teamName ? ` · ${session.teamName}` : ''}
            </p>
          </div>
          <span className="rounded-full bg-[#c6982f] px-2.5 py-0.5 text-[10px] font-bold text-[#201603]">실시간 현황</span>
        </div>
      </div>

      {/* Role-based summary cards — 전부 실데이터, 클릭=해당 화면 이동 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {admin ? (
          <>
            <Stat icon={<Users />} label="오늘 출근 (전 직원)" value={stats ? `${stats.presentStaff}/${stats.totalStaff}명` : '…'} tone="emerald" onClick={() => go({ name: 'attendance' })} />
            <Stat icon={<CalendarDays />} label="오늘 전체 일정" value={`${dash(stats?.todayAllSchedules)}건`} tone="indigo" onClick={() => go({ name: 'shared-schedule' })} />
            <Stat icon={<UserRound />} label="전체 고객" value={`${dash(stats?.customerCount)}명`} tone="gold" onClick={() => go({ name: 'customer' })} />
            <Stat icon={<PhoneCall />} label="미콜 DB" value={`${dash(stats?.uncalledLeads)}건`} tone={stats && stats.uncalledLeads > 0 ? 'amber' : 'emerald'} onClick={() => go({ name: 'leads' })} />
          </>
        ) : role === 'team-leader' ? (
          <>
            <Stat icon={<Clock />} label="내 출근" value={stats?.myAttendance ?? '…'} tone={stats?.myAttendanceDone ? 'emerald' : 'amber'} onClick={() => go({ name: 'attendance' })} />
            <Stat icon={<Users />} label="오늘 팀 출근" value={stats ? `${stats.presentStaff}${stats.totalStaff > 0 ? `/${stats.totalStaff}` : ''}명` : '…'} tone="indigo" onClick={() => go({ name: 'attendance' })} />
            <Stat icon={<CalendarDays />} label="오늘 내 일정" value={`${dash(stats?.todayMySchedules)}건`} tone="indigo" onClick={() => go({ name: 'schedule' })} />
            <Stat icon={<PhoneCall />} label="미콜 DB (내)" value={`${dash(stats?.uncalledLeads)}건`} tone={stats && stats.uncalledLeads > 0 ? 'amber' : 'emerald'} onClick={() => go({ name: 'leads' })} />
          </>
        ) : (
          <>
            <Stat icon={<Clock />} label="오늘 출근" value={stats?.myAttendance ?? '…'} tone={stats?.myAttendanceDone ? 'emerald' : 'amber'} onClick={() => go({ name: 'attendance' })} />
            <Stat icon={<CalendarDays />} label="오늘 내 일정" value={`${dash(stats?.todayMySchedules)}건`} tone="indigo" onClick={() => go({ name: 'schedule' })} />
            <Stat icon={<UserRound />} label="내 고객" value={`${dash(stats?.customerCount)}명`} tone="gold" onClick={() => go({ name: 'customer' })} />
            <Stat icon={<PhoneCall />} label="미콜 DB (내)" value={`${dash(stats?.uncalledLeads)}건`} tone={stats && stats.uncalledLeads > 0 ? 'amber' : 'emerald'} onClick={() => go({ name: 'leads' })} />
          </>
        )}
      </div>

      {/* 직원별 상세는 직원 현황 페이지에서 (목업 팀원 리스트 제거) */}
      {admin ? (
        <button
          type="button"
          onClick={() => go({ name: 'staff-overview' })}
          className="flex w-full items-center justify-between rounded-2xl border border-slate-800 bg-white px-4 py-3 text-left shadow-sm transition hover:border-[#c6982f]"
        >
          <span className="flex items-center gap-2 text-sm font-bold text-slate-100">
            <Users className="h-4 w-4 text-[#b0821f]" /> 직원별 상세 현황 보기
            <span className="text-[11px] font-medium text-slate-500">고객·일정·실적·출퇴근 전체</span>
          </span>
          <ChevronRight className="h-4 w-4 text-slate-400" />
        </button>
      ) : null}

      {/* Recent announcements */}
      <RecentAnnouncementsWidget />

      {/* Jarvis quick launch — navy premium strip */}
      <div
        className="relative overflow-hidden rounded-2xl p-4 text-white shadow-sm ring-1 ring-black/5"
        style={{ background: 'linear-gradient(120deg, #0e1e3a 0%, #1a2c50 100%)' }}
      >
        <div className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
          <Bot className="h-4 w-4 text-[#e6c877]" /> 자비스 빠른 실행
        </div>
        <div className="flex flex-wrap gap-1.5">
          {jarvisExamples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => jarvisService.open()}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white ring-1 ring-white/20 transition hover:bg-white/20"
            >
              <Sparkles className="h-3 w-3 text-[#e6c877]" /> {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
  tone,
  onClick
}: {
  icon: JSX.Element
  label: string
  value: string
  tone?: 'emerald' | 'indigo' | 'amber' | 'gold'
  onClick?: () => void
}): JSX.Element {
  const tile =
    tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-600'
      : tone === 'indigo'
        ? 'bg-indigo-50 text-indigo-600'
        : tone === 'amber'
          ? 'bg-amber-50 text-amber-600'
          : tone === 'gold'
            ? 'bg-[#f4ecd6] text-[#b0821f]'
            : 'bg-slate-950 text-slate-300'
  const val =
    tone === 'emerald'
      ? 'text-emerald-600'
      : tone === 'indigo'
        ? 'text-indigo-600'
        : tone === 'amber'
          ? 'text-amber-600'
          : tone === 'gold'
            ? 'text-[#b0821f]'
            : 'text-slate-100'
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-slate-800 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#c6982f] hover:shadow-md"
    >
      <div className={['mb-2 flex h-8 w-8 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4', tile].join(' ')}>{icon}</div>
      <div className={['text-lg font-bold tabular-nums tracking-tight', val].join(' ')}>{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{label}</div>
    </button>
  )
}
