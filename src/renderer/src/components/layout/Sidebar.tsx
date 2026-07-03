import {
  Sparkles,
  Radio,
  LayoutDashboard,
  Briefcase,
  UserRound,
  Activity as ActivityIcon,
  CalendarDays,
  BarChart3,
  UsersRound,
  ClipboardList as ClipboardListIcon,
  FileSearch,
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
  Boxes,
  Terminal,
  Home,
  Bot
} from 'lucide-react'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { View, ViewName } from '@renderer/navigation/types'
import { useAppMode, type AppMode } from '@renderer/navigation/AppModeContext'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'

type NavItem = {
  key: string
  label: string
  icon: typeof LayoutDashboard
  view: View
  match: ViewName[]
}

const NAV: NavItem[] = [
  { key: 'assistant', label: '경영 비서', icon: Sparkles, view: { name: 'assistant' }, match: ['assistant'] },
  { key: 'company', label: '라이브 컴퍼니', icon: Radio, view: { name: 'company' }, match: ['company'] },
  { key: 'dashboard', label: 'CEO 대시보드', icon: LayoutDashboard, view: { name: 'dashboard' }, match: ['dashboard'] },
  { key: 'fcos', label: 'FC OS', icon: Briefcase, view: { name: 'fcos' }, match: ['fcos'] },
  { key: 'customer', label: '고객 워크스페이스', icon: UserRound, view: { name: 'customer' }, match: ['customer'] },
  { key: 'sales-activity', label: '영업활동', icon: ActivityIcon, view: { name: 'sales-activity' }, match: ['sales-activity'] },
  { key: 'schedule', label: '일정', icon: CalendarDays, view: { name: 'schedule' }, match: ['schedule'] },
  { key: 'performance', label: '실적', icon: BarChart3, view: { name: 'performance' }, match: ['performance'] },
  { key: 'team-leader', label: '팀장', icon: UsersRound, view: { name: 'team-leader' }, match: ['team-leader'] },
  { key: 'consultation', label: '상담', icon: ClipboardListIcon, view: { name: 'consultation' }, match: ['consultation'] },
  { key: 'insurance-analysis', label: '보험분석', icon: FileSearch, view: { name: 'insurance-analysis' }, match: ['insurance-analysis'] },
  { key: 'app-builder', label: '앱 빌더', icon: Boxes, view: { name: 'app-builder' }, match: ['app-builder'] },
  { key: 'devprompt', label: '개발 프롬프트 센터', icon: Terminal, view: { name: 'devprompt' }, match: ['devprompt'] },
  { key: 'cto', label: 'CTO 룸', icon: Gauge, view: { name: 'cto' }, match: ['cto'] },
  { key: 'approvals', label: '승인 센터', icon: ShieldCheck, view: { name: 'approvals' }, match: ['approvals'] },
  { key: 'qa', label: 'QA 센터', icon: ClipboardCheck, view: { name: 'qa' }, match: ['qa'] },
  { key: 'release', label: '릴리즈 센터', icon: PackageCheck, view: { name: 'release' }, match: ['release'] },
  { key: 'devops', label: 'DevOps 센터', icon: Server, view: { name: 'devops' }, match: ['devops'] },
  { key: 'autopilot', label: '오토파일럿', icon: Rocket, view: { name: 'autopilot' }, match: ['autopilot'] },
  { key: 'devos', label: '개발 OS', icon: Cpu, view: { name: 'devos' }, match: ['devos'] },
  { key: 'pm', label: 'PM 플래너', icon: KanbanSquare, view: { name: 'pm' }, match: ['pm'] },
  { key: 'backlog', label: '제품 백로그', icon: ClipboardList, view: { name: 'backlog' }, match: ['backlog'] },
  { key: 'workers', label: 'AI 워커', icon: Users, view: { name: 'workers' }, match: ['workers', 'worker'] },
  { key: 'projects', label: '프로젝트', icon: FolderKanban, view: { name: 'projects' }, match: ['projects'] },
  { key: 'activity', label: '활동 로그', icon: Activity, view: { name: 'activity' }, match: ['activity'] },
  { key: 'settings', label: '설정', icon: Settings, view: { name: 'settings' }, match: ['settings'] }
]

