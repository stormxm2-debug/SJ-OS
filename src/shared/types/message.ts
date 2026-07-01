export type ChatAuthor = 'ceo' | 'worker'

/** One message in a CEO ↔ worker management conversation. */
export interface ChatMessage {
  id: string
  workerId: string
  author: ChatAuthor
  content: string
  createdAt: string
}
