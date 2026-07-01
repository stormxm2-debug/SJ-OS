export type JarvisStatus = 'idle' | 'thinking' | 'running' | 'completed' | 'error'

export interface ParsedCommand {
  raw: string
  normalized: string
  intent: string
  confidence: number
}

export interface ToolCall {
  id: string
  name: string
  status: 'pending' | 'done' | 'error'
  detail: string
}

export interface ConversationEntry {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolCalls?: ToolCall[]
}

export interface JarvisExecutionResult {
  intent: string
  response: string
  toolCalls: ToolCall[]
  status: JarvisStatus
  error?: string
}

export interface JarvisState {
  isOpen: boolean
  input: string
  status: JarvisStatus
  response: string
  toolCalls: ToolCall[]
  history: ConversationEntry[]
  recentCommands: string[]
  lastError?: string
}
