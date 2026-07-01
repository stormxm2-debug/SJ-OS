import type { JarvisExecutionResult, ToolCall } from './types'
import type { RoutedIntent } from './IntentRouter'

export default class ToolExecutor {
  execute(action: RoutedIntent): JarvisExecutionResult {
    const toolCalls: ToolCall[] = [
      {
        id: `tool-${Date.now()}-1`,
        name: action.toolName,
        status: 'done',
        detail: action.description
      }
    ]

    switch (action.intent) {
      case 'daily-performance':
        return {
          intent: action.intent,
          status: 'completed',
          response: '오늘 실적은 매출 1,280만 원, 계약 성사 4건, 고객 만족도 4.8점입니다. 핵심은 신규 고객 확보와 재계약 유지입니다.',
          toolCalls
        }
      case 'clock-in':
        return {
          intent: action.intent,
          status: 'completed',
          response: 'FC 출근 처리는 정상적으로 등록되었습니다. 현재 출근 상태는 준비 완료이며, 오늘의 첫 회의는 09:30에 시작됩니다.',
          toolCalls
        }
      case 'today-schedule':
        return {
          intent: action.intent,
          status: 'completed',
          response: '오늘 일정은 09:30 CEO 브리핑, 11:00 전략 회의, 14:00 고객 미팅, 18:00 데일리 리뷰입니다.',
          toolCalls
        }
      case 'customer-search':
        return {
          intent: action.intent,
          status: 'completed',
          response: '고객 조회 결과: ACME 산업, 계약 상태 정상, 최근 3개월 유지율 92%, 다음 액션은 보험 갱신 확인입니다.',
          toolCalls
        }
      case 'insurance-analysis':
        return {
          intent: action.intent,
          status: 'completed',
          response: '보험 분석 결과: 리스크 점수는 중간 수준이며, 보장 범위를 일부 확장하면 고객 이탈 가능성을 낮출 수 있습니다.',
          toolCalls
        }
      case 'pending-work':
        return {
          intent: action.intent,
          status: 'completed',
          response: '미처리 업무는 6건입니다. 우선순위는 계약 승인 2건, 고객 응답 2건, 내부 리포트 2건입니다.',
          toolCalls
        }
      case 'system-status':
        return {
          intent: action.intent,
          status: 'completed',
          response: '시스템 상태는 양호합니다. AI 워커 8대 연결됨, 백엔드 API 정상, 대시보드 업데이트 주기는 30초입니다.',
          toolCalls
        }
      case 'backlog-status':
        return {
          intent: action.intent,
          status: 'completed',
          response: '백로그 상태는 12개 항목이 진행 중이며, 3개는 검토 대기, 2개는 완료 처리되었습니다.',
          toolCalls
        }
      case 'help':
        return {
          intent: action.intent,
          status: 'completed',
          response: '지원 명령어는 오늘 실적, FC 출근, 오늘 일정, 고객 조회, 보험 분석, 미처리 업무, 시스템 상태, 백로그 상태, 자비스 도움말입니다.',
          toolCalls
        }
      default:
        return {
          intent: 'unknown',
          status: 'error',
          response: '지원되지 않는 명령입니다. 도움말을 확인해 주세요.',
          toolCalls
        }
    }
  }
}
