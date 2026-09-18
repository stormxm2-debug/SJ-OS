import { useEffect, useRef, useState } from 'react'
import { Home, Clock, UserRound, CalendarDays, Menu, ShieldAlert, RefreshCw, Camera, Loader2 } from 'lucide-react'
import { captureAndShareElement } from '@renderer/services/share/screenCapture'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { View, ViewName } from '@renderer/navigation/types'
import { useSession } from '@renderer/navigation/SessionContext'
import BrandLogo from '@renderer/components/brand/BrandLogo'
import InsurerLinksMenu from '@renderer/components/navigation/InsurerLinksMenu'
import { ROLE_LABEL, routeCategory, canAccessRoute, type UserRole } from '@renderer/navigation/roleAccess'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'
import JarvisPanel from '@renderer/components/jarvis/JarvisPanel'
import JarvisClapListener from '@renderer/components/jarvis/JarvisClapListener'
import MobileHome from '@renderer/components/mobile/MobileHome'
import MobilePerformance from '@renderer/components/mobile/MobilePerformance'
import SalaryCalculatorPage from '@renderer/pages/SalaryCalculatorPage'
import MobileMenuPage from '@renderer/components/mobile/MobileMenuPage'
import SupabaseCustomerManager from '@renderer/components/customer/SupabaseCustomerManager'
import SupabaseConsultationManager from '@renderer/components/consultation/SupabaseConsultationManager'
import SupabaseScheduleManager from '@renderer/components/schedule/SupabaseScheduleManager'
import SharedSchedulePage from '@renderer/pages/SharedSchedulePage'
import SupabaseAttendanceManager from '@renderer/components/attendance/SupabaseAttendanceManager'
import InsuranceAnalysisPage from '@renderer/pages/InsuranceAnalysisPage'
import CoverageAnalysisPage from '@renderer/pages/CoverageAnalysisPage'
import HospitalCoveragePage from '@renderer/pages/HospitalCoveragePage'
import InsuranceWikiPage from '@renderer/pages/InsuranceWikiPage'
import UnderwritingGuidePage from '@renderer/pages/UnderwritingGuidePage'
import PreUnderwritingPage from '@renderer/pages/PreUnderwritingPage'
import ExceptionDiseasePage from '@renderer/pages/ExceptionDiseasePage'
import LeadDistributionPage from '@renderer/pages/LeadDistributionPage'
import ReferralEnginePage from '@renderer/pages/ReferralEnginePage'
import TodayContactsPage from '@renderer/pages/TodayContactsPage'
import PlanRequestPage from '@renderer/pages/PlanRequestPage'
import ManagerContactsPage from '@renderer/pages/ManagerContactsPage'
import InsuranceClaimAssistantPage from '@renderer/pages/InsuranceClaimAssistantPage'
import ExemptionsPage from '@renderer/pages/ExemptionsPage'
import SharedFilesPage from '@renderer/pages/SharedFilesPage'
import AppInstallPage from '@renderer/pages/AppInstallPage'
import StaffOverviewPage from '@renderer/pages/StaffOverviewPage'
import StaffTablePage from '@renderer/pages/StaffTablePage'
import FamilyBirthdayAdminPage from '@renderer/pages/FamilyBirthdayAdminPage'
import SalesActivityWorkspacePage from '@renderer/pages/SalesActivityWorkspacePage'
import KnowledgeBriefingPage from '@renderer/pages/KnowledgeBriefingPage'
import FamilyCaregiverPage from '@renderer/pages/FamilyCaregiverPage'
import FcOsPage from '@renderer/pages/FcOsPage'
import FamilyBirthdayGate from '@renderer/components/welfare/FamilyBirthdayGate'
import PasswordChangeGate from '@renderer/components/security/PasswordChangeGate'
import ErrorBoundary from '@renderer/components/system/ErrorBoundary'
import RegistrationAdminPage from '@renderer/pages/RegistrationAdminPage'
import StaffLoginAdminPage from '@renderer/pages/StaffLoginAdminPage'
import Dashboard from '@renderer/components/dashboard/Dashboard'
import CommandCenterPage from '@renderer/pages/CommandCenterPage'
import AnnouncementAdminPage from '@renderer/pages/AnnouncementAdminPage'
import ApprovalCenterPage from '@renderer/pages/ApprovalCenterPage'
import NotificationCenter from '@renderer/components/notifications/NotificationCenter'
import MorningBriefing from '@renderer/components/notifications/MorningBriefing'
import ResolutionLockGate from '@renderer/components/attendance/ResolutionLockGate'
import NoticePage from '@renderer/pages/NoticePage'
import BirthdayPage from '@renderer/pages/BirthdayPage'
import StatsReportPage from '@renderer/pages/StatsReportPage'
import ContentStudioPage from '@renderer/pages/ContentStudioPage'
import { useWakeKey } from '@renderer/services/commercial/wakeResync'

