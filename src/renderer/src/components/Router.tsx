import { useNavigation } from '@renderer/navigation/NavigationContext'
import { useSession } from '@renderer/navigation/SessionContext'
import { canAccessRoute } from '@renderer/navigation/roleAccess'
import AccessDenied from './layout/AccessDenied'
import StaffMvpDashboard from './home/StaffMvpDashboard'
import SupabaseCustomerManager from './customer/SupabaseCustomerManager'
import CommandCenterPage from '@renderer/pages/CommandCenterPage'
import StaffHomePage from '@renderer/pages/StaffHomePage'
import AttendancePage from '@renderer/pages/AttendancePage'
import NoticePage from '@renderer/pages/NoticePage'
import Dashboard from './dashboard/Dashboard'
import WorkersPage from '@renderer/pages/WorkersPage'
import WorkerDetailPage from '@renderer/pages/WorkerDetailPage'
import LiveCompanyPage from '@renderer/pages/LiveCompanyPage'
import FcOsPage from '@renderer/pages/FcOsPage'
import CustomerWorkspacePage from '@renderer/pages/CustomerWorkspacePage'
import SalesActivityWorkspacePage from '@renderer/pages/SalesActivityWorkspacePage'
import SchedulePage from '@renderer/pages/SchedulePage'
import PerformancePage from '@renderer/pages/PerformancePage'
import TeamLeaderPage from '@renderer/pages/TeamLeaderPage'
import ConsultationPage from '@renderer/pages/ConsultationPage'
import InsuranceAnalysisPage from '@renderer/pages/InsuranceAnalysisPage'
import UniversalAppBuilderPage from '@renderer/pages/UniversalAppBuilderPage'
import DeveloperPromptCenterPage from '@renderer/pages/DeveloperPromptCenterPage'
import AutopilotPage from '@renderer/pages/AutopilotPage'
import CtoRoomPage from '@renderer/pages/CtoRoomPage'
import QaCenterPage from '@renderer/pages/QaCenterPage'
import ReleaseCenterPage from '@renderer/pages/ReleaseCenterPage'
import DevOpsCenterPage from '@renderer/pages/DevOpsCenterPage'
import DevelopmentOsPage from '@renderer/pages/DevelopmentOsPage'
import PmPlannerPage from '@renderer/pages/PmPlannerPage'
import ProductBacklogPage from '@renderer/pages/ProductBacklogPage'
import ProjectManagerPage from '@renderer/pages/ProjectManagerPage'
import ApprovalCenterPage from '@renderer/pages/ApprovalCenterPage'
import CompanyActivityLogPage from '@renderer/pages/CompanyActivityLogPage'
import CompanySettingsPage from '@renderer/pages/CompanySettingsPage'

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
      return <AttendancePage />
    case 'notice':
      return <NoticePage />
    case 'company':
      return <LiveCompanyPage />
    case 'dashboard':
      return <Dashboard />
    case 'fcos':
      return <FcOsPage />
    case 'customer':
      return (
        <div className="space-y-6">
          <SupabaseCustomerManager />
          <CustomerWorkspacePage />
        </div>
      )
    case 'sales-activity':
      return <SalesActivityWorkspacePage />
    case 'schedule':
      return <SchedulePage />
    case 'performance':
      return <PerformancePage />
    case 'team-leader':
      return <TeamLeaderPage />
    case 'consultation':
      return <ConsultationPage />
    case 'insurance-analysis':
      return <InsuranceAnalysisPage />
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
    default:
      return <Dashboard />
  }
}
