import { getStatusLabel, getStatusTone, type SystemStatusState } from './homeDashboardData'

interface StatusPillProps {
  label: string
  state: SystemStatusState
  detail: string
}

export default function StatusPill({ label, state, detail }: StatusPillProps): JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5">
      <div>
        <div className="text-sm font-medium text-slate-200">{label}</div>
        <div className="text-xs text-slate-500">{detail}</div>
      </div>
      <span className={["rounded-full px-2.5 py-1 text-[11px] font-semibold", getStatusTone(state)].join(' ')}>
        {getStatusLabel(state)}
      </span>
    </div>
  )
}
