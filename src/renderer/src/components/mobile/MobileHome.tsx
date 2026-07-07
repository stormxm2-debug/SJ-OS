import { Clock, UserPlus, ClipboardList, CalendarDays, BarChart3, Bot, Users } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { ROLE_LABEL } from '@renderer/navigation/roleAccess'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'
import { attendanceService, customerService, performanceService, staffService } from '@renderer/services/mvp'
import RecentAnnouncementsWidget from '@renderer/components/home/RecentAnnouncementsWidget'

/**
 * Mobile staff home (role-aware). Quick actions + local/mock summaries. Staff-only —
 * no developer/release/deployment tooling. Uses local mock services (labelled
 * "로컬 MVP 데이터"); real data comes through the shared Supabase managers per page.
 */
export default function MobileHome(): JSX.Element {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const role = session.role
  const att = attendanceService.myStatus()
  const cust = customerService.summary()

  const quick = [
    { label: '출퇴근', icon: <Clock className="h-5 w-5" />, onClick: () => navigate({ name: 'attendance' }) },
    { label: '고객 등록', icon: <UserPlus className="h-5 w-5" />, onClick: () => navigate({ name: 'customer' }) },
    { label: '상담 작성', icon: <ClipboardList className="h-5 w-5" />, onClick: () => navigate({ name: 'consultation' }) },
    { label: '일정', icon: <CalendarDays className="h-5 w-5" />, onClick: () => navigate({ name: 'schedule' }) }
  ]

  return (
    <div className="space-y-3">
      {/* Greeting */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-slate-100">{session.name || '직원'}님</h1>
          <span className="rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-[10px] font-bold text-indigo-600">{ROLE_LABEL[role]}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
          <span>SJ OS 모바일</span>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-600">로컬 MVP 데이터</span>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-2">
        {quick.map((q) => (
          <button key={q.label} type="button" onClick={q.onClick} className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200 bg-white py-3 text-slate-300 transition active:bg-slate-50">
            <span className="text-indigo-500">{q.icon}</span>
            <span className="text-[11px] font-medium">{q.label}</span>
          </button>
        ))}
      </div>

      {/* Role-based summary */}
      <div className="grid grid-cols-2 gap-2">
        {role === 'fc' ? (
          <>
            <Card icon={<Clock />} label="오늘 출근" value={att.status} tone="emerald" />
            <Card icon={<CalendarDays />} label="오늘 상담" value={`${cust.todayConsultations}건`} />
            <Card icon={<Users />} label="미처리 고객" value={`${cust.pending}명`} tone="amber" />
            <Card icon={<BarChart3 />} label="이번 달 실적" value={`${performanceService.mySummary().monthlyCount}건`} tone="indigo" />
          </>
        ) : role === 'team-leader' ? (
          <>
            <Card icon={<Users />} label="팀 출근" value={`${staffService.attendanceToday().present}/${staffService.attendanceToday().total}`} tone="emerald" />
            <Card icon={<CalendarDays />} label="오늘 상담" value={`${cust.todayConsultations}건`} />
            <Card icon={<Users />} label="미처리 고객" value={`${cust.pending}명`} tone="amber" />
            <Card icon={<BarChart3 />} label="팀 달성률" value={`${performanceService.teamSummary().achievementRate}%`} tone="indigo" />
          </>
        ) : (
          <>
            <Card icon={<Users />} label="전체 출근" value={`${staffService.attendanceToday().present}/${staffService.attendanceToday().total}`} tone="emerald" />
            <Card icon={<BarChart3 />} label="전체 달성률" value={`${performanceService.companySummary().achievementRate}%`} tone="indigo" />
            <Card icon={<Users />} label="고객 진행률" value={`${customerService.teamProgressRate()}%`} />
            <Card icon={<CalendarDays />} label="오늘 상담" value={`${cust.todayConsultations}건`} tone="amber" />
          </>
        )}
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
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className={['mb-1 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-50 [&>svg]:h-4 [&>svg]:w-4', t].join(' ')}>{icon}</div>
      <div className={['text-lg font-bold', t].join(' ')}>{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  )
}