/**
 * Simplified, staff-facing menu (직원 모드). Maps to the same existing routes as
 * CEO mode with friendlier labels — no new pages, no permission blocking. The
 * 자비스 button below the nav is available in both modes.
 */
const STAFF_NAV: NavItem[] = [
  { key: 'home', label: '홈', icon: Home, view: { name: 'dashboard' }, match: ['dashboard'] },
  { key: 'schedule', label: '오늘 일정', icon: CalendarDays, view: { name: 'schedule' }, match: ['schedule'] },
  { key: 'customer', label: '고객', icon: UserRound, view: { name: 'customer' }, match: ['customer'] },
  { key: 'sales-activity', label: '영업활동', icon: ActivityIcon, view: { name: 'sales-activity' }, match: ['sales-activity'] },
  { key: 'performance', label: '실적', icon: BarChart3, view: { name: 'performance' }, match: ['performance'] },
  { key: 'consultation', label: '상담', icon: ClipboardListIcon, view: { name: 'consultation' }, match: ['consultation'] },
  { key: 'insurance-analysis', label: '보험분석', icon: FileSearch, view: { name: 'insurance-analysis' }, match: ['insurance-analysis'] },
  { key: 'fcos', label: '내 업무', icon: Briefcase, view: { name: 'fcos' }, match: ['fcos'] }
]

const MODE_LABEL: Record<AppMode, string> = { ceo: '대표 모드', staff: '직원 모드' }

export default function Sidebar(): JSX.Element {
  const { route, navigate } = useNavigation()
  const { mode, setMode } = useAppMode()
  const navItems = mode === 'staff' ? STAFF_NAV : NAV

  // Switching mode never blocks a route; but if the current view is not in the
  // staff menu, land the user on the staff home so the sidebar stays coherent.
  const switchMode = (next: AppMode): void => {
    setMode(next)
    if (next === 'staff' && !STAFF_NAV.some((item) => item.match.includes(route.name))) {
      navigate({ name: 'dashboard' })
    }
  }

  return (
    <aside className="flex w-64 flex-col border-r border-slate-800 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-md shadow-indigo-500/30">
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-100">SJ AI 컴퍼니</div>
          <div className="text-xs text-slate-500">보험 업무 플랫폼</div>
        </div>
      </div>

      {/* CEO / Staff mode switch */}
      <div className="px-3 pt-3">
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
          {(['ceo', 'staff'] as AppMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              aria-pressed={mode === m}
              className={[
                'rounded-lg px-2 py-1.5 text-xs font-semibold transition',
                mode === m
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                  : 'text-slate-500 hover:text-slate-200'
              ].join(' ')}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map(({ key, label, icon: Icon, view, match }) => {
          const active = match.includes(route.name)
          return (
            <button
              key={key}
              type="button"
              onClick={() => navigate(view)}
              className={[
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
                active
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 font-semibold text-white shadow-sm shadow-indigo-500/30'
                  : 'font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-100'
              ].join(' ')}
            >
              <Icon className={['h-4 w-4', active ? 'text-white' : 'text-slate-500'].join(' ')} />
              {label}
            </button>
          )
        })}
      </nav>

      <div className="border-t border-slate-800 px-3 py-3">
        <button
          type="button"
          onClick={() => jarvisService.open()}
          title="자비스 열기"
          aria-label="자비스 열기"
          className="group flex w-full items-center gap-3 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-3 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:shadow-lg hover:shadow-indigo-500/40"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/20">
            <Bot className="h-4 w-4" />
          </span>
          자비스 열기
          <Sparkles className="ml-auto h-3.5 w-3.5 text-[#fcd34d]" />
        </button>
      </div>

      <div className="border-t border-slate-800 px-5 py-4 text-xs text-slate-600">
        SJ OS · 보험 업무 플랫폼
      </div>
    </aside>
  )
}
