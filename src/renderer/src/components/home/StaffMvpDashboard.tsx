import { Clock, Users, CalendarDays, BarChart3, UserRound, Bot, Sparkles, Building2 } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { ROLE_LABEL, isAdminRole } from '@renderer/navigation/roleAccess'
import ServerDbStatusPanel from '@renderer/components/admin/ServerDbStatusPanel'
import RecentAnnouncementsWidget from '@renderer/components/home/RecentAnnouncementsWidget'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'
import {
  attendanceService,
  customerService,
  performanceService,
  staffService
} from '@renderer/services/mvp'

/**
 * Role-aware staff home dashboard for the commercial MVP. Shows FC / team-leader /
 * owner-appropriate summary cards from local mock services. Clearly labelled
 * "상용 MVP 로컬 데이터" — no backend connected yet.
 */
export default function StaffMvpDashboard(): JSX.Element {
  const { session } = useSession()
  const role = session.role
  const att = attendanceService.myStatus()
  const cust = customerService.summary()

  const jarvisExamples =
    role === 'owner' || role === 'admin'
      ? ['전체 조직 현황 보여줘', '개발 작업 상태 보여줘', '릴리즈 상태 보여줘']
      : role === 'team-leader'
        ? ['팀 실적 요약해줘', '미처리 고객 보여줘', '오늘 팀 일정 알려줘']
        : ['오늘 상담 일정 보여줘', '고객 등록 도와줘', '이번 달 내 실적 알려줘']

  return (
    <div className="space-y-4">
      {/* Header + markers */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-5 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-800">{session.name} {session.position ?? ROLE_LABEL[role]}님, 안녕하세요</h1>
            <span className="rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-[10px] font-bold text-indigo-600">{ROLE_LABEL[role]}</span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500">SJ OS · 보험 업무 플랫폼{session.teamName ? ` · ${session.teamName}` : ''}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10px] font-bold text-white">직원 실사용 MVP</span>
          <span className="text-[10px] font-medium text-slate-400">상용 MVP 로컬 데이터</span>
        </div>
      </div>

      {/* Role-based summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {role === 'fc' ? (
          <>
            <Stat icon={<Clock />} label="오늘 출근 상태" value={att.status} tone="emerald" />
            <Stat icon={<CalendarDays />} label="오늘 상담 일정" value={`${cust.todayConsultations}건`} />
            <Stat icon={<UserRound />} label="미처리 고객" value={`${cust.pending}명`} tone="amber" />
            <Stat icon={<BarChart3 />} label="이번 달 실적" value={`${performanceService.mySummary().monthlyCount}건`} tone="indigo" />
          </>
        ) : role === 'team-leader' ? (
          <>
            <Stat icon={<Clock />} label="내 출근 상태" value={att.status} tone="emerald" />
            <Stat icon={<Users />} label="팀 출근 현황" value={`${staffService.attendanceToday().present}/${staffService.attendanceToday().total}명`} />
            <Stat icon={<UserRound />} label="미처리 고객" value={`${cust.pending}명`} tone="amber" />
            <Stat icon={<BarChart3 />} label="팀 실적 달성률" value={`${performanceService.teamSummary().achievementRate}%`} tone="indigo" />
          </>
        ) : (
          <>
            <Stat icon={<Users />} label="전체 출근 현황" value={`${staffService.attendanceToday().present}/${staffService.attendanceToday().total}명`} tone="emerald" />
            <Stat icon={<BarChart3 />} label="전체 실적 달성률" value={`${performanceService.companySummary().achievementRate}%`} tone="indigo" />
            <Stat icon={<UserRound />} label="고객 진행률" value={`${customerService.teamProgressRate()}%`} />
            <Stat icon={<Building2 />} label="개발/릴리즈" value="정상" tone="amber" />
          </>
        )}
      </div>

      {/* Team status (team-leader / owner) */}
      {role === 'team-leader' || role === 'owner' || role === 'admin' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-slate-700">{role === 'team-leader' ? '팀원 현황' : '팀별 현황'}</div>
          <div className="space-y-1">
            {staffService.teamStatus(session.teamName).map((m) => (
              <div key={m.name} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-1.5 text-xs">
                <span className="font-medium text-slate-700">{m.name}</span>
                <span className="text-slate-500">{m.attendance} · 오늘 상담 {m.todayConsultations}건 · 이번 달 {m.monthlyCount}건</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Recent announcements */}
      <RecentAnnouncementsWidget />

      {/* Server/DB status + commercial readiness — owner/admin only */}
      {isAdminRole(role) ? <ServerDbStatusPanel /> : null}

      {/* Jarvis quick launch */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-blue-50 p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><Bot className="h-4 w-4 text-indigo-600" /> 자비스 빠른 실행</div>
        <div className="flex flex-wrap gap-1.5">
          {jarvisExamples.map((ex) => (
            <button key={ex} type="button" onClick={() => jarvisService.open()} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-medium text-indigo-700 transition hover:bg-indigo-100">
              <Sparkles className="h-3 w-3" /> {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Stat({ icon, label, value, tone }: { icon: JSX.Element; label: string; value: string; tone?: 'emerald' | 'indigo' | 'amber' }): JSX.Element {
  const t = tone === 'emerald' ? 'text-emerald-600' : tone === 'indigo' ? 'text-indigo-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-700'
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={['mb-1 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-50 [&>svg]:h-4 [&>svg]:w-4', t].join(' ')}>{icon}</div>
      <div className={['text-lg font-bold', t].join(' ')}>{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  )
}
