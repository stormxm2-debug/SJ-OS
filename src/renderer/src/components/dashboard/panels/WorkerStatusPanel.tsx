import type { Worker, WorkerStatus } from '@shared/types'
import { Gauge } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { STATUS_META } from '@renderer/lib/companyMeta'

interface WorkerStatusPanelProps {
  workers: Worker[]
}

const ORDER: WorkerStatus[] = ['working', 'review', 'blocked', 'idle', 'offline']

export default function WorkerStatusPanel({
  workers
}: WorkerStatusPanelProps): JSX.Element {
  const counts = ORDER.map((status) => ({
    status,
    count: workers.filter((w) => w.status === status).length
  })).filter((row) => row.count > 0)

  return (
    <Card title="Worker Status" icon={<Gauge className="h-4 w-4" />}>
      <ul className="space-y-3">
        {counts.map(({ status, count }) => {
          const meta = STATUS_META[status]
          return (
            <li key={status} className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-slate-300">
                <span
                  className={['h-2 w-2 rounded-full', meta.dot].join(' ')}
                />
                {meta.label}
              </span>
              <span className="text-sm font-semibold tabular-nums text-slate-200">
                {count}
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
