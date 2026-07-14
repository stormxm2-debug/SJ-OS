import {
  BookOpen,
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
  Bot,
  Clock,
  Megaphone,
  LogOut,
  ChevronDown,
  ChevronRight,
  ReceiptText,
  Radar
} from 'lucide-react'
import { useState } from 'react'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { View, ViewName } from '@renderer/navigation/types'
import { useAppMode, type AppMode } from '@renderer/navigation/AppModeContext'
import { useSession } from '@renderer/navigation/SessionContext'
import { DEMO_USERS, ROLE_LABEL, isAdminRole } from '@renderer/navigation/roleAccess'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'
import BrandLogo from '@renderer/components/brand/BrandLogo'

type NavItem = {
  key: string
  label: string
  icon: typeof LayoutDashboard
  view: View
  match: ViewName[]
}

type NavGroup = {
  label: string
  items: NavItem[]
  /** Advanced/rarely-used groups render collapsed by default to declutter the main menu. */
  collapsible?: boolean
}

/**
 * CEO-mode menu, organized into staff-friendly labeled groups. Every existing
 * route is preserved (nothing removed) — advanced/developer/admin pages are
 * grouped lower and marked `collapsible` so they render COLLAPSED by default,
 * keeping the main menu clean. Labels are display-only; route ids/logic unchanged.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    label: '업무 홈',
    items: [
      { key: 'staff-home', label: '홈', icon: Home, view: { name: 'staff-home' }, match: ['staff-home'] },
      { key: 'dashboard', label: 'CEO 대시보드', icon: LayoutDashboard, view: { name: 'dashboard' }, match: ['dashboard'] },
      { key: 'schedule', label: '오늘 일정', icon: CalendarDays, view: { name: 'schedule' }, match: ['schedule'] },
      { key: 'fcos', label: '내 업무', icon: Briefcase, view: { name: 'fcos' }, match: ['fcos'] }
    ]
  },
  {
    label: '고객 · 상담',
    items: [
      { key: 'customer', label: '고객 관리', icon: UserRound, view: { name: 'customer' }, match: ['customer'] },
      { key: 'consultation', label: '상담 관리', icon: ClipboardListIcon, view: { name: 'consultation' }, match: ['consultation'] },
      { key: 'insurance-analysis', label: '보험분석', icon: FileSearch, view: { name: 'insurance-analysis' }, match: ['insurance-analysis'] },
      { key: 'claim-assistant', label: '보험금 청구비서', icon: ReceiptText, view: { name: 'claim-assistant' }, match: ['claim-assistant'] },
      { key: 'wiki', label: '보험 백과사전', icon: BookOpen, view: { name: 'wiki' }, match: ['wiki'] }
    ]
  },
  {
    label: '영업활동',
    items: [
      { key: 'sales-activity', label: '영업활동', icon: ActivityIcon, view: { name: 'sales-activity' }, match: ['sales-activity'] },
      { key: 'performance', label: '실적', icon: BarChart3, view: { name: 'performance' }, match: ['performance'] },
      { key: 'team-leader', label: '팀 현황', icon: UsersRound, view: { name: 'team-leader' }, match: ['team-leader'] }
    ]
  },
  {
    label: 'AI 업무지원',
    items: [
      { key: 'assistant', label: '경영 비서', icon: Sparkles, view: { name: 'assistant' }, match: ['assistant'] },
      { key: 'company', label: '라이브 컴퍼니', icon: Radio, view: { name: 'company' }, match: ['company'] }
    ]
  },
  {
    label: '설정 · 관리',
    collapsible: true,
    items: [
      { key: 'settings', label: '설정', icon: Settings, view: { name: 'settings' }, match: ['settings'] },
      { key: 'staff-table', label: '전 직원 정리표', icon: UsersRound, view: { name: 'staff-table' }, match: ['staff-table'] },
      { key: 'staff-overview', label: '직원 현황', icon: UsersRound, view: { name: 'staff-overview' }, match: ['staff-overview'] },
      { key: 'staff-team', label: '직원 / 팀 관리', icon: UsersRound, view: { name: 'staff-team' }, match: ['staff-team'] },
      { key: 'staff-login', label: '직원 로그인 관리', icon: UserRound, view: { name: 'staff-login' }, match: ['staff-login'] },
      { key: 'announcements', label: '공지사항 관리', icon: Megaphone, view: { name: 'announcements' }, match: ['announcements'] },
      { key: 'registration-admin', label: '고객등록 관리', icon: ShieldCheck, view: { name: 'registration-admin' }, match: ['registration-admin'] },
      { key: 'approvals', label: '승인 센터', icon: ShieldCheck, view: { name: 'approvals' }, match: ['approvals'] }
    ]
  },
  {
    label: '개발 · 자동화',
    collapsible: true,
    items: [
      { key: 'devprompt', label: '자비스 자동개발', icon: Terminal, view: { name: 'devprompt' }, match: ['devprompt'] },
      { key: 'autopilot', label: '오토파일럿', icon: Rocket, view: { name: 'autopilot' }, match: ['autopilot'] },
      { key: 'app-builder', label: '범용 앱 빌더', icon: Boxes, view: { name: 'app-builder' }, match: ['app-builder'] },
      { key: 'devos', label: '개발 OS', icon: Cpu, view: { name: 'devos' }, match: ['devos'] },
      { key: 'security-center', label: '보안 모듈 학습', icon: Radar, view: { name: 'security-center' }, match: ['security-center'] },
      { key: 'workers', label: 'AI 워커', icon: Users, view: { name: 'workers' }, match: ['workers', 'worker'] },
      { key: 'backlog', label: '제품 백로그', icon: ClipboardList, view: { name: 'backlog' }, match: ['backlog'] },
      { key: 'projects', label: '프로젝트', icon: FolderKanban, view: { name: 'projects' }, match: ['projects'] }
    ]
  },
  {
    label: '운영 · 기타',
    collapsible: true,
    items: [
      { key: 'pm', label: 'PM 플래너', icon: KanbanSquare, view: { name: 'pm' }, match: ['pm'] },
      { key: 'cto', label: 'CTO 룸', icon: Gauge, view: { name: 'cto' }, match: ['cto'] },
      { key: 'qa', label: 'QA 센터', icon: ClipboardCheck, view: { name: 'qa' }, match: ['qa'] },
      { key: 'release', label: '릴리즈 센터', icon: PackageCheck, view: { name: 'release' }, match: ['release'] },
      { key: 'devops', label: 'DevOps 센터', icon: Server, view: { name: 'devops' }, match: ['devops'] },
      { key: 'activity', label: '활동 로그', icon: Activity, view: { name: 'activity' }, match: ['activity'] }
    ]
  }
]

/**
 * Simplified, staff-facing menu (직원 모드). Maps to the same existing routes as
 * CEO mode with friendlier labels — no new pages, no permission blocking. The
 * 자비스 button below the nav is available in both modes.
 */
