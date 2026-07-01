import { FolderTree, FileCode2, HardDrive } from 'lucide-react'
import type {
  BuildStatus,
  KernelStateSnapshot,
  ProjectArtifact
} from '@shared/kernel'
import { useKernel } from '@renderer/chief-of-staff/useKernel'
import Card from '@renderer/components/ui/Card'
import Chip from '@renderer/components/ui/Chip'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import type { ChipTone } from '@renderer/components/ui/Chip'
import { ROLE_LABEL, ROLE_META } from '@renderer/lib/companyMeta'

/**
 * The CEO's window into the current real project. Everything here — the project,
 * its build status, completion, and generated artifacts (folders + files) —
 * comes from actual execution recorded in the Kernel.
 */

const BUILD_TONE: Record<BuildStatus, ChipTone> = {
  pending: 'slate',
  building: 'amber',
  passing: 'emerald',
  failing: 'rose'
}

export default function ProjectWorkspace(): JSX.Element | null {
  const kernel = useKernel()
  const project =
    kernel.projects.find((p) => p.state === 'active') ??
    kernel.projects[kernel.projects.length - 1]
  if (!project) return null

  const tasks = kernel.tasks.filter((t) => t.projectId === project.id)
  const completion = tasks.length
    ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length)
    : 0
  const artifacts = kernel.artifacts.filter((a) => a.projectId === project.id)
  const busy = kernel.workers.filter((w) => w.state === 'busy')
  const folders = groupByFolder(artifacts)

  return (
    <Card
      title="Project workspace"
      icon={<FolderTree className="h-4 w-4 text-indigo-300" />}
      action={<Chip tone={BUILD_TONE[project.buildStatus]}>{project.buildStatus}</Chip>}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">
            {project.name}
          </div>
          <div className="font-mono text-[11px] text-slate-600">{project.id}</div>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-slate-400">
          {completion}% · {artifacts.length} file(s)
        </span>
      </div>
      <div className="mt-2">
        <ProgressBar value={completion} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="text-xs uppercase tracking-wide text-slate-600">
            Generated files
          </div>
          {artifacts.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">No files generated yet…</p>
          ) : (
            <div className="mt-1 space-y-2">
              {folders.map(({ dir, files }) => (
                <div key={dir}>
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <FolderTree className="h-3 w-3" />
                    {dir}
                  </div>
                  <ul className="mt-0.5 space-y-0.5 pl-4">
                    {files.map((a) => (
                      <FileRow key={a.id} artifact={a} snapshot={kernel} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-slate-600">
            Working now
          </div>
          {busy.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">Idle</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {busy.map((w) => {
                const RoleIcon = ROLE_META[w.metadata.role].icon
                return (
                  <li key={w.id} className="flex items-center gap-1.5 text-xs text-slate-300">
                    <RoleIcon className="h-3 w-3 text-slate-400" />
                    {ROLE_LABEL[w.metadata.role]}
                  </li>
                )
              })}
            </ul>
          )}
          {project.workspace && (
            <div className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-600">
              <HardDrive className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="break-all">{project.workspace}</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

function FileRow({
  artifact,
  snapshot
}: {
  artifact: ProjectArtifact
  snapshot: KernelStateSnapshot
}): JSX.Element {
  const worker = snapshot.workers.find((w) => w.id === artifact.workerId)
  const RoleIcon = worker ? ROLE_META[worker.metadata.role].icon : FileCode2
  const name = artifact.path.includes('/')
    ? artifact.path.slice(artifact.path.lastIndexOf('/') + 1)
    : artifact.path
  return (
    <li className="flex items-center gap-1.5 text-xs text-slate-300">
      <RoleIcon className="h-3 w-3 shrink-0 text-slate-500" />
      <span className="truncate">{name}</span>
    </li>
  )
}

function groupByFolder(
  artifacts: ProjectArtifact[]
): { dir: string; files: ProjectArtifact[] }[] {
  const map = new Map<string, ProjectArtifact[]>()
  for (const a of artifacts) {
    const dir = a.path.includes('/') ? a.path.slice(0, a.path.lastIndexOf('/')) : '(root)'
    const list = map.get(dir) ?? []
    list.push(a)
    map.set(dir, list)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dir, files]) => ({ dir, files }))
}
