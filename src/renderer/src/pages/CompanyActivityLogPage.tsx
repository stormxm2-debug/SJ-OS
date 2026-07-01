import { useEffect, useState, type ReactNode } from 'react'
import type { ActivityActor, ActivityEvent } from '@shared/types'
import Card from '@renderer/components/ui/Card'
import { actorLabel, actorIcon } from '@renderer/lib/companyMeta'
import { companyManagementService, useCompanyManagementWidget } from '@renderer/services/company/companyManagementService'

type Filter = 'all' | ActivityActor

export default function CompanyActivityLogPage(): JSX.Element {
  const activity = useCompanyManagementWidget(() => companyManagementService.loadActivityLog())
  const [filter, setFilter] = useState<Filter>('all')
  const [events, setEvents] = useState<ActivityEvent[]>([])

  useEffect(() => {
    if (activity.status === 'success') {
      setEvents(activity.data as ActivityEvent[])
    }
  }, [activity])

  const actors = Array.from(new Set(events.map((e) => e.actor)))
  const visible =
    filter === 'all'
      ? events
      : events.filter((e) => e.actor === filter)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </FilterChip>
        {actors.map((actor) => (
          <FilterChip
            key={actor}
            active={filter === actor}
            onClick={() => setFilter(actor)}
          >
            {actorLabel(actor)}
          </FilterChip>
        ))}
      </div>

      <Card
        title="Activity"
        action={<span className="text-xs text-slate-500">{visible.length} events</span>}
      >
        <ol className="relative space-y-4 pl-6">
          <span className="absolute left-[7px] top-1 h-[calc(100%-0.5rem)] w-px bg-slate-800" />
          {visible.map((event) => {
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
                <p className="mt-0.5 text-sm text-slate-400">{event.summary}</p>
              </li>
            )
          })}
        </ol>
      </Card>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full border px-3 py-1 text-xs font-medium transition',
        active
          ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
          : 'border-slate-800 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
      ].join(' ')}
    >
      {children}
    </button>
  )
}
