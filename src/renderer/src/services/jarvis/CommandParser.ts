import type { ParsedCommand } from './types'

const supportedCommands = [
  '오늘 실적',
  'FC 출근',
  '오늘 일정',
  '고객 조회',
  '보험 분석',
  '미처리 업무',
  '시스템 상태',
  '백로그 상태',
  '자비스 도움말'
]

export default class CommandParser {
  parse(raw: string): ParsedCommand {
    const normalized = raw.trim()
    const compact = normalized.replace(/\s+/g, ' ')
    const lowered = compact.toLowerCase()

    let intent = 'unknown'
    let confidence = 0.4

    if (lowered.includes('실적')) {
      intent = 'daily-performance'
      confidence = 0.95
    } else if (lowered.includes('출근')) {
      intent = 'clock-in'
      confidence = 0.95
    } else if (lowered.includes('일정')) {
      intent = 'today-schedule'
      confidence = 0.95
    } else if (lowered.includes('고객')) {
      intent = 'customer-search'
      confidence = 0.95
    } else if (lowered.includes('보험')) {
      intent = 'insurance-analysis'
      confidence = 0.95
    } else if (lowered.includes('미처리')) {
      intent = 'pending-work'
      confidence = 0.95
    } else if (lowered.includes('시스템')) {
      intent = 'system-status'
      confidence = 0.95
    } else if (lowered.includes('백로그')) {
      intent = 'backlog-status'
      confidence = 0.95
    } else if (lowered.includes('도움말') || lowered.includes('help')) {
      intent = 'help'
      confidence = 0.95
    }

    return {
      raw: compact,
      normalized: compact,
      intent,
      confidence
    }
  }

  isSupported(raw: string): boolean {
    const compact = raw.trim()
    return supportedCommands.some((command) => command === compact)
  }
}
