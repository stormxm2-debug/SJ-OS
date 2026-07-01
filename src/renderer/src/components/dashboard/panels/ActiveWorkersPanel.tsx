import type { Worker } from '@shared/types'
import { Users } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import WorkerCard from '@renderer/components/dashboard/WorkerCard'

interface ActiveWorkersPanelProps {
  workers: Worker[]
}

export default function ActiveWorkersPanel({
  workers
}: ActiveWorkersPanelProps): JSX.Element {
  const online = workers.filter((w) => w.status !== 'offline').length

  return (
    <Card
      title="Active AI Workers"
      icon={<Users className="h-4 w-4" />}
      action={
        <span className="text-xs text-slate-500">
          {online}/{workers.length} online
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {workers.map((worker) => (
          <WorkerCard key={worker.id} worker={worker} />
        ))}
      </div>
    </Card>
  )
}
