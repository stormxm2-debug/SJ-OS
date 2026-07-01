import { ChevronRight } from 'lucide-react'
import type { Capability, KernelStateSnapshot } from '@shared/kernel'
import { useKernel } from '@renderer/chief-of-staff/useKernel'
import Card from '@renderer/components/ui/Card'

/**
 * The company pipeline: CEO → Meeting → Planning → Development → Testing →
 * Review → Release → Completed. The current stage is DERIVED from live Kernel
 * state (meeting phase + task states), so it advances on its own as the company
 * works — nothing here is scripted.
 */

const STAGES = [
  'CEO',
  'Meeting',
  'Planning',
  'Development',
  'Testing',
  'Review',
  'Release',
  'Completed'
] as const

const DEV_CAPS: Capability[] = ['cto', 'research', 'backend', 'frontend', 'developer']

function currentStage(snapshot: KernelStateSnapshot): number {
  const project =
    snapshot.projects.find((p) => p.state === 'active') ??
    snapshot.projects[snapshot.projects.length - 1]
  if (project?.state === 'completed') return 7

  const tasks = project
    ? snapshot.tasks.filter((t) => t.projectId === project.id)
    : []
  const meeting = snapshot.meetings[snapshot.meetings.length - 1]

  const isRunning = (caps: Capability[]): boolean =>
    tasks.some(
      (t) => (t.state === 'running' || t.state === 'dispatched') && caps.includes(t.capability)
    )
  const anyDone = (caps: Capability[]): boolean =>
    tasks.some((t) => t.state === 'completed' && caps.includes(t.capability))

  let stage = 0
  if (meeting) stage = 1
  if (meeting && meeting.phase === 'approved') stage = 2
  if (project) stage = 2
  if (isRunning(DEV_CAPS) || anyDone(DEV_CAPS)) stage = 3
  if (anyDone(['developer'])) stage = 4 // code written → testing
  if (isRunning(['qa']) || anyDone(['qa'])) stage = 5
  if (isRunning(['git', 'documentation', 'release']) || anyDone(['release'])) stage = 6
  // (project completed is handled by the early return above)
  return stage
}

export default function ProjectPipeline(): JSX.Element {
  const kernel = useKernel()
  const stage = currentStage(kernel)
  return (
    <Card title="Company pipeline">
      <div className="flex flex-wrap items-center gap-1.5">
        {STAGES.map((label, i) => {
          const done = i < stage || stage === 7
          const active = i === stage && stage !== 7
          const tone = done
            ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5'
            : active
              ? 'text-indigo-100 border-indigo-500/50 bg-indigo-500/15'
              : 'text-slate-500 border-slate-800'
          return (
            <div key={label} className="flex items-center gap-1.5">
              <span
                className={[
                  'rounded-lg border px-2.5 py-1 text-xs font-medium',
                  tone,
                  active ? 'animate-pulse' : ''
                ].join(' ')}
              >
                {label}
              </span>
              {i < STAGES.length - 1 && (
                <ChevronRight className="h-3.5 w-3.5 text-slate-700" />
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
