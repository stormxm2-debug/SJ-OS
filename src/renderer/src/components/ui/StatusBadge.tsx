import type { WorkerStatus } from '@shared/types'
import { STATUS_META } from '@renderer/lib/companyMeta'

interface StatusBadgeProps {
  status: WorkerStatus
}

export default function StatusBadge({ status }: StatusBadgeProps): JSX.Element {
  const meta = STATUS_META[status]
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        meta.chip,
        meta.text
      ].join(' ')}
    >
      <span className={['h-1.5 w-1.5 rounded-full', meta.dot].join(' ')} />
      {meta.label}
    </span>
  )
}
