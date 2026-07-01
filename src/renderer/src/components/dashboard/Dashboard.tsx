import { Users, FolderKanban, ListChecks, BellRing } from 'lucide-react'
import { useCompanyState } from '@renderer/data/useCompanyState'
import StatCard from '@renderer/components/ui/StatCard'
import ActiveWorkersPanel from './panels/ActiveWorkersPanel'
import WorkerStatusPanel from './panels/WorkerStatusPanel'
import ProjectsPanel from './panels/ProjectsPanel'
import RunningTasksPanel from './panels/RunningTasksPanel'
import NotificationsPanel from './panels/NotificationsPanel'
import ActivityTimelinePanel from './panels/ActivityTimelinePanel'

/**
 * The CEO Dashboard — the company at a glance. No chat UI: the CEO supervises
 * an engineering org through KPIs, worker status, projects, tasks, approvals,
 * and a live activity timeline. All data comes from `useCompanyState` (mock).
 */
export default function Dashboard(): JSX.Element {
  const { workers, projects, tasks, notifications, activity } = useCompanyState()

  const workingCount = workers.filter((w) => w.status === 'working').length
  const buildingCount = projects.filter((p) => p.status === 'building').length
  const runningTasks = tasks.filter(
    (t) => t.state !== 'done' && t.state !== 'failed'
  ).length
  const approvals = notifications.filter((n) => n.requiresApproval).length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Workers"
          value={workers.length}
          sub={`${workingCount} working now`}
          icon={<Users className="h-5 w-5" />}
          accent="bg-indigo-500/15 text-indigo-300"
        />
        <StatCard
          label="Projects"
          value={projects.length}
          sub={`${buildingCount} in build`}
          icon={<FolderKanban className="h-5 w-5" />}
          accent="bg-violet-500/15 text-violet-300"
        />
        <StatCard
          label="Running Tasks"
          value={runningTasks}
          icon={<ListChecks className="h-5 w-5" />}
          accent="bg-emerald-500/15 text-emerald-300"
        />
        <StatCard
          label="Pending Approvals"
          value={approvals}
          sub={approvals > 0 ? 'Needs your decision' : 'All clear'}
          icon={<BellRing className="h-5 w-5" />}
          accent="bg-amber-500/15 text-amber-300"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <ActiveWorkersPanel workers={workers} />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <ProjectsPanel projects={projects} />
            <RunningTasksPanel tasks={tasks} />
          </div>
        </div>
        <div className="space-y-6">
          <WorkerStatusPanel workers={workers} />
          <NotificationsPanel notifications={notifications} />
          <ActivityTimelinePanel events={activity} />
        </div>
      </div>
    </div>
  )
}
