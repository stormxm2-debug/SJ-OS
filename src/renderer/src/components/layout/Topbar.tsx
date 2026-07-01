import { Bell, Crown } from 'lucide-react'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { View } from '@renderer/navigation/types'
import { approvals, getWorkerById } from '@renderer/data/mockManagement'

function titleFor(route: View): { title: string; subtitle: string } {
  switch (route.name) {
    case 'assistant':
      return { title: 'Executive Assistant', subtitle: 'Give one instruction. The company does the rest.' }
    case 'dashboard':
      return { title: 'CEO Dashboard', subtitle: 'One instruction in. A whole company executes.' }
    case 'workers':
      return { title: 'AI Workers', subtitle: 'Your AI engineering team.' }
    case 'worker': {
      const worker = getWorkerById(route.workerId)
      return { title: worker?.name ?? 'Worker', subtitle: worker?.title ?? 'Worker detail' }
    }
    case 'projects':
      return { title: 'Project Manager', subtitle: 'Projects, tasks, and the team building them.' }
    case 'approvals':
      return { title: 'Approval Center', subtitle: 'Decisions waiting on the CEO.' }
    case 'activity':
      return { title: 'Company Activity Log', subtitle: 'Everything the company has done.' }
    case 'settings':
      return { title: 'Company Settings', subtitle: 'Providers, policy, and autonomy.' }
    default:
      return { title: 'SJ AI Company', subtitle: '' }
  }
}

export default function Topbar(): JSX.Element {
  const { route, navigate } = useNavigation()
  const { title, subtitle } = titleFor(route)
  const pending = approvals.filter((a) => a.status === 'pending').length

  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/40 px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">{title}</h1>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => navigate({ name: 'approvals' })}
          className="relative rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          aria-label="Approvals"
        >
          <Bell className="h-5 w-5" />
          {pending > 0 && (
            <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-semibold text-white">
              {pending}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2 rounded-lg bg-slate-800/70 px-3 py-1.5">
          <Crown className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-medium text-slate-200">CEO</span>
        </div>
      </div>
    </header>
  )
}
