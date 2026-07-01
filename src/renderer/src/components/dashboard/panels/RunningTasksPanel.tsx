import type { Task } from '@shared/types'
import { ListChecks } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { ROLE_LABEL, ROLE_META, TASK_STATE_META } from '@renderer/lib/companyMeta'

interface RunningTasksPanelProps {
  tasks: Task[]
}

export default function RunningTasksPanel({
  tasks
}: RunningTasksPanelProps): JSX.Element {
  const running = tasks.filter((t) => t.state !== 'done' && t.state !== 'failed')

  return (
    <Card
      title="Running Tasks"
      icon={<ListChecks className="h-4 w-4" />}
      action={<span className="text-xs text-slate-500">{running.length}</span>}
    >
      <ul className="space-y-4">
        {running.map((task) => {
          const RoleIcon = ROLE_META[task.assignedRole].icon
          const state = TASK_STATE_META[task.state]
          return (
            <li key={task.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-200">
                  {task.title}
                </span>
                <span className={['shrink-0 text-xs', state.text].join(' ')}>
                  {state.label}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                <RoleIcon className="h-3 w-3" />
                {ROLE_LABEL[task.assignedRole]}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <ProgressBar value={task.progress} />
                <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-500">
                  {task.progress}%
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
