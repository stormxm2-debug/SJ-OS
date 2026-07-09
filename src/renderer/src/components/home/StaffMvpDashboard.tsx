import { Clock, Users, CalendarDays, BarChart3, UserRound, Bot, Sparkles, Building2 } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { ROLE_LABEL } from '@renderer/navigation/roleAccess'
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
 * owner-appropriate summary cards from local mock services.
 *
 * Styling = "Direction A" (deep navy + gold, bright surfaces). NOTE: this app remaps
 * the `slate` scale to a light theme, so dark text uses text-slate-100/300/500 and
 * light surfaces use bg-white / bg-slate-950; the greeting banner uses explicit hex
 * so it stays reliably dark with white text.
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
          <div className="flex flex-col items-end gap-1">
            <span className="rounded-full bg-[#c6982f] px-2.5 py-0.5 text-[10px] font-bold text-[#201603]">직원 실사용 MVP</span>
            <span className="text-[10px] font-medium text-white/45">상용 MVP 로컬 데이터</span>
          </div>
        </div>
      </div>

      {/* Role-based summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {role === 'fc' ? (
          <>
            <Stat icon={<Clock />} label="오늘 출근 상태" value={att.status} tone="emerald" />
            <Stat icon={<CalendarDays />} label="오늘 상담 일정" value={`${cust.todayConsultations}건`} tone="indigo" />
            <Stat icon={<UserRound />} label="미처리 고객" value={`${cust.pending}명`} tone="amber" />
            <Stat icon={<BarChart3 />} label="이번 달 실적" value={`${performanceService.mySummary().monthlyCount}건`} tone="indigo" />
          </>
        ) : role === 'team-leader' ? (
          <>
            <Stat icon={<Clock />} label="내 출근 상태" value={att.status} tone="emerald" />
            <Stat icon={<Users />} label="팀 출근 현황" value={`${staffService.attendanceToday().present}/${staffService.attendanceToday().total}명`} tone="indigo" />
            <Stat icon={<UserRound />} label="미처리 고객" value={`${cust.pending}명`} tone="amber" />
            <Stat icon={<BarChart3 />} label="팀 실적 달성률" value={`${performanceService.teamSummary().achievementRate}%`} tone="indigo" />
          </>
        ) : (
          <>
            <Stat icon={<Users />} label="전체 출근 현황" value={`${staffService.attendanceToday().present}/${staffService.attendanceToday().total}명`} tone="emerald" />
            <Stat icon={<BarChart3 />} label="전체 실적 달성률" value={`${performanceService.companySummary().achievementRate}%`} tone="indigo" />
            <Stat icon={<UserRound />} label="고객 진행률" value={`${customerService.teamProgressRate()}%`} tone="gold" />
            <Stat icon={<Building2 />} label="개발/릴리즈" value="정상" tone="emerald" />
          </>
        )}
      </div>

      {/* Team status (team-leader / owner) */}
      {role === 'team-leader' || role === 'owner' || role === 'admin' ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
          <div className="mb-2 text-sm font-bold text-slate-100">{role === 'team-leader' ? '팀원 현황' : '팀별 현황'}</div>
          <div className="space-y-1">
            {staffService.teamStatus(session.teamName).map((m) => (
              <div key={m.name} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs">
                <span className="font-semibold text-slate-200">{m.name}</span>
                <span className="text-slate-500">{m.attendance} · 오늘 상담 {m.todayConsultations}건 · 이번 달 {m.monthlyCount}건</span>
              </div>
            ))}
            {staffService.teamStatus(session.teamName).length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-700 py-4 text-center text-[11px] text-slate-500">등록된 팀원이 없습니다.</div>
            ) : null}
          </div>
        </div>
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

function Stat({ icon, label, value, tone }: { icon: JSX.Element; label: string; value: string; tone?: 'emerald' | 'indigo' | 'amber' | 'gold' }): JSX.Element {
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
    <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
      <div className={['mb-2 flex h-8 w-8 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4', tile].join(' ')}>{icon}</div>
      <div className={['text-lg font-bold tabular-nums tracking-tight', val].join(' ')}>{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{label}</div>
    </div>
  )
}
