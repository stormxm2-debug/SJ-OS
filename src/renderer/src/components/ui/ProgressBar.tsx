interface ProgressBarProps {
  value: number
  className?: string
}

/** Thin progress track, 0–100. */
export default function ProgressBar({
  value,
  className
}: ProgressBarProps): JSX.Element {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div
      className={['h-1.5 w-full rounded-full bg-slate-800', className ?? ''].join(
        ' '
      )}
    >
      <div
        className="h-1.5 rounded-full bg-indigo-500 transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
