import type { ActivityEvent } from '@shared/types'
import { Activity } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { actorLabel, actorIcon } from '@renderer/lib/companyMeta'

interface ActivityTimelinePanelProps {
  events: ActivityEvent[]
}

export default function ActivityTimelinePanel({
  events
}: ActivityTimelinePanelProps): JSX.Element {
  return (
    <Card title="Activity Timeline" icon={<Activity className="h-4 w-4" />}>
      <ol className="relative space-y-4 pl-6">
        <span className="absolute left-[7px] top-1 h-[calc(100%-0.5rem)] w-px bg-slate-800" />
        {events.map((event) => {
          const Icon = actorIcon(event.actor)
          return (
            <li key={event.id} className="relative">
              <span className="absolute -left-6 top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-slate-700 bg-slate-900">
                <Icon className="h-2.5 w-2.5 text-slate-400" />
              </span>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-300">
                  {actorLabel(event.actor)}
                </span>
                <span className="shrink-0 text-xs text-slate-600">
                  {event.createdAt}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">{event.summary}</p>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
