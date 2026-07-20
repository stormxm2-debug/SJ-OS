export type WorkerTab = 'profile' | 'memory' | 'chat'

/** The set of top-level views the CEO can navigate between. */
export type View =
  | { name: 'assistant' }
  | { name: 'staff-home' }
  | { name: 'attendance' }
  | { name: 'notice' }
  | { name: 'dashboard' }
  | { name: 'fcos' }
  | { name: 'customer' }
  | { name: 'birthdays' }
  | { name: 'stats-report' }
  | { name: 'content-studio' }
  | { name: 'sales-activity' }
  | { name: 'schedule' }
  | { name: 'shared-schedule' }
  | { name: 'performance' }
  | { name: 'salary' }
  | { name: 'consultation' }
  | { name: 'insurance-analysis' }
  | { name: 'claim-assistant' }
  | { name: 'exemptions' }
  | { name: 'wiki' }
  | { name: 'underwriting'; q?: string }
  | { name: 'pre-underwriting' }
  | { name: 'disease-exceptions'; q?: string }
  | { name: 'contacts' }
  | { name: 'leads' }
  | { name: 'referrals' }
  | { name: 'today-contacts' }
  | { name: 'plan-request' }
  | { name: 'files' }
  | { name: 'app-install' }
  | { name: 'app-builder' }
  | { name: 'devprompt' }
  | { name: 'cto' }
  | { name: 'qa' }
  | { name: 'release' }
  | { name: 'devops' }
  | { name: 'autopilot' }
  | { name: 'pm' }
  | { name: 'backlog' }
  | { name: 'workers' }
  | { name: 'worker'; workerId: string; tab: WorkerTab }
  | { name: 'projects' }
  | { name: 'approvals' }
  | { name: 'staff-login' }
  | { name: 'staff-team' }
  | { name: 'announcements' }
  | { name: 'registration-admin' }
  | { name: 'staff-overview' }
  | { name: 'staff-table' }
  | { name: 'family-birthdays' }

export type ViewName = View['name']
