import { useNavigation } from '@renderer/navigation/NavigationContext'
import CommandCenterPage from '@renderer/pages/CommandCenterPage'
import Dashboard from './dashboard/Dashboard'
import WorkersPage from '@renderer/pages/WorkersPage'
import WorkerDetailPage from '@renderer/pages/WorkerDetailPage'
import LiveCompanyPage from '@renderer/pages/LiveCompanyPage'
import AutopilotPage from '@renderer/pages/AutopilotPage'
import DevelopmentOsPage from '@renderer/pages/DevelopmentOsPage'
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
    case 'autopilot':
      return <AutopilotPage />
    case 'devos':
      return <DevelopmentOsPage />
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
