import type { ReactNode } from 'react'

interface StatCardProps {
  label: string
  value: ReactNode
  sub?: string
  icon: ReactNode
  accent?: string
}

/** Top-row KPI tile for the CEO Dashboard. */
export default function StatCard({
  label,
  value,
  sub,
  icon,
  accent = 'bg-slate-800 text-slate-300'
}: StatCardProps): JSX.Element {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div
        className={[
          'flex h-11 w-11 items-center justify-center rounded-lg',
          accent
        ].join(' ')}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-semibold leading-none text-slate-100">
          {value}
        </div>
        <div className="mt-1 text-xs font-medium text-slate-400">{label}</div>
        {sub && <div className="text-xs text-slate-600">{sub}</div>}
      </div>
    </div>
  )
}