const STAFF_NAV: NavItem[] = [
  { key: 'home', label: '홈', icon: Home, view: { name: 'staff-home' }, match: ['staff-home'] },
  { key: 'schedule', label: '오늘 일정', icon: CalendarDays, view: { name: 'schedule' }, match: ['schedule'] },
  { key: 'customer', label: '고객', icon: UserRound, view: { name: 'customer' }, match: ['customer'] },
  { key: 'sales-activity', label: '영업활동', icon: ActivityIcon, view: { name: 'sales-activity' }, match: ['sales-activity'] },
  { key: 'performance', label: '실적', icon: BarChart3, view: { name: 'performance' }, match: ['performance'] },
  { key: 'consultation', label: '상담', icon: ClipboardListIcon, view: { name: 'consultation' }, match: ['consultation'] },
  { key: 'insurance-analysis', label: '보험분석', icon: FileSearch, view: { name: 'insurance-analysis' }, match: ['insurance-analysis'] },
  { key: 'claim-assistant', label: '보험금 청구비서', icon: ReceiptText, view: { name: 'claim-assistant' }, match: ['claim-assistant'] },
  { key: 'wiki', label: '보험 백과사전', icon: BookOpen, view: { name: 'wiki' }, match: ['wiki'] },
  { key: 'fcos', label: '내 업무', icon: Briefcase, view: { name: 'fcos' }, match: ['fcos'] }
]

/**
 * Staff commercial-MVP menu (FC / 팀장). Maps to the same existing routes with a
 * clean, company-app feel. Team leaders additionally get 팀 현황. Developer /
 * release / deployment / admin menus are NOT included here — they stay owner/admin
 * only. Every route is still access-guarded in the Router.
 */
const STAFF_NAV_MVP: NavItem[] = [
  { key: 'home', label: '홈', icon: Home, view: { name: 'staff-home' }, match: ['staff-home'] },
  { key: 'attendance', label: '출퇴근', icon: Clock, view: { name: 'attendance' }, match: ['attendance'] },
  { key: 'customer', label: '고객관리', icon: UserRound, view: { name: 'customer' }, match: ['customer'] },
  { key: 'consultation', label: '상담기록', icon: ClipboardListIcon, view: { name: 'consultation' }, match: ['consultation'] },
  { key: 'claim-assistant', label: '보험금 청구비서', icon: ReceiptText, view: { name: 'claim-assistant' }, match: ['claim-assistant'] },
  { key: 'wiki', label: '보험 백과사전', icon: BookOpen, view: { name: 'wiki' }, match: ['wiki'] },
  { key: 'schedule', label: '일정관리', icon: CalendarDays, view: { name: 'schedule' }, match: ['schedule'] },
  { key: 'performance', label: '실적관리', icon: BarChart3, view: { name: 'performance' }, match: ['performance'] },
  { key: 'notice', label: '공지사항', icon: Megaphone, view: { name: 'notice' }, match: ['notice'] }
]
const TEAM_LEADER_EXTRA: NavItem = { key: 'team-leader', label: '팀 현황', icon: UsersRound, view: { name: 'team-leader' }, match: ['team-leader'] }

