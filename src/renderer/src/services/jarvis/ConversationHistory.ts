import type { ConversationEntry, ToolCall } from './types'

export default class ConversationHistory {
  private entries: ConversationEntry[] = []
  private recentCommands: string[] = []

  addUserMessage(content: string): void {
    this.entries.push({
      id: `msg-${Date.now()}-u`,
      role: 'user',
      content,
      timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    })
    this.recentCommands = [content, ...this.recentCommands].slice(0, 8)
  }

  addAssistantMessage(content: string, toolCalls: ToolCall[] = []): void {
    this.entries.push({
      id: `msg-${Date.now()}-a`,
      role: 'assistant',
      content,
      timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      toolCalls
    })
  }

  getEntries(): ConversationEntry[] {
    return this.entries.slice(-10)
  }

  getRecentCommands(): string[] {
    return this.recentCommands
  }

  clear(): void {
    this.entries = []
    this.recentCommands = []
  }
}
