import { Radio } from 'lucide-react'
import type { KernelEvent } from '@shared/kernel'
import { useKernel } from '@renderer/chief-of-staff/useKernel'
import Card from '@renderer/components/ui/Card'
import { describeEvent } from '@renderer/lib/kernelEvents'

/**
 * The live activity feed — a running stream of what the company is doing,
 * newest first. Every line is a real, immutable Kernel event humanized for the
 * CEO; nothing is fabricated.
 */

const DOT_BY_EVENT: Record<string, string> = {
  MeetingCreated: 'bg-indigo-400',
  MeetingOpinion: 'bg-indigo-400',
  MeetingPhaseChanged: 'bg-indigo-400',
  MeetingConcluded: 'bg-emerald-400',
  ProjectCreated: 'bg-sky-400',
  TaskQueued: 'bg-slate-500',
  WorkerAssigned: 'bg-violet-400',
  TaskStarted: 'bg-violet-400',
  TaskCompleted: 'bg-emerald-400',
  WorkerFailed: 'bg-rose-400',
  ProjectCompleted: 'bg-emerald-400',
  ApprovalRequested: 'bg-amber-400'
}

export default function EventStream(): JSX.Element {
  const kernel = useKernel()
  const events = kernel.events
    .filter((e) => e.type !== 'TaskProgress')
    .slice(-40)
    .reverse()

  return (
    <Card
      title="활동 피드"
      icon={<Radio className="h-4 w-4 text-indigo-300" />}
      action={<span className="text-xs text-slate-500">{events.length}개 이벤트</span>}
    >
      {events.length === 0 ? (
        <p className="text-sm text-slate-600">회사가 시작되기를 기다리는 중…</p>
      ) : (
        <ol className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
          {events.map((event: KernelEvent) => (
            <li key={event.id} className="flex items-start gap-2 text-xs">
              <span
                className={[
                  'mt-1 h-2 w-2 shrink-0 rounded-full',
                  DOT_BY_EVENT[event.type] ?? 'bg-slate-500'
                ].join(' ')}
              />
              <span className="text-slate-300">{describeEvent(event, kernel)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
