import type { Project } from '@shared/types'
import { FolderKanban, GitBranch } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { PROJECT_STATUS_META } from '@renderer/lib/companyMeta'

interface ProjectsPanelProps {
  projects: Project[]
}

export default function ProjectsPanel({
  projects
}: ProjectsPanelProps): JSX.Element {
  return (
    <Card
      title="Current Projects"
      icon={<FolderKanban className="h-4 w-4" />}
      action={<span className="text-xs text-slate-500">{projects.length}</span>}
    >
      <ul className="space-y-4">
        {projects.map((project) => {
          const meta = PROJECT_STATUS_META[project.status]
          return (
            <li key={project.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-200">
                  {project.name}
                </span>
                <span
                  className={[
                    'flex shrink-0 items-center gap-1.5 text-xs',
                    meta.text
                  ].join(' ')}
                >
                  <span className={['h-1.5 w-1.5 rounded-full', meta.dot].join(' ')} />
                  {meta.label}
                </span>
              </div>
              {project.repository && (
                <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-600">
                  <GitBranch className="h-3 w-3" />
                  {project.repository}
                </div>
              )}
              <div className="mt-2 flex items-center gap-3">
                <ProgressBar value={project.progress} />
                <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-500">
                  {project.progress}%
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
