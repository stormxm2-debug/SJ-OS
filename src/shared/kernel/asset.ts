import type { Capability } from './types'

/**
 * Company Asset Store — domain.
 *
 * An asset is a reusable company artifact. The Asset Store is the AI Company's
 * permanent memory: projects register reusable assets here and future projects
 * consume them. Projects never own reusable assets — they use them.
 */

export type AssetType =
  | 'business_module'
  | 'ui_component'
  | 'prompt_template'
  | 'workflow_template'
  | 'documentation'
  | 'api_connector'
  | 'ai_employee'
  | 'knowledge_package'

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  business_module: 'Business Modules',
  ui_component: 'UI Components',
  prompt_template: 'Prompt Templates',
  workflow_template: 'Workflow Templates',
  documentation: 'Documentation',
  api_connector: 'API Connectors',
  ai_employee: 'AI Employees',
  knowledge_package: 'Knowledge Packages'
}

/** What a worker reports when it produces a reusable asset (from real work). */
export interface AssetManifest {
  type: AssetType
  name: string
  version: string
  dependencies: string[]
  supportedProjects: string[]
  ownerDepartment: Capability
  files: string[]
}

export type AssetStatus = 'in_development' | 'registered'

/** The Asset Store's record of a company asset. */
export interface AssetRecord extends AssetManifest {
  id: string
  /** Names of projects that have produced or consumed this asset. */
  projectsUsing: string[]
  status: AssetStatus
  registeredAt: number
  completedAt: number | null
}
