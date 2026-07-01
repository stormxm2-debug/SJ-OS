export type NotificationLevel = 'info' | 'success' | 'warning' | 'action'

export interface Notification {
  id: string
  level: NotificationLevel
  title: string
  message: string
  createdAt: string
  requiresApproval: boolean
}
