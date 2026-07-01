export type ProjectStatus =
  | 'planning'
  | 'building'
  | 'review'
  | 'released'
  | 'paused'

export interface Project {
  id: string
  name: string
  description: string
  status: ProjectStatus
  progress: number
  repository: string | null
  updatedAt: string
}
