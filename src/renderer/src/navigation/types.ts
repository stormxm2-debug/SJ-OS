export type WorkerTab = 'profile' | 'memory' | 'chat'

/** The set of top-level views the CEO can navigate between. */
export type View =
  | { name: 'assistant' }
  | { name: 'staff-home' }
  | { name: 'attendance' }
  | { name: 'notice' }
  | { name: 'company' }
  | { name: 'dashboard' }
  | { name: 'fcos' }
  | { name: 'customer' }
  | { name: 'sales-activity' }
  | { name: 'schedule' }
  | { name: 'performance' }
  | { name: 'team-leader' }
  | { name: 'consultation' }
  | { name: 'manager-contacts' }
  | { name: 'underwriting' }
  | { name: 'insurance-analysis' }
  | { name: 'claim-assistant' }
  | { name: 'wiki' }
  | { name: 'app-builder' }
  | { name: 'devprompt' }
  | { name: 'cto' }
  | { name: 'qa' }
  | { name: 'release' }
  | { name: 'devops' }
  | { name: 'autopilot' }
  | { name: 'devos' }
  | { name: 'security-center' }
  | { name: 'pm' }
  | { name: 'backlog' }
  | { name: 'workers' }
  | { name: 'worker'; workerId: string; tab: WorkerTab }
  | { name: 'projects' }
  | { name: 'approvals' }
  | { name: 'activity' }
  | { name: 'settings' }
  | { name: 'staff-login' }
  | { name: 'staff-team' }
  | { name: 'announcements' }
  | { name: 'registration-admin' }
  | { name: 'staff-overview' }
  | { name: 'staff-table' }

export type ViewName = View['name']