/**
 * Mobile-first staff shell: top bar + scrollable content + bottom tab nav. Shows
 * ONLY staff/mobile workflows — developer/release/deployment tools are hidden for
 * every role on mobile. No fullscreen blocking backdrop; the 더보기 sheet is a
 * non-modal panel above the tab bar. Reuses the shared Supabase managers so mobile
 * and desktop share the same data path.
 */

const TABS: { key: string; label: string; icon: typeof Home; view: View; match: ViewName[] }[] = [
  { key: 'home', label: '홈', icon: Home, view: { name: 'staff-home' }, match: ['staff-home'] },
  { key: 'attendance', label: '출퇴근', icon: Clock, view: { name: 'attendance' }, match: ['attendance'] },
  { key: 'customer', label: '고객', icon: UserRound, view: { name: 'customer' }, match: ['customer'] },
  { key: 'schedule', label: '일정', icon: CalendarDays, view: { name: 'schedule' }, match: ['schedule'] }
]

export default function MobileShell(): JSX.Element {
  const { route, navigate } = useNavigation()
  const { session, logout } = useSession()
  const [moreOpen, setMoreOpen] = useState(false)
  // 폰 절전/백그라운드 복귀 시 전체 재조회 (잠들었다 깨어난 화면의 옛 데이터 문제 해결)
  const { wakeKey, lastSyncAt, refresh } = useWakeKey()

  // 화면 캡처 → 카톡 공유 (현재 콘텐츠 영역을 이미지로 떠서 공유창으로)
  const mainRef = useRef<HTMLElement>(null)
  const [snapBusy, setSnapBusy] = useState(false)
  const [snapNote, setSnapNote] = useState<string | null>(null)
  const snap = async (): Promise<void> => {
    if (!mainRef.current || snapBusy) return
    setSnapBusy(true)
    const res = await captureAndShareElement(mainRef.current)
    setSnapBusy(false)
    setSnapNote(res.message ?? null)
    if (res.message) window.setTimeout(() => setSnapNote(null), 5000)
  }

  // Interaction watchdog (same guarantee as desktop): never leave the app unclickable.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (typeof document === 'undefined') return
      if (document.body.style.pointerEvents === 'none') document.body.style.pointerEvents = ''
      if (document.documentElement.style.pointerEvents === 'none') document.documentElement.style.pointerEvents = ''
    }, 5000)
    return () => window.clearInterval(id)
  }, [])

  const go = (view: View): void => {
    setMoreOpen(false)
    navigate(view)
  }

  // 뒤로가기(popstate)로 화면이 바뀐 경우에도 전체 메뉴가 떠 있지 않게 닫는다.
  useEffect(() => {
    setMoreOpen(false)
  }, [route.name])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-200">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <BrandLogo markClassName="h-7" wordmarkClassName="text-base" />
          <span className="truncate text-[10px] text-slate-500">{session.name || '직원'} · {ROLE_LABEL[session.role]}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <InsurerLinksMenu compact />
          <button
            type="button"
            onClick={() => void snap()}
            disabled={snapBusy}
            className="flex items-center gap-1 rounded-full border border-[#c6982f] bg-[#fdf7ea] px-2 py-1 text-[10px] font-bold text-[#8a6a1f] active:brightness-95 disabled:opacity-60"
            aria-label="화면 캡처해서 공유"
          >
            {snapBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
            캡처
          </button>
          <button
            type="button"
            onClick={refresh}
            className="flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-600 active:bg-[#e0e7ff]"
            aria-label="새로고침"
          >
            <RefreshCw className="h-3 w-3" />
            {lastSyncAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
          </button>
        </div>
      </header>

      {/* 캡처 결과 안내 (폴백/실패 시에만) */}
      {snapNote ? (
        <div className="fixed inset-x-4 top-14 z-[60] rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-center text-[11px] font-semibold text-amber-800 shadow-lg">
          {snapNote}
        </div>
      ) : null}

      {/* Content — wakeKey 리마운트로 복귀 시 모든 화면 재조회 */}
      <main ref={mainRef} key={wakeKey} className="flex-1 overflow-y-auto overflow-x-hidden p-3 pb-24">
        {/* 한 화면이 렌더 중 죽어도 앱 전체가 백화면이 되지 않게 막는다 */}
        <ErrorBoundary key={route.name} onGoHome={() => navigate({ name: 'staff-home' })}>
          <MobileContent routeName={route.name} role={session.role} />
        </ErrorBoundary>
      </main>

      {/* 전체 메뉴 — 더보기를 누르면 새 창처럼 전체 화면으로 열린다 */}
      {moreOpen ? (
        <MobileMenuPage
          onClose={() => setMoreOpen(false)}
          onNavigate={go}
          onJarvis={() => {
            setMoreOpen(false)
            jarvisService.open()
          }}
          onLogout={() => {
            setMoreOpen(false)
            logout()
          }}
        />
      ) : null}

      {/* Bottom tab nav */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex h-16 items-stretch border-t border-slate-800 bg-white">
        {TABS.map((t) => {
          const active = t.match.includes(route.name)
          const Icon = t.icon
          return (
            <button key={t.key} type="button" onClick={() => go(t.view)} className={['flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition', active ? 'text-indigo-600' : 'text-slate-500'].join(' ')}>
              <Icon className={['h-5 w-5', active ? 'text-indigo-600' : 'text-slate-400'].join(' ')} />
              {t.label}
            </button>
          )
        })}
        <button type="button" onClick={() => setMoreOpen((v) => !v)} className={['flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition', moreOpen ? 'text-indigo-600' : 'text-slate-500'].join(' ')}>
          <Menu className={['h-5 w-5', moreOpen ? 'text-indigo-600' : 'text-slate-400'].join(' ')} />
          더보기
        </button>
      </nav>

      <JarvisPanel />
      <JarvisClapListener />
      {/* wakeKey로 함께 리마운트 — 복귀 시 realtime 알림 구독을 새로 맺는다. */}
      <NotificationCenter key={`nc-${wakeKey}`} />
      {/* 하루 첫 접속 시 "오늘 접촉할 고객 N명" 브리핑 (자체생산 루틴 시작점) */}
      <MorningBriefing />
      <ResolutionLockGate key={`rg-${wakeKey}`} />
      <FamilyBirthdayGate />
      <PasswordChangeGate />
    </div>
  )
}

/** 모바일에서 관리자·총무비서에게 열어주는 관리자 라우트 (개발/배포 도구는 계속 차단). */
const MOBILE_ADMIN_ROUTES: ViewName[] = [
  'staff-overview',
  'staff-table',
  'family-birthdays',
  'registration-admin',
  'shared-schedule',
  'staff-login',
  // 폰 대표 모드 (2026-07-20 대표 지정 4종): 관제·경영 비서·공지 관리·승인
  'dashboard',
  'assistant',
  'announcements',
  'approvals'
]

/** Mobile router: staff routes only; admin/dev routes → mobile access-denied card. */
function MobileContent({ routeName, role }: { routeName: ViewName; role: UserRole }): JSX.Element {
  // Hide developer/release/deployment tools on mobile for EVERY role — except the
  // three admin pages above, which admins may open from the 전체 메뉴.
  if (routeCategory(routeName) === 'admin') {
    // 관리자 라우트 목록에 있고 + 역할이 접근 가능할 때만 허용(총무비서는 canAccessRoute가
    // 막힌 화면을 걸러낸다). 그 외 관리자/개발 라우트는 모바일에서 계속 차단.
    if (!(MOBILE_ADMIN_ROUTES.includes(routeName) && canAccessRoute(role, routeName))) return <MobileAccessDenied />
  }
  switch (routeName) {
    case 'staff-home':
      return <MobileHome />
    case 'attendance':
      return <SupabaseAttendanceManager />
    case 'customer':
      return <SupabaseCustomerManager />
    case 'birthdays':
      return <BirthdayPage />
    case 'stats-report':
      return <StatsReportPage />
    case 'knowledge':
      return <KnowledgeBriefingPage />
    case 'family-caregiver':
      return <FamilyCaregiverPage />
    case 'content-studio':
      return <ContentStudioPage />
    case 'consultation':
      return <SupabaseConsultationManager />
    case 'schedule':
      return <SupabaseScheduleManager />
    case 'shared-schedule':
      return <SharedSchedulePage />
    case 'performance':
      return <MobilePerformance />
    case 'salary':
      return <SalaryCalculatorPage />
    case 'insurance-analysis':
      return <InsuranceAnalysisPage />
    case 'coverage-analysis':
      return <CoverageAnalysisPage />
    case 'hospital-coverage':
      return <HospitalCoveragePage />
    case 'claim-assistant':
      return <InsuranceClaimAssistantPage />
    case 'exemptions':
      return <ExemptionsPage />
    case 'wiki':
      return <InsuranceWikiPage />
    case 'underwriting':
      return <UnderwritingGuidePage />
    case 'pre-underwriting':
      return <PreUnderwritingPage />
    case 'disease-exceptions':
      return <ExceptionDiseasePage />
    case 'leads':
      return <LeadDistributionPage />
    case 'referrals':
      return <ReferralEnginePage />
    case 'today-contacts':
      return <TodayContactsPage />
    case 'plan-request':
      return <PlanRequestPage />
    case 'contacts':
      return <ManagerContactsPage />
    case 'files':
      return <SharedFilesPage />
    case 'app-install':
      return <AppInstallPage />
    case 'notice':
      return <NoticePage />
    case 'staff-overview':
      return <StaffOverviewPage />
    case 'family-birthdays':
      return <FamilyBirthdayAdminPage />
    // 경영 비서의 [화면 열기]가 sales-activity로 보내는데 케이스가 없어 홈으로 튕겼다.
    case 'sales-activity':
      return <SalesActivityWorkspacePage />
    case 'fcos':
      return <FcOsPage />
    case 'staff-table':
      return <StaffTablePage />
    case 'registration-admin':
      return <RegistrationAdminPage />
    case 'dashboard':
      return <Dashboard />
    case 'assistant':
      return <CommandCenterPage />
    case 'announcements':
      return <AnnouncementAdminPage />
    case 'approvals':
      return <ApprovalCenterPage />
    case 'staff-login':
      return <StaffLoginAdminPage />
    default:
      return <MobileHome />
  }
}

function MobileAccessDenied(): JSX.Element {
  const { navigate } = useNavigation()
  return (
    <div className="mt-8 rounded-2xl border border-slate-800 bg-white p-6 text-center shadow-sm">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50">
        <ShieldAlert className="h-6 w-6 text-amber-600" />
      </div>
      <h2 className="text-base font-bold text-slate-100">관리자 기능</h2>
      <p className="mt-1.5 text-sm text-slate-500">모바일에서는 사용할 수 없는 관리자 기능입니다.</p>
      <button type="button" onClick={() => navigate({ name: 'staff-home' })} className="mt-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white">홈으로 이동</button>
    </div>
  )
}
