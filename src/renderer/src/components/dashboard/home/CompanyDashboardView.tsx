import { Activity, BellRing, CalendarDays, BriefcaseBusiness, CircleDollarSign, Users, RefreshCw, AlertTriangle, Sparkles, ShieldCheck } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { companyDashboardService, useCompanyDashboardWidget } from '@renderer/services/company/companyDashboardService'
import type { ActivityRecord, AppointmentRecord, CustomerRecord, FcRecord, NotificationRecord, SalesRecord, TaskRecord } from '@shared/company/types'

function WidgetState({ status, error }: { status: string; error: string | null }) {
  if (status === 'loading') {
    return <div className="text-sm text-slate-500">Loading…</div>
  }
  if (status === 'error') {
    return <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">{error ?? 'Unable to load widget data.'}</div>
  }
  if (status === 'empty') {
    return <div className="text-sm text-slate-500">No data available.</div>
  }
  return null
}

export default function CompanyDashboardView(): JSX.Element {
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
    { label: 'Today Sales', value: summary.status === 'success' ? summary.data.salesToday : '—', hint: 'Repository-backed summary' },
    { label: 'Today Premium', value: summary.status === 'success' ? summary.data.premiumToday : '—', hint: 'Aggregated from sales' },
    { label: 'FC Online', value: summary.status === 'success' ? String(summary.data.onlineFc) : '—', hint: 'Live FC availability' },
    { label: 'Pending Tasks', value: summary.status === 'success' ? String(summary.data.pendingTasks) : '—', hint: 'Open work queue' },
    { label: 'Unread Notifications', value: summary.status === 'success' ? String(summary.data.unreadNotifications) : '—', hint: 'Alerts requiring attention' }
  ]

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/70 p-6 shadow-lg shadow-slate-950/30">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-indigo-300">
              <Sparkles className="h-3.5 w-3.5" />
              Live Company Dashboard
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">CEO control center</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Every widget is powered by the shared company repository and refreshes independently.</p>
          </div>
          <button type="button" onClick={() => { void companyDashboardService.refreshAll() }} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-300 transition hover:border-indigo-500/40 hover:text-white">
            <RefreshCw className="h-4 w-4" />
            Refresh all
          </button>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-sm font-medium text-slate-200">{card.label}</div>
            <div className="mt-2 text-2xl font-semibold text-white">{card.value}</div>
            <div className="mt-2 text-sm text-slate-500">{card.hint}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Card title="Today’s Sales" icon={<CircleDollarSign className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void sales.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">Refresh</button>}>
            <WidgetState status={sales.status} error={sales.error} />
            {sales.status === 'success' && sales.data.map((item: SalesRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.customerId} · {item.amount.toLocaleString('ko-KR')} KRW</div>)}
          </Card>

          <Card title="FC Attendance" icon={<BriefcaseBusiness className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void attendance.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">Refresh</button>}>
            <WidgetState status={attendance.status} error={attendance.error} />
            {attendance.status === 'success' && attendance.data.map((item: FcRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.name} · {item.attendance} · {item.status}</div>)}
          </Card>

          <Card title="Today’s Schedule" icon={<CalendarDays className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void schedule.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">Refresh</button>}>
            <WidgetState status={schedule.status} error={schedule.error} />
            {schedule.status === 'success' && schedule.data.map((item: AppointmentRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.title} · {item.scheduledAt}</div>)}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Current FC Online" icon={<Users className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void online.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">Refresh</button>}>
            <WidgetState status={online.status} error={online.error} />
            {online.status === 'success' && online.data.map((item: FcRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.name}</div>)}
          </Card>

          <Card title="Pending Tasks" icon={<ShieldCheck className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void tasks.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">Refresh</button>}>
            <WidgetState status={tasks.status} error={tasks.error} />
            {tasks.status === 'success' && tasks.data.map((item: TaskRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.title} · {item.priority}</div>)}
          </Card>

          <Card title="Unread Notifications" icon={<BellRing className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void notifications.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">Refresh</button>}>
            <WidgetState status={notifications.status} error={notifications.error} />
            {notifications.status === 'success' && notifications.data.map((item: NotificationRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.title}</div>)}
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Recent Contracts" icon={<CircleDollarSign className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void contracts.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">Refresh</button>}>
          <WidgetState status={contracts.status} error={contracts.error} />
          {contracts.status === 'success' && contracts.data.map((item: SalesRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.policyId} · {item.amount.toLocaleString('ko-KR')} KRW</div>)}
        </Card>

        <Card title="Recent Customers" icon={<Users className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void customers.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">Refresh</button>}>
          <WidgetState status={customers.status} error={customers.error} />
          {customers.status === 'success' && customers.data.map((item: CustomerRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.name} · {item.tier}</div>)}
        </Card>
      </div>

      <Card title="Company Activity Feed" icon={<Activity className="h-4 w-4 text-indigo-300" />} action={<button type="button" onClick={() => { void activity.refresh() }} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">Refresh</button>}>
        <WidgetState status={activity.status} error={activity.error} />
        {activity.status === 'success' && activity.data.map((item: ActivityRecord) => <div key={item.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">{item.summary} · {item.createdAt}</div>)}
      </Card>
    </div>
  )
}
