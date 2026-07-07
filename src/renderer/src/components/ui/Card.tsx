import type { ReactNode } from 'react'

interface CardProps {
  title?: string
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}

/** Panel container used by every dashboard section. */
export default function Card({
  title,
  icon,
  action,
  children,
  className
}: CardProps): JSX.Element {
  return (
    <section
      className={[
        'rounded-2xl border border-slate-800 bg-white shadow-sm shadow-slate-400/15',
        className ?? ''
      ].join(' ')}
    >
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            {icon && <span className="text-slate-400">{icon}</span>}
            {title && (
              <h2 className="text-sm font-semibold tracking-tight text-slate-100">{title}</h2>
            )}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}
