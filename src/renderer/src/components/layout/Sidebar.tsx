import {
  BookOpen,
  Sparkles,
  LayoutDashboard,
  UserRound,
  Activity as ActivityIcon,
  CalendarDays,
  BarChart3,
  Calculator,
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
  Share2,
  Stethoscope,
  ShieldQuestion,
  HeartPulse,
  ListChecks,
  Phone,
  FolderOpen,
  Cake,
  KeyRound,
  BookMarked,
  TrendingUp,
  UserPlus,
  PhoneCall,
  Hourglass,
  Briefcase,
  ExternalLink,
  FileSignature,
  Clapperboard,
  Download,
  Pencil,
  Check,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  RotateCcw
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { isNewFeature, subscribeNewFeatures } from '@renderer/navigation/newFeatures'
import type { View, ViewName } from '@renderer/navigation/types'
import { useAppMode, type AppMode } from '@renderer/navigation/AppModeContext'
import { useSession } from '@renderer/navigation/SessionContext'
import { DEMO_USERS, ROLE_LABEL, isAdminRole, canAccessRoute, canSeeAdminMenu } from '@renderer/navigation/roleAccess'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'
import { openFamilyBirthdayGate } from '@renderer/services/commercial/familyBirthdayService'
import { openPasswordGate } from '@renderer/services/commercial/passwordService'
import BrandLogo from '@renderer/components/brand/BrandLogo'
import {
  loadSidebarPrefs,
  subscribeSidebarPrefs,
  orderSidebarItems,
  isSidebarItemHidden,
  moveSidebarItem,
  toggleSidebarItemHidden,
  resetSidebarPrefs
} from './sidebarPrefs'

type NavItem = {
  key: string
  label: string
  icon: typeof LayoutDashboard
  view?: View
  match?: ViewName[]
  /** 외부 사이트 바로가기 — 새 탭(웹)/기본 브라우저(데스크톱)로 연다. */
  href?: string
  /** 화면 이동 대신 실행하는 동작 (예: 인사 정보 / 비밀번호 변경 창 열기) */
  action?: 'birthday-gate' | 'password-gate'
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
      { key: 'birthdays', label: '생일 챙기기', icon: Cake, view: { name: 'birthdays' }, match: ['birthdays'] },
      { key: 'referrals', label: '소개 영업', icon: UserPlus, view: { name: 'referrals' }, match: ['referrals'] },
      { key: 'today-contacts', label: '오늘의 접촉', icon: PhoneCall, view: { name: 'today-contacts' }, match: ['today-contacts'] },
      { key: 'plan-request', label: '설계 요청서', icon: FileSignature, view: { name: 'plan-request' }, match: ['plan-request'] },
      { key: 'consultation', label: '상담 관리', icon: ClipboardListIcon, view: { name: 'consultation' }, match: ['consultation'] },
      { key: 'insurance-analysis', label: '보험분석', icon: FileSearch, view: { name: 'insurance-analysis' }, match: ['insurance-analysis'] },
      { key: 'bojang114', label: '한장보험료 비교', icon: ExternalLink, href: 'https://samsung.bojang114.com/index.html' },
      { key: 'claim-assistant', label: '보험금 청구비서', icon: ReceiptText, view: { name: 'claim-assistant' }, match: ['claim-assistant'] },
      { key: 'exemptions', label: '면책기간 알람', icon: Hourglass, view: { name: 'exemptions' }, match: ['exemptions'] },
      { key: 'wiki', label: '보험 백과사전', icon: BookOpen, view: { name: 'wiki' }, match: ['wiki'] },
      { key: 'content-studio', label: 'AI 콘텐츠 스튜디오', icon: Clapperboard, view: { name: 'content-studio' }, match: ['content-studio'] },
  { key: 'knowledge', label: '자료 브리핑', icon: BookMarked, view: { name: 'knowledge' }, match: ['knowledge'] },
      { key: 'underwriting', label: '인수 가이드', icon: Stethoscope, view: { name: 'underwriting' }, match: ['underwriting'] },
      { key: 'pre-underwriting', label: 'AI 사전심사', icon: ShieldQuestion, view: { name: 'pre-underwriting' }, match: ['pre-underwriting'] },
      { key: 'disease-exceptions', label: '유병자 예외질환', icon: HeartPulse, view: { name: 'disease-exceptions' }, match: ['disease-exceptions'] },
      { key: 'leads', label: 'DB 배정', icon: ListChecks, view: { name: 'leads' }, match: ['leads'] },
      { key: 'contacts', label: '매니저 연락처', icon: Phone, view: { name: 'contacts' }, match: ['contacts'] },
      { key: 'files', label: '자료실', icon: FolderOpen, view: { name: 'files' }, match: ['files'] },
      { key: 'app-install', label: '앱 설치·배포', icon: Download, view: { name: 'app-install' }, match: ['app-install'] }
    ]
  },
  {
    label: '영업활동',
    items: [
      { key: 'sales-activity', label: '영업활동', icon: ActivityIcon, view: { name: 'sales-activity' }, match: ['sales-activity'] },
      { key: 'performance', label: '실적', icon: BarChart3, view: { name: 'performance' }, match: ['performance'] },
      { key: 'salary', label: '급여 계산기', icon: Calculator, view: { name: 'salary' }, match: ['salary'] },
      { key: 'stats-report', label: '통계 리포트', icon: TrendingUp, view: { name: 'stats-report' }, match: ['stats-report'] }
    ]
  },
  {
    label: 'AI 업무지원',
    items: [
      { key: 'assistant', label: '경영 비서', icon: Sparkles, view: { name: 'assistant' }, match: ['assistant'] }
    ]
  },
  {
    label: '설정 · 관리',
    collapsible: true,
    items: [
      { key: 'staff-table', label: '전 직원 정리표', icon: UsersRound, view: { name: 'staff-table' }, match: ['staff-table'] },
      { key: 'staff-overview', label: '직원 현황', icon: UsersRound, view: { name: 'staff-overview' }, match: ['staff-overview'] },
      { key: 'family-birthdays', label: '직원 생일 복지', icon: Cake, view: { name: 'family-birthdays' }, match: ['family-birthdays'] },
      { key: 'shared-schedule', label: '공유 일정 (전 직원)', icon: Share2, view: { name: 'shared-schedule' }, match: ['shared-schedule'] },
      { key: 'staff-team', label: '직원 / 팀 관리', icon: UsersRound, view: { name: 'staff-team' }, match: ['staff-team'] },
      { key: 'staff-login', label: '직원 로그인 관리', icon: UserRound, view: { name: 'staff-login' }, match: ['staff-login'] },
      { key: 'announcements', label: '공지사항 관리', icon: Megaphone, view: { name: 'announcements' }, match: ['announcements'] },
      { key: 'registration-admin', label: '고객등록 관리', icon: ShieldCheck, view: { name: 'registration-admin' }, match: ['registration-admin'] },
      { key: 'approvals', label: '승인 센터', icon: ShieldCheck, view: { name: 'approvals' }, match: ['approvals'] },
      // 아래 4개는 '직원 본인용' 항목 — 총무비서는 대표/직원 모드 토글이 없어 STAFF_NAV에
      // 닿지 못하므로(관리자 메뉴만 렌더) 여기에도 둬야 출퇴근·공지·비밀번호 변경을 쓸 수 있다.
      // 관리자에게는 중복 노출이지만 canAccessRoute로 걸러지지 않는 공용 화면이라 무해하다.
      { key: 'attendance', label: '출퇴근', icon: Clock, view: { name: 'attendance' }, match: ['attendance'] },
      { key: 'notice', label: '공지사항', icon: Megaphone, view: { name: 'notice' }, match: ['notice'] },
      { key: 'my-birthday', label: '내 인사 정보', icon: ClipboardListIcon, action: 'birthday-gate' },
      { key: 'my-password', label: '비밀번호 변경', icon: KeyRound, action: 'password-gate' }
    ]
  },
  {
    label: '개발 · 자동화',
    collapsible: true,
    items: [
      { key: 'devprompt', label: '자비스 자동개발', icon: Terminal, view: { name: 'devprompt' }, match: ['devprompt'] },
      { key: 'autopilot', label: '오토파일럿', icon: Rocket, view: { name: 'autopilot' }, match: ['autopilot'] },
      { key: 'app-builder', label: '범용 앱 빌더', icon: Boxes, view: { name: 'app-builder' }, match: ['app-builder'] },
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
      { key: 'devops', label: 'DevOps 센터', icon: Server, view: { name: 'devops' }, match: ['devops'] }
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
  { key: 'birthdays', label: '생일 챙기기', icon: Cake, view: { name: 'birthdays' }, match: ['birthdays'] },
  { key: 'referrals', label: '소개 영업', icon: UserPlus, view: { name: 'referrals' }, match: ['referrals'] },
  { key: 'today-contacts', label: '오늘의 접촉', icon: PhoneCall, view: { name: 'today-contacts' }, match: ['today-contacts'] },
  { key: 'plan-request', label: '설계 요청서', icon: FileSignature, view: { name: 'plan-request' }, match: ['plan-request'] },
  { key: 'sales-activity', label: '영업활동', icon: ActivityIcon, view: { name: 'sales-activity' }, match: ['sales-activity'] },
  { key: 'performance', label: '실적', icon: BarChart3, view: { name: 'performance' }, match: ['performance'] },
  { key: 'salary', label: '급여 계산기', icon: Calculator, view: { name: 'salary' }, match: ['salary'] },
  { key: 'stats-report', label: '통계 리포트', icon: TrendingUp, view: { name: 'stats-report' }, match: ['stats-report'] },
  { key: 'consultation', label: '상담', icon: ClipboardListIcon, view: { name: 'consultation' }, match: ['consultation'] },
  { key: 'insurance-analysis', label: '보험분석', icon: FileSearch, view: { name: 'insurance-analysis' }, match: ['insurance-analysis'] },
  { key: 'bojang114', label: '한장보험료 비교', icon: ExternalLink, href: 'https://samsung.bojang114.com/index.html' },
  { key: 'claim-assistant', label: '보험금 청구비서', icon: ReceiptText, view: { name: 'claim-assistant' }, match: ['claim-assistant'] },
  { key: 'exemptions', label: '면책기간 알람', icon: Hourglass, view: { name: 'exemptions' }, match: ['exemptions'] },
  { key: 'wiki', label: '보험 백과사전', icon: BookOpen, view: { name: 'wiki' }, match: ['wiki'] },
  { key: 'content-studio', label: 'AI 콘텐츠 스튜디오', icon: Clapperboard, view: { name: 'content-studio' }, match: ['content-studio'] },
  { key: 'knowledge', label: '자료 브리핑', icon: BookMarked, view: { name: 'knowledge' }, match: ['knowledge'] },
  { key: 'underwriting', label: '인수 가이드', icon: Stethoscope, view: { name: 'underwriting' }, match: ['underwriting'] },
  { key: 'pre-underwriting', label: 'AI 사전심사', icon: ShieldQuestion, view: { name: 'pre-underwriting' }, match: ['pre-underwriting'] },
  { key: 'disease-exceptions', label: '유병자 예외질환', icon: HeartPulse, view: { name: 'disease-exceptions' }, match: ['disease-exceptions'] },
  { key: 'leads', label: 'DB 배정', icon: ListChecks, view: { name: 'leads' }, match: ['leads'] },
  { key: 'contacts', label: '매니저 연락처', icon: Phone, view: { name: 'contacts' }, match: ['contacts'] },
  { key: 'files', label: '자료실', icon: FolderOpen, view: { name: 'files' }, match: ['files'] },
  { key: 'app-install', label: '앱 설치·배포', icon: Download, view: { name: 'app-install' }, match: ['app-install'] },
  { key: 'my-birthday', label: '내 인사 정보', icon: ClipboardListIcon, action: 'birthday-gate' },
  { key: 'my-password', label: '비밀번호 변경', icon: KeyRound, action: 'password-gate' }
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
  { key: 'birthdays', label: '생일 챙기기', icon: Cake, view: { name: 'birthdays' }, match: ['birthdays'] },
  { key: 'referrals', label: '소개 영업', icon: UserPlus, view: { name: 'referrals' }, match: ['referrals'] },
  { key: 'today-contacts', label: '오늘의 접촉', icon: PhoneCall, view: { name: 'today-contacts' }, match: ['today-contacts'] },
  { key: 'plan-request', label: '설계 요청서', icon: FileSignature, view: { name: 'plan-request' }, match: ['plan-request'] },
  { key: 'consultation', label: '상담기록', icon: ClipboardListIcon, view: { name: 'consultation' }, match: ['consultation'] },
  { key: 'bojang114', label: '한장보험료 비교', icon: ExternalLink, href: 'https://samsung.bojang114.com/index.html' },
  { key: 'claim-assistant', label: '보험금 청구비서', icon: ReceiptText, view: { name: 'claim-assistant' }, match: ['claim-assistant'] },
  { key: 'exemptions', label: '면책기간 알람', icon: Hourglass, view: { name: 'exemptions' }, match: ['exemptions'] },
  { key: 'wiki', label: '보험 백과사전', icon: BookOpen, view: { name: 'wiki' }, match: ['wiki'] },
  { key: 'content-studio', label: 'AI 콘텐츠 스튜디오', icon: Clapperboard, view: { name: 'content-studio' }, match: ['content-studio'] },
  { key: 'knowledge', label: '자료 브리핑', icon: BookMarked, view: { name: 'knowledge' }, match: ['knowledge'] },
  { key: 'underwriting', label: '인수 가이드', icon: Stethoscope, view: { name: 'underwriting' }, match: ['underwriting'] },
  { key: 'pre-underwriting', label: 'AI 사전심사', icon: ShieldQuestion, view: { name: 'pre-underwriting' }, match: ['pre-underwriting'] },
  { key: 'disease-exceptions', label: '유병자 예외질환', icon: HeartPulse, view: { name: 'disease-exceptions' }, match: ['disease-exceptions'] },
  { key: 'leads', label: 'DB 배정', icon: ListChecks, view: { name: 'leads' }, match: ['leads'] },
  { key: 'contacts', label: '매니저 연락처', icon: Phone, view: { name: 'contacts' }, match: ['contacts'] },
  { key: 'files', label: '자료실', icon: FolderOpen, view: { name: 'files' }, match: ['files'] },
  { key: 'app-install', label: '앱 설치·배포', icon: Download, view: { name: 'app-install' }, match: ['app-install'] },
  { key: 'schedule', label: '일정관리', icon: CalendarDays, view: { name: 'schedule' }, match: ['schedule'] },
  { key: 'performance', label: '매출현황', icon: BarChart3, view: { name: 'performance' }, match: ['performance'] },
  { key: 'salary', label: '급여 계산기', icon: Calculator, view: { name: 'salary' }, match: ['salary'] },
  { key: 'stats-report', label: '통계 리포트', icon: TrendingUp, view: { name: 'stats-report' }, match: ['stats-report'] },
  { key: 'notice', label: '공지사항', icon: Megaphone, view: { name: 'notice' }, match: ['notice'] },
  { key: 'my-birthday', label: '내 인사 정보', icon: ClipboardListIcon, action: 'birthday-gate' },
  { key: 'my-password', label: '비밀번호 변경', icon: KeyRound, action: 'password-gate' }
]

const MODE_LABEL: Record<AppMode, string> = { ceo: '대표 모드', staff: '직원 모드' }

export default function Sidebar(): JSX.Element {
  const { route, navigate } = useNavigation()
  const { mode, setMode } = useAppMode()
  const { session, logout, switchUser } = useSession()
  const admin = isAdminRole(session.role)
  // 총무비서도 관리자형(그룹) 메뉴를 보되, 개별 항목은 canAccessRoute 로 다시 걸러
  // 막힌 화면(CEO 대시보드·직원/팀 관리·개발도구)은 숨긴다.
  const showAdminMenu = canSeeAdminMenu(session.role)

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
    if (next === 'staff' && !STAFF_NAV.some((item) => item.match?.includes(route.name))) {
      navigate({ name: 'staff-home' })
    }
  }

  // Menu for a non-admin role (FC / 팀장) — 팀 현황 라우트 제거로 역할별 차이 없음.
  const staffNav: NavItem[] = STAFF_NAV_MVP

  // NEW 뱃지: 2번째 방문 직후 리렌더 없이도 뱃지가 바로 사라지도록 구독한다.
  const [, bumpNewFeatures] = useState(0)
  useEffect(() => subscribeNewFeatures(() => bumpNewFeatures((v) => v + 1)), [])

  // 회원별 메뉴 순서·숨김 (기기별) — 모바일 전체 메뉴 편집과 같은 원칙.
  const [editNav, setEditNav] = useState(false)
  const [navPrefs, setNavPrefs] = useState(() => loadSidebarPrefs())
  useEffect(() => subscribeSidebarPrefs(() => setNavPrefs(loadSidebarPrefs())), [])

  const renderItem = ({ key, label, icon: Icon, view, match, href, action }: NavItem): JSX.Element => {
    const active = match?.includes(route.name) ?? false
    return (
      <button
        key={key}
        type="button"
        disabled={editNav}
        onClick={() => {
          if (action === 'birthday-gate') openFamilyBirthdayGate()
          else if (action === 'password-gate') openPasswordGate()
          else if (href) window.open(href, '_blank', 'noopener')
          else if (view) navigate(view)
        }}
        className={[
          'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
          active
            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 font-semibold text-white shadow-sm shadow-indigo-500/30'
            : 'font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-100'
        ].join(' ')}
      >
        <Icon className={['h-4 w-4 shrink-0', active ? 'text-white' : 'text-slate-500'].join(' ')} />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {view && isNewFeature(view.name) ? (
          <span className="shrink-0 rounded-full bg-[#e6c877] px-1.5 py-0.5 text-[9px] font-bold leading-none text-[#0e1e3a]">
            NEW
          </span>
        ) : null}
      </button>
    )
  }

  /**
   * 섹션(사이드바 변형·그룹)별로 저장된 순서·숨김을 적용해 목록을 그린다.
   * 편집 모드에서는 숨긴 항목도 흐리게 보여 ↑↓ 이동·숨김/복구 버튼을 단다.
   */
  const renderList = (section: string, items: NavItem[]): JSX.Element[] => {
    const ordered = orderSidebarItems(section, items, navPrefs)
    const visible = editNav ? ordered : ordered.filter((it) => !isSidebarItemHidden(section, it.key, navPrefs))
    const orderedKeys = ordered.map((it) => it.key)
    const ctrl =
      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-950 text-slate-500 transition hover:text-slate-200 disabled:opacity-30'
    return visible.map((item, i) => {
      if (!editNav) return renderItem(item)
      const hidden = isSidebarItemHidden(section, item.key, navPrefs)
      return (
        <div key={item.key} className={['flex items-center gap-1', hidden ? 'opacity-45' : ''].join(' ')}>
          <div className="min-w-0 flex-1">{renderItem(item)}</div>
          <button type="button" disabled={i === 0} onClick={() => moveSidebarItem(section, orderedKeys, item.key, -1)} className={ctrl} aria-label={`${item.label} 위로`}>
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={i === visible.length - 1}
            onClick={() => moveSidebarItem(section, orderedKeys, item.key, 1)}
            className={ctrl}
            aria-label={`${item.label} 아래로`}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => toggleSidebarItemHidden(section, item.key)}
            className={[ctrl, hidden ? 'text-[#c6982f]' : ''].join(' ')}
            aria-label={hidden ? `${item.label} 다시 보이기` : `${item.label} 숨기기`}
          >
            {hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        </div>
      )
    })
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
        {/* 메뉴 편집 — 순서 ↑↓·숨김을 내 기기에 저장 (모바일 전체 메뉴와 동일 원칙) */}
        <div className="mb-2 flex items-center justify-end gap-1">
          {editNav ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('사이드바 순서와 숨김을 기본값으로 되돌릴까요?')) resetSidebarPrefs()
              }}
              className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-bold text-slate-400 transition hover:text-slate-200"
            >
              <RotateCcw className="h-3 w-3" /> 기본 순서
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setEditNav((v) => !v)}
            className={[
              'flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold transition',
              editNav ? 'bg-[#c6982f] text-[#201603]' : 'border border-slate-700 bg-slate-950 text-slate-500 hover:text-[#e6c877]'
            ].join(' ')}
            aria-label={editNav ? '메뉴 편집 완료' : '메뉴 순서 편집'}
          >
            {editNav ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
            {editNav ? '완료' : '메뉴 편집'}
          </button>
        </div>
        {!showAdminMenu ? (
          // FC / 팀장: staff-only company menu (no developer/release/admin tools).
          <div className="space-y-1">{renderList('mvp', staffNav)}</div>
        ) : admin && mode === 'staff' ? (
          <div className="space-y-1">{renderList('staff', STAFF_NAV)}</div>
        ) : (
          <div className="space-y-4">
            {NAV_GROUPS.map((group) => {
              // 총무비서 등 역할별로 막힌 항목은 제거하고, 남는 항목이 없으면 그룹째 숨긴다.
              const items = group.items.filter((it) => !it.view || canAccessRoute(session.role, it.view.name))
              if (items.length === 0) return null
              const hasActive = items.some((it) => it.match?.includes(route.name))
              // 편집 모드에서는 접힌 그룹도 펼쳐 숨김/순서를 손볼 수 있게 한다.
              const isCollapsed = !editNav && !!group.collapsible && collapsed[group.label] && !hasActive
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
                  {!isCollapsed ? renderList(`group:${group.label}`, items) : null}
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
