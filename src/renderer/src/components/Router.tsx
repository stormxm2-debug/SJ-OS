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
import LiveCompanyPage from '@renderer/pages/LiveCompanyPage'
import FcOsPage from '@renderer/pages/FcOsPage'
import SalesActivityWorkspacePage from '@renderer/pages/SalesActivityWorkspacePage'
import PerformancePage from '@renderer/pages/PerformancePage'
import TeamLeaderPage from '@renderer/pages/TeamLeaderPage'
import InsuranceAnalysisPage from '@renderer/pages/InsuranceAnalysisPage'
import InsuranceClaimAssistantPage from '@renderer/pages/InsuranceClaimAssistantPage'
import InsuranceWikiPage from '@renderer/pages/InsuranceWikiPage'
import UniversalAppBuilderPage from '@renderer/pages/UniversalAppBuilderPage'
import DeveloperPromptCenterPage from '@renderer/pages/DeveloperPromptCenterPage'
import AutopilotPage from '@renderer/pages/AutopilotPage'
import CtoRoomPage from '@renderer/pages/CtoRoomPage'
import QaCenterPage from '@renderer/pages/QaCenterPage'
import ReleaseCenterPage from '@renderer/pages/ReleaseCenterPage'
import DevOpsCenterPage from '@renderer/pages/DevOpsCenterPage'
import DevelopmentOsPage from '@renderer/pages/DevelopmentOsPage'
import SecurityCenterPage from '@renderer/pages/SecurityCenterPage'
import PmPlannerPage from '@renderer/pages/PmPlannerPage'
import ProductBacklogPage from '@renderer/pages/ProductBacklogPage'
import ProjectManagerPage from '@renderer/pages/ProjectManagerPage'
import ApprovalCenterPage from '@renderer/pages/ApprovalCenterPage'
import CompanyActivityLogPage from '@renderer/pages/CompanyActivityLogPage'
import CompanySettingsPage from '@renderer/pages/CompanySettingsPage'
import StaffLoginAdminPage from '@renderer/pages/StaffLoginAdminPage'
import StaffTeamManagementPage from '@renderer/pages/StaffTeamManagementPage'
import AnnouncementAdminPage from '@renderer/pages/AnnouncementAdminPage'
import RegistrationAdminPage from '@renderer/pages/RegistrationAdminPage'
import StaffOverviewPage from '@renderer/pages/StaffOverviewPage'
import StaffTablePage from '@renderer/pages/StaffTablePage'
import ManagerContactsPage from '@renderer/pages/ManagerContactsPage'
import UnderwritingPage from '@renderer/pages/UnderwritingPage'
import FamilyCaregiverPage from '@renderer/pages/FamilyCaregiverPage'

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
    case 'company':
      return <LiveCompanyPage />
    case 'dashboard':
      return <Dashboard />
    case 'fcos':
      return <FcOsPage />
    case 'customer':
      return <SupabaseCustomerManager />
    case 'sales-activity':
      return <SalesActivityWorkspacePage />
    case 'schedule':
      return <SupabaseScheduleManager />
    case 'performance':
      return <PerformancePage />
    case 'team-leader':
      return <TeamLeaderPage />
    case 'consultation':
      return <SupabaseConsultationManager />
    case 'manager-contacts':
      return <ManagerContactsPage />
    case 'underwriting':
      return <UnderwritingPage />
    case 'family-caregiver':
      return <FamilyCaregiverPage />
    case 'insurance-analysis':
      return <InsuranceAnalysisPage />
    case 'claim-assistant':
      return <InsuranceClaimAssistantPage />
    case 'wiki':
      return <InsuranceWikiPage />
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
    case 'devos':
      return <DevelopmentOsPage />
    case 'security-center':
      return <SecurityCenterPage />
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
    case 'activity':
      return <CompanyActivityLogPage />
    case 'settings':
      return <CompanySettingsPage />
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
    default:
      return <Dashboard />
  }
}
