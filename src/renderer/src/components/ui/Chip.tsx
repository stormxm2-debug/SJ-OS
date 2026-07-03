import type { ReactNode } from 'react'

export type ChipTone =
  | 'slate'
  | 'indigo'
  | 'violet'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'sky'

const TONES: Record<ChipTone, string> = {
  slate: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
  indigo: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
  violet: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
  emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  amber: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  rose: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
  sky: 'bg-sky-500/10 text-sky-300 border-sky-500/20'
}

interface ChipProps {
  tone?: ChipTone
  children: ReactNode
  className?: string
}

/** Small labelled pill for kinds/risks/categories. */
export default function Chip({
  tone = 'slate',
  children,
  className
}: ChipProps): JSX.Element {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        TONES[tone],
        className ?? ''
      ].join(' ')}
    >
      {children}
    </span>
  )
}
