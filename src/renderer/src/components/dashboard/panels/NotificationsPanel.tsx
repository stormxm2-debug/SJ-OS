import type { Notification, NotificationLevel } from '@shared/types'
import { Bell, CheckCircle2, Info, AlertTriangle, ShieldQuestion } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Card from '@renderer/components/ui/Card'

interface NotificationsPanelProps {
  notifications: Notification[]
}

const LEVEL_META: Record<NotificationLevel, { icon: LucideIcon; text: string }> = {
  info: { icon: Info, text: 'text-sky-300' },
  success: { icon: CheckCircle2, text: 'text-emerald-300' },
  warning: { icon: AlertTriangle, text: 'text-amber-300' },
  action: { icon: ShieldQuestion, text: 'text-indigo-300' }
}

export default function NotificationsPanel({
  notifications
}: NotificationsPanelProps): JSX.Element {
  const pending = notifications.filter((n) => n.requiresApproval).length

  return (
    <Card
      title="Notifications"
      icon={<Bell className="h-4 w-4" />}
      action={
        pending > 0 ? (
          <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs font-medium text-indigo-300">
            {pending} need approval
          </span>
        ) : (
          <span className="text-xs text-slate-500">{notifications.length}</span>
        )
      }
    >
      <ul className="space-y-3">
        {notifications.map((n) => {
          const meta = LEVEL_META[n.level]
          const Icon = meta.icon
          return (
            <li
              key={n.id}
              className={[
                'rounded-lg border p-3',
                n.requiresApproval
                  ? 'border-indigo-500/30 bg-indigo-500/5'
                  : 'border-slate-800 bg-slate-900/40'
              ].join(' ')}
            >
              <div className="flex items-start gap-2.5">
                <Icon className={['mt-0.5 h-4 w-4 shrink-0', meta.text].join(' ')} />
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-200">
                      {n.title}
                    </span>
                    <span className="shrink-0 text-xs text-slate-600">
                      {n.createdAt}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">{n.message}</p>
                  {n.requiresApproval && (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-indigo-500"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
