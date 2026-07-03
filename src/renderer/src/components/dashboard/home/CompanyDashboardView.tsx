import { Activity, BellRing, CalendarDays, BriefcaseBusiness, CircleDollarSign, Users, RefreshCw, AlertTriangle, Sparkles, ShieldCheck, Target } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { companyDashboardService, useCompanyDashboardWidget } from '@renderer/services/company/companyDashboardService'
import { fcRepository, formatKrw } from '@renderer/services/fc/FcRepository'
import { useFc } from '@renderer/services/fc/useFc'
import type { ActivityRecord, AppointmentRecord, CustomerRecord, FcRecord, NotificationRecord, SalesRecord, TaskRecord } from '@shared/company/types'

function WidgetState({ status, error }: { status: string; error: string | null }) {
  if (status === 'loading') {
    return <div className="text-sm text-slate-500">불러오는 중…</div>
  }
  if (status === 'error') {
    return <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">{error ?? '위젯 데이터를 불러올 수 없습니다.'}</div>
  }
  if (status === 'empty') {
    return <div className="text-sm text-slate-500">데이터 없음.</div>
  }
  return null
}

export default function CompanyDashboardView(): JSX.Element {
  useFc() // re-render when the FC OS changes
  const fcSummary = fcRepository.getSummary()
  const sales = useCompanyDashboardWidget(() => companyDashboardService.loadSalesToday())
  const premium = useCompanyDashboardWidget(() => companyDashboardService.loadPremiumToday())
  const attendance = useCompanyDashboardWidget(() => companyDashboardService.loadFcAttendance())
  const online = useCompanyDashboardWidget(() => companyDashboardService.loadFcOnline())
  const tasks = useCompanyDashboardWidget(() => companyDashboardService.loadPendingTasks())
  const notifications = useCompanyDashboardWidget(() => companyDashboardService.loadUnreadNotifications())
  const schedule = useCompanyDashboardWidget(() => companyDashboardService.loadTodaySchedule())
  const contracts = useCompanyDashboardWidget(() => companyDashboardService.loadRecentContracts())
  const customers = useCompanyDashboardWidget(() => companyDashboardService.loadRecentCustomers())
  const activity = useCompanyDashboardWidget(() => companyDashboardService.loadActivityFeed())
  const summary = useCompanyDashboardWidget(() => companyDashboardService.loadSummary())

  const summaryCards = [
    { label: '오늘 매출', value: summary.status === 'success' ? summary.data.salesToday : '—', hint: '리포지토리 기반 요약' },
    { label: '오늘 보험료', value: summary.status === 'success' ? summary.data.premiumToday : '—', hint: '매출에서 집계' },
    { label: 'FC 온라인', value: summary.status === 'success' ? String(summary.data.onlineFc) : '—', hint: '실시간 FC 가용성' },
    { label: '대기 작업', value: summary.status === 'success' ? String(summary.data.pendingTasks) : '—', hint: '열린 작업 대기열' },
    { label: '미확인 알림', value: summary.status === 'success' ? String(summary.data.unreadNotifications) : '—', hint: '주의가 필요한 알림' }
  ]

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-indigo-700/40 bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 p-6 shadow-lg shadow-indigo-500/30">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-white">
              <Sparkles className="h-3.5 w-3.5" />
              실시간 회사 대시보드
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">CEO 관제 센터</h1>
            <p className="mt-2 max-w-2xl text-sm text-indigo-100">모든 위젯은 공유 회사 리포지토리로 구동되며 독립적으로 새로고침됩니다.</p>
          </div>
          <button type="button" onClick={() => { void companyDashboardService.refreshAll() }} className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/15 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/25">
            <RefreshCw className="h-4 w-4" />
            전체 새로고침
          </button>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-sm font-medium text-slate-200">{card.label}</div>
            <div className="mt-2 text-2xl font-semibold text-slate-100">{card.value}</div>
            <div className="mt-2 text-sm text-slate-500">{card.hint}</div>
          </div>
        ))}
      </div>

      <Card title="FC OS 요약" icon={<BriefcaseBusiness className="h-4 w-4 text-indigo-300" />} action={<span className="text-xs text-slate-500">SJ Invest 조직 현황</span>}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center gap-1.5 text-sm text-slate-400"><Users className="h-4 w-4" /> FC 수</div>
            <div className="mt-2 text-2xl font-semibold text-slate-100">{fcSummary.totalFc}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center gap-1.5 text-sm text-slate-400"><BriefcaseBusiness className="h-4 w-4" /> 출근</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-300">{fcSummary.checkedIn}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center gap-1.5 text-sm text-slate-400"><CircleDollarSign className="h-4 w-4" /> 월 보험료</div>
            <div className="mt-2 text-2xl font-semibold text-slate-100">{formatKrw(fcSummary.monthlyPremiumTotal)}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center gap-1.5 text-sm text-slate-400"><Target className="h-4 w-4" /> 목표 달성</div>
            <div className="mt-2 text-2xl font-semibold text-slate-100">{fcSummary.achievementRate}%</div>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Card title="오늘의 매출" icon={<CircleDollarSign className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void sales.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">새로고침</button>}>
            <WidgetState status={sales.status} error={sales.error} />
            {sales.status === 'success' && sales.data.map((item: SalesRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.customerId} · {item.amount.toLocaleString('ko-KR')} KRW</div>)}
          </Card>

          <Card title="FC 출근" icon={<BriefcaseBusiness className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void attendance.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">새로고침</button>}>
            <WidgetState status={attendance.status} error={attendance.error} />
            {attendance.status === 'success' && attendance.data.map((item: FcRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.name} · {item.attendance} · {item.status}</div>)}
          </Card>

          <Card title="오늘의 일정" icon={<CalendarDays className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void schedule.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">새로고침</button>}>
            <WidgetState status={schedule.status} error={schedule.error} />
            {schedule.status === 'success' && schedule.data.map((item: AppointmentRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.title} · {item.scheduledAt}</div>)}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="현재 FC 온라인" icon={<Users className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void online.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">새로고침</button>}>
            <WidgetState status={online.status} error={online.error} />
            {online.status === 'success' && online.data.map((item: FcRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.name}</div>)}
          </Card>

          <Card title="대기 작업" icon={<ShieldCheck className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void tasks.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">새로고침</button>}>
            <WidgetState status={tasks.status} error={tasks.error} />
            {tasks.status === 'success' && tasks.data.map((item: TaskRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.title} · {item.priority}</div>)}
          </Card>

          <Card title="읽지 않은 알림" icon={<BellRing className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void notifications.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">새로고침</button>}>
            <WidgetState status={notifications.status} error={notifications.error} />
            {notifications.status === 'success' && notifications.data.map((item: NotificationRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.title}</div>)}
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="최근 계약" icon={<CircleDollarSign className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void contracts.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">새로고침</button>}>
          <WidgetState status={contracts.status} error={contracts.error} />
          {contracts.status === 'success' && contracts.data.map((item: SalesRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.policyId} · {item.amount.toLocaleString('ko-KR')} KRW</div>)}
        </Card>

        <Card title="최근 고객" icon={<Users className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void customers.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">새로고침</button>}>
          <WidgetState status={customers.status} error={customers.error} />
          {customers.status === 'success' && customers.data.map((item: CustomerRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.name} · {item.tier}</div>)}
        </Card>
      </div>

      <Card title="회사 활동 피드" icon={<Activity className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void activity.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">새로고침</button>}>
        <WidgetState status={activity.status} error={activity.error} />
        {activity.status === 'success' && activity.data.map((item: ActivityRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.summary} · {item.createdAt}</div>)}
      </Card>
    </div>
  )
}
