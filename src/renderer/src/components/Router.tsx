import { useNavigation } from '@renderer/navigation/NavigationContext'
import CommandCenterPage from '@renderer/pages/CommandCenterPage'
import Dashboard from './dashboard/Dashboard'
import WorkersPage from '@renderer/pages/WorkersPage'
import WorkerDetailPage from '@renderer/pages/WorkerDetailPage'
import LiveCompanyPage from '@renderer/pages/LiveCompanyPage'
import FcOsPage from '@renderer/pages/FcOsPage'
import CustomerWorkspacePage from '@renderer/pages/CustomerWorkspacePage'
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

  switch (route.name) {
    case 'assistant':
      return <CommandCenterPage />
    case 'company':
      return <LiveCompanyPage />
    case 'dashboard':
      return <Dashboard />
    case 'fcos':
      return <FcOsPage />
    case 'customer':
      return <CustomerWorkspacePage />
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
