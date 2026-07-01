import type { ParsedCommand } from './types'

export interface RoutedIntent {
  intent: string
  description: string
  toolName: string
}

export default class IntentRouter {
  route(command: ParsedCommand): RoutedIntent {
    switch (command.intent) {
      case 'daily-performance':
        return { intent: command.intent, description: '실적 요약을 조회합니다.', toolName: 'dailyPerformance' }
      case 'clock-in':
        return { intent: command.intent, description: '출근 처리 상태를 확인합니다.', toolName: 'clockIn' }
      case 'today-schedule':
        return { intent: command.intent, description: '오늘 일정을 확인합니다.', toolName: 'todaySchedule' }
      case 'customer-search':
        return { intent: command.intent, description: '고객 정보를 조회합니다.', toolName: 'customerSearch' }
      case 'insurance-analysis':
        return { intent: command.intent, description: '보험 데이터를 분석합니다.', toolName: 'insuranceAnalysis' }
      case 'pending-work':
        return { intent: command.intent, description: '미처리 업무를 확인합니다.', toolName: 'pendingWork' }
      case 'system-status':
        return { intent: command.intent, description: '시스템 상태를 점검합니다.', toolName: 'systemStatus' }
      case 'backlog-status':
        return { intent: command.intent, description: '백로그 상태를 확인합니다.', toolName: 'backlogStatus' }
      case 'help':
        return { intent: command.intent, description: '지원 명령어를 안내합니다.', toolName: 'help' }
      default:
        return { intent: 'unknown', description: '지원되지 않는 명령입니다.', toolName: 'unknown' }
    }
  }
}
