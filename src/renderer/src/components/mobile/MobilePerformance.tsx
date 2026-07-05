import { BarChart3 } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { performanceService } from '@renderer/services/mvp'

/**
 * Mobile performance summary (role-aware, local mock). Real performance DB
 * integration is a later sprint; this is a read-only summary.
 */
export default function MobilePerformance(): JSX.Element {
  const { session } = useSession()
  const p = session.role === 'fc' ? performanceService.mySummary() : session.role === 'team-leader' ? performanceService.teamSummary() : performanceService.companySummary()
  const scope = session.role === 'fc' ? '내 실적' : session.role === 'team-leader' ? '팀 실적' : '전체 실적'

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-indigo-500" />
        <h1 className="text-lg font-bold text-slate-800">실적관리</h1>
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-600">로컬 MVP 데이터</span>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-700">{scope}</div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-center">
          <Stat label="건수" value={`${p.monthlyCount}건`} />
          <Stat label="달성률" value={`${p.achievementRate}%`} tone />
          <Stat label="보험료" value={p.monthlyPremium} />
          <Stat label="목표" value={p.target} />
        </div>
      </div>
      <p className="text-center text-[11px] text-slate-400">실적 서버 연동은 다음 단계에서 진행됩니다.</p>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: boolean }): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <div className={['text-base font-bold', tone ? 'text-emerald-600' : 'text-slate-700'].join(' ')}>{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  )
}
