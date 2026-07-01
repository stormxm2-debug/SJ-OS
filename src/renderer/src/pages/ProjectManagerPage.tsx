import { useState } from 'react'
import { GitBranch, Plus } from 'lucide-react'
import { useCompanyState } from '@renderer/data/useCompanyState'
import Card from '@renderer/components/ui/Card'
import Chip from '@renderer/components/ui/Chip'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import {
  PROJECT_STATUS_META,
  ROLE_LABEL,
  ROLE_META,
  TASK_STATE_META
} from '@renderer/lib/companyMeta'

export default function ProjectManagerPage(): JSX.Element {
  const { projects, tasks } = useCompanyState()
  const [selectedId, setSelectedId] = useState<string | null>(
    projects[0]?.id ?? null
  )

  const selected = projects.find((p) => p.id === selectedId) ?? null
  const projectTasks = tasks.filter((t) => t.projectId === selectedId)
  const teamRoles = Array.from(new Set(projectTasks.map((t) => t.assignedRole)))

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <Card
          title="Projects"
          action={
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-slate-400 transition hover:text-slate-200"
            >
              <Plus className="h-3.5 w-3.5" /> New
            </button>
          }
        >
          <ul className="space-y-1">
            {projects.map((p) => {
              const meta = PROJECT_STATUS_META[p.status]
              const active = p.id === selectedId
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={[
                      'w-full rounded-lg border px-3 py-2.5 text-left transition',
                      active
                        ? 'border-indigo-500/40 bg-indigo-500/10'
                        : 'border-transparent hover:bg-slate-800/50'
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-200">
                        {p.name}
                      </span>
                      <span
                        className={['flex items-center gap-1 text-xs', meta.text].join(
                          ' '
                        )}
                      >
                        <span
                          className={['h-1.5 w-1.5 rounded-full', meta.dot].join(' ')}
                        />
                        {meta.label}
                      </span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar value={p.progress} />
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      <div className="space-y-6 lg:col-span-2">
        {selected ? (
          <>
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-100">
                    {selected.name}
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {selected.description}
                  </p>
                  {selected.repository && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-slate-600">
                      <GitBranch className="h-3.5 w-3.5" />
                      {selected.repository}
                    </div>
                  )}
                </div>
                <Chip tone="indigo">
                  {PROJECT_STATUS_META[selected.status].label}
                </Chip>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <ProgressBar value={selected.progress} />
                <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-500">
                  {selected.progress}%
                </span>
              </div>
            </Card>

            <Card
              title="Tasks"
              action={
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-slate-400 transition hover:text-slate-200"
                >
                  <Plus className="h-3.5 w-3.5" /> New task
                </button>
              }
            >
              {projectTasks.length === 0 ? (
                <p className="text-sm text-slate-600">No tasks yet.</p>
              ) : (
                <ul className="space-y-4">
                  {projectTasks.map((task) => {
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
                        <div className="mt-2">
                          <ProgressBar value={task.progress} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>

            <Card title="Team">
              {teamRoles.length === 0 ? (
                <p className="text-sm text-slate-600">No workers assigned.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {teamRoles.map((role) => {
                    const Icon = ROLE_META[role].icon
                    return (
                      <span
                        key={role}
                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/60 px-2.5 py-1 text-xs text-slate-300"
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {ROLE_LABEL[role]}
                      </span>
                    )
                  })}
                </div>
              )}
            </Card>
          </>
        ) : (
          <Card>
            <p className="text-sm text-slate-600">Select a project to view details.</p>
          </Card>
        )}
      </div>
    </div>
  )
}