const MODE_LABEL: Record<AppMode, string> = { ceo: '대표 모드', staff: '직원 모드' }

export default function Sidebar(): JSX.Element {
  const { route, navigate } = useNavigation()
  const { mode, setMode } = useAppMode()
  const { session, logout, switchUser } = useSession()
  const admin = isAdminRole(session.role)

  // Advanced/admin groups start collapsed to keep the main menu clean; a group
  // still auto-expands when the active route lives inside it (see render below).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const g of NAV_GROUPS) if (g.collapsible) init[g.label] = true
    return init
  })

  // Switching mode never blocks a route; but if the current view is not in the
  // staff menu, land the user on the staff home so the sidebar stays coherent.
  const switchMode = (next: AppMode): void => {
    setMode(next)
    if (next === 'staff' && !STAFF_NAV.some((item) => item.match.includes(route.name))) {
      navigate({ name: 'staff-home' })
    }
  }

  // Menu for a non-admin role (FC / 팀장). Team leaders also get 팀 현황.
  const staffNav: NavItem[] =
    session.role === 'team-leader' ? [...STAFF_NAV_MVP, TEAM_LEADER_EXTRA] : STAFF_NAV_MVP

  const renderItem = ({ key, label, icon: Icon, view, match }: NavItem): JSX.Element => {
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
        <Icon className={['h-4 w-4 shrink-0', active ? 'text-white' : 'text-slate-500'].join(' ')} />
        {label}
      </button>
    )
  }

  return (
    <aside className="flex w-64 flex-col border-r border-slate-800 bg-white shadow-sm">
      <div className="flex items-center border-b border-slate-800 px-5 py-5">
        <BrandLogo markClassName="h-9" wordmarkClassName="text-lg" showTagline />
      </div>

      {/* CEO / Staff mode switch — owner/admin only */}
      {admin ? (
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
      ) : null}

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {!admin ? (
          // FC / 팀장: staff-only company menu (no developer/release/admin tools).
          <div className="space-y-1">{staffNav.map(renderItem)}</div>
        ) : mode === 'staff' ? (
          <div className="space-y-1">{STAFF_NAV.map(renderItem)}</div>
        ) : (
          <div className="space-y-4">
            {NAV_GROUPS.map((group) => {
              const hasActive = group.items.some((it) => it.match.includes(route.name))
              const isCollapsed = !!group.collapsible && collapsed[group.label] && !hasActive
              return (
                <div key={group.label} className="space-y-1">
                  {group.collapsible ? (
                    <button
                      type="button"
                      onClick={() => setCollapsed((c) => ({ ...c, [group.label]: !c[group.label] }))}
                      className="flex w-full items-center justify-between rounded-lg px-3 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition hover:text-slate-300"
                    >
                      <span>{group.label}</span>
                      {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  ) : (
                    <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                      {group.label}
                    </div>
                  )}
                  {!isCollapsed ? group.items.map(renderItem) : null}
                </div>
              )
            })}
          </div>
        )}
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

      {/* Session footer: current user + logout, plus an admin-only quick switcher */}
      <div className="border-t border-slate-800 px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-slate-200">{session.name}</div>
            <div className="text-[10px] text-slate-500">{ROLE_LABEL[session.role]}{session.teamName ? ` · ${session.teamName}` : ''}</div>
          </div>
          <button type="button" onClick={logout} title="로그아웃" aria-label="로그아웃" className="shrink-0 rounded-lg border border-slate-700 p-1.5 text-slate-400 transition hover:text-rose-300">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
        {admin ? (
          <div>
            <div className="mb-1 px-1 text-[9px] font-bold uppercase tracking-wider text-slate-600">역할 전환 (개발용)</div>
            <div className="flex flex-wrap gap-1">
              {DEMO_USERS.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => switchUser(u.id)}
                  className={[
                    'rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition',
                    session.id === u.id ? 'border-indigo-500/40 bg-indigo-500/20 text-indigo-300' : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:text-slate-200'
                  ].join(' ')}
                >
                  {u.name}·{ROLE_LABEL[u.role]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-2 px-1 text-[10px] text-slate-600">SJ INVEST · 보험 업무 플랫폼</div>
      </div>
    </aside>
  )
}
