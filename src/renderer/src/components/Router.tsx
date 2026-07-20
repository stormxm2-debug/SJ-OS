import { useNavigation } from '@renderer/navigation/NavigationContext'
import { useSession } from '@renderer/navigation/SessionContext'
import { canAccessRoute } from '@renderer/navigation/roleAccess'
import AccessDenied from './layout/AccessDenied'
import StaffMvpDashboard from './home/StaffMvpDashboard'
import SupabaseCustomerManager from './customer/SupabaseCustomerManager'
import SupabaseConsultationManager from './consultation/SupabaseConsultationManager'
import SupabaseScheduleManager from './schedule/SupabaseScheduleManager'
import SupabaseAttendanceManager from './attendance/SupabaseAttendanceManager'
import CommandCenterPage from '@renderer/pages/CommandCenterPage'
import StaffHomePage from '@renderer/pages/StaffHomePage'
import NoticePage from '@renderer/pages/NoticePage'
import Dashboard from './dashboard/Dashboard'
import WorkersPage from '@renderer/pages/WorkersPage'
import WorkerDetailPage from '@renderer/pages/WorkerDetailPage'
import SalesActivityWorkspacePage from '@renderer/pages/SalesActivityWorkspacePage'
import PerformancePage from '@renderer/pages/PerformancePage'
import SalaryCalculatorPage from '@renderer/pages/SalaryCalculatorPage'
import FcOsPage from '@renderer/pages/FcOsPage'
import InsuranceAnalysisPage from '@renderer/pages/InsuranceAnalysisPage'
import InsuranceClaimAssistantPage from '@renderer/pages/InsuranceClaimAssistantPage'
import ExemptionsPage from '@renderer/pages/ExemptionsPage'
import InsuranceWikiPage from '@renderer/pages/InsuranceWikiPage'
import UnderwritingGuidePage from '@renderer/pages/UnderwritingGuidePage'
import PreUnderwritingPage from '@renderer/pages/PreUnderwritingPage'
import ExceptionDiseasePage from '@renderer/pages/ExceptionDiseasePage'
import ManagerContactsPage from '@renderer/pages/ManagerContactsPage'
import LeadDistributionPage from '@renderer/pages/LeadDistributionPage'
import ReferralEnginePage from '@renderer/pages/ReferralEnginePage'
import TodayContactsPage from '@renderer/pages/TodayContactsPage'
import PlanRequestPage from '@renderer/pages/PlanRequestPage'
import SharedFilesPage from '@renderer/pages/SharedFilesPage'
import AppInstallPage from '@renderer/pages/AppInstallPage'
import UniversalAppBuilderPage from '@renderer/pages/UniversalAppBuilderPage'
import DeveloperPromptCenterPage from '@renderer/pages/DeveloperPromptCenterPage'
import AutopilotPage from '@renderer/pages/AutopilotPage'
import CtoRoomPage from '@renderer/pages/CtoRoomPage'
import QaCenterPage from '@renderer/pages/QaCenterPage'
import ReleaseCenterPage from '@renderer/pages/ReleaseCenterPage'
import DevOpsCenterPage from '@renderer/pages/DevOpsCenterPage'
import PmPlannerPage from '@renderer/pages/PmPlannerPage'
import ProductBacklogPage from '@renderer/pages/ProductBacklogPage'
import ProjectManagerPage from '@renderer/pages/ProjectManagerPage'
import ApprovalCenterPage from '@renderer/pages/ApprovalCenterPage'
import StaffLoginAdminPage from '@renderer/pages/StaffLoginAdminPage'
import StaffTeamManagementPage from '@renderer/pages/StaffTeamManagementPage'
import AnnouncementAdminPage from '@renderer/pages/AnnouncementAdminPage'
import RegistrationAdminPage from '@renderer/pages/RegistrationAdminPage'
import StaffOverviewPage from '@renderer/pages/StaffOverviewPage'
import StaffTablePage from '@renderer/pages/StaffTablePage'
import FamilyBirthdayAdminPage from '@renderer/pages/FamilyBirthdayAdminPage'
import SharedSchedulePage from '@renderer/pages/SharedSchedulePage'
import BirthdayPage from '@renderer/pages/BirthdayPage'
import StatsReportPage from '@renderer/pages/StatsReportPage'
import ContentStudioPage from '@renderer/pages/ContentStudioPage'

/** Renders the active view chosen by the navigation state. */
export default function Router(): JSX.Element {
  const { route } = useNavigation()
  const { session } = useSession()

  // Friendly role guard: non-admin roles reaching an admin/team-only route get an
  // access-denied card instead of a crash or blank screen. Owner/admin see all.
  if (!canAccessRoute(session.role, route.name)) {
    return <AccessDenied />
  }

  switch (route.name) {
    case 'assistant':
      return <CommandCenterPage />
    case 'staff-home':
      return (
        <div className="space-y-6">
          <StaffMvpDashboard />
          <StaffHomePage />
        </div>
      )
    case 'attendance':
      return <SupabaseAttendanceManager />
    case 'notice':
      return <NoticePage />
    case 'dashboard':
      return <Dashboard />
    case 'fcos':
      return <FcOsPage />
    case 'customer':
      return <SupabaseCustomerManager />
    case 'birthdays':
      return <BirthdayPage />
    case 'stats-report':
      return <StatsReportPage />
    case 'content-studio':
      return <ContentStudioPage />
    case 'sales-activity':
      return <SalesActivityWorkspacePage />
    case 'schedule':
      return <SupabaseScheduleManager />
    case 'shared-schedule':
      return <SharedSchedulePage />
    case 'performance':
      return <PerformancePage />
    case 'salary':
      return <SalaryCalculatorPage />
    case 'consultation':
      return <SupabaseConsultationManager />
    case 'insurance-analysis':
      return <InsuranceAnalysisPage />
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
    case 'app-builder':
      return <UniversalAppBuilderPage />
    case 'devprompt':
      return <DeveloperPromptCenterPage />
    case 'cto':
      return <CtoRoomPage />
    case 'qa':
      return <QaCenterPage />
    case 'release':
      return <ReleaseCenterPage />
    case 'devops':
      return <DevOpsCenterPage />
    case 'autopilot':
      return <AutopilotPage />
    case 'pm':
      return <PmPlannerPage />
    case 'backlog':
      return <ProductBacklogPage />
    case 'workers':
      return <WorkersPage />
    case 'worker':
      return <WorkerDetailPage workerId={route.workerId} tab={route.tab} />
    case 'projects':
      return <ProjectManagerPage />
    case 'approvals':
      return <ApprovalCenterPage />
    case 'staff-login':
      return <StaffLoginAdminPage />
    case 'staff-team':
      return <StaffTeamManagementPage />
    case 'announcements':
      return <AnnouncementAdminPage />
    case 'registration-admin':
      return <RegistrationAdminPage />
    case 'staff-overview':
      return <StaffOverviewPage />
    case 'staff-table':
      return <StaffTablePage />
    case 'family-birthdays':
      return <FamilyBirthdayAdminPage />
    default:
      return <Dashboard />
  }
}
