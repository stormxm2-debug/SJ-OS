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
        'rounded-2xl border border-slate-800 bg-white shadow-sm shadow-slate-300/40',
        className ?? ''
      ].join(' ')}
    >
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            {icon && <span className="text-slate-400">{icon}</span>}
            {title && (
              <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
            )}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}
