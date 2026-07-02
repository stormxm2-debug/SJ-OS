export type WorkerTab = 'profile' | 'memory' | 'chat'

/** The set of top-level views the CEO can navigate between. */
export type View =
  | { name: 'assistant' }
  | { name: 'company' }
  | { name: 'dashboard' }
  | { name: 'autopilot' }
  | { name: 'devos' }
  | { name: 'pm' }
  | { name: 'backlog' }
  | { name: 'workers' }
  | { name: 'worker'; workerId: string; tab: WorkerTab }
  | { name: 'projects' }
  | { name: 'approvals' }
  | { name: 'activity' }
  | { name: 'settings' }

export type ViewName = View['name']
