import { RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'

interface MetricStatusCardProps {
  label: string
  value: string
  hint: string
  status: 'loading' | 'success' | 'error'
  error?: string | null
  isFallback?: boolean
  icon?: ReactNode
  onRefresh?: () => void
}

export default function MetricStatusCard({
  label,
  value,
  hint,
  status,
  error,
  isFallback = false,
  icon,
  onRefresh
}: MetricStatusCardProps): JSX.Element {
  const tone = status === 'error'
    ? 'bg-rose-500/10 text-rose-300'
    : status === 'loading'
      ? 'bg-amber-500/10 text-amber-300'
      : isFallback
        ? 'bg-slate-800 text-slate-300'
        : 'bg-emerald-500/10 text-emerald-300'

  const statusLabel = status === 'error'
    ? '오류'
    : status === 'loading'
      ? '불러오는 중'
      : isFallback
        ? '폴백'
        : '실시간'

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-300">
            {icon}
          </div>
          <div>
            <div className="text-sm font-medium text-slate-200">{label}</div>
            <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
          </div>
        </div>
        {onRefresh && (
          <button type="button" onClick={onRefresh} className="rounded-lg border border-slate-800 p-2 text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-sm text-slate-500">{error ? error : hint}</div>
        <span className={["rounded-full px-2.5 py-1 text-[11px] font-semibold", tone].join(' ')}>{statusLabel}</span>
      </div>
    </div>
  )
}
