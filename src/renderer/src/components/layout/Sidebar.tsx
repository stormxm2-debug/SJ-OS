import {
  Sparkles,
  Radio,
  LayoutDashboard,
  Briefcase,
  UserRound,
  Activity as ActivityIcon,
  Rocket,
  Cpu,
  Gauge,
  ClipboardCheck,
  PackageCheck,
  Server,
  ClipboardList,
  KanbanSquare,
  Users,
  FolderKanban,
  ShieldCheck,
  Activity,
  Settings,
  Bot
} from 'lucide-react'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { View, ViewName } from '@renderer/navigation/types'

type NavItem = {
  key: string
  label: string
  icon: typeof LayoutDashboard
  view: View
  match: ViewName[]
}

const NAV: NavItem[] = [
  { key: 'assistant', label: 'Executive Assistant', icon: Sparkles, view: { name: 'assistant' }, match: ['assistant'] },
  { key: 'company', label: 'Live Company', icon: Radio, view: { name: 'company' }, match: ['company'] },
  { key: 'dashboard', label: 'CEO Dashboard', icon: LayoutDashboard, view: { name: 'dashboard' }, match: ['dashboard'] },
  { key: 'fcos', label: 'FC OS', icon: Briefcase, view: { name: 'fcos' }, match: ['fcos'] },
  { key: 'customer', label: 'Customer Workspace', icon: UserRound, view: { name: 'customer' }, match: ['customer'] },
  { key: 'sales-activity', label: 'Sales Activity', icon: ActivityIcon, view: { name: 'sales-activity' }, match: ['sales-activity'] },
  { key: 'cto', label: 'CTO Room', icon: Gauge, view: { name: 'cto' }, match: ['cto'] },
  { key: 'approvals', label: 'Approval Center', icon: ShieldCheck, view: { name: 'approvals' }, match: ['approvals'] },
  { key: 'qa', label: 'QA Center', icon: ClipboardCheck, view: { name: 'qa' }, match: ['qa'] },
  { key: 'release', label: 'Release Center', icon: PackageCheck, view: { name: 'release' }, match: ['release'] },
  { key: 'devops', label: 'DevOps Center', icon: Server, view: { name: 'devops' }, match: ['devops'] },
  { key: 'autopilot', label: 'Autopilot', icon: Rocket, view: { name: 'autopilot' }, match: ['autopilot'] },
  { key: 'devos', label: 'Development OS', icon: Cpu, view: { name: 'devos' }, match: ['devos'] },
  { key: 'pm', label: 'PM Planner', icon: KanbanSquare, view: { name: 'pm' }, match: ['pm'] },
  { key: 'backlog', label: 'Product Backlog', icon: ClipboardList, view: { name: 'backlog' }, match: ['backlog'] },
  { key: 'workers', label: 'AI Workers', icon: Users, view: { name: 'workers' }, match: ['workers', 'worker'] },
  { key: 'projects', label: 'Projects', icon: FolderKanban, view: { name: 'projects' }, match: ['projects'] },
  { key: 'activity', label: 'Activity Log', icon: Activity, view: { name: 'activity' }, match: ['activity'] },
  { key: 'settings', label: 'Settings', icon: Settings, view: { name: 'settings' }, match: ['settings'] }
]

export default function Sidebar(): JSX.Element {
  const { route, navigate } = useNavigation()

  return (
    <aside className="flex w-64 flex-col border-r border-slate-800 bg-slate-900/60">
      <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600">
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-100">SJ AI Company</div>
          <div className="text-xs text-slate-500">Engineering Org</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV.map(({ key, label, icon: Icon, view, match }) => {
          const active = match.includes(route.name)
          return (
            <button
              key={key}
              type="button"
              onClick={() => navigate(view)}
              className={[
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                active
                  ? 'bg-indigo-600/15 text-indigo-300'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              ].join(' ')}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          )
        })}
      </nav>

      <div className="border-t border-slate-800 px-5 py-4 text-xs text-slate-600">
        MVP Shell · v0.0.0
      </div>
    </aside>
  )
}
