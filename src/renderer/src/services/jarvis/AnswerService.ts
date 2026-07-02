import { fcRepository } from '@renderer/services/fc/FcRepository'
import { customerRepository } from '@renderer/services/customer/CustomerRepository'
import { salesActivityRepository } from '@renderer/services/sales-activity/SalesActivityRepository'
import { scheduleRepository } from '@renderer/services/schedule/ScheduleRepository'
import { performanceRepository } from '@renderer/services/performance/PerformanceRepository'
import { consultationRepository } from '@renderer/services/consultation/ConsultationRepository'
import { analysisRepository } from '@renderer/services/insurance-analysis/AnalysisRepository'
import type { AnswerCard, JarvisAnswerResult } from './types'

/**
 * Jarvis Answer Mode — connects Jarvis to the existing local SJ OS workspaces
 * and returns a structured answer (summary + cards + source + recommended next
 * action + navigation target). All data is read from the workspace repositories'
 * public APIs; there is no AI/API call. Unknown intents return null so the
 * caller can fall back.
 */

function won(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억원`
  return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만원`
}

export default class AnswerService {
  /** Answer a fine-grained business intent, or null if unsupported. */
  answer(intent: string): JarvisAnswerResult | null {
    switch (intent) {
      case 'fc-attendance':
        return this.fcAttendance()
      case 'performance':
        return this.performance()
      case 'team-performance':
        return this.teamPerformance()
      case 'today-schedule':
        return this.todaySchedule()
      case 'pending-activities':
        return this.pendingActivities()
      case 'closing-customers':
        return this.closingCustomers()
      case 'today-contacts':
        return this.todayContacts()
      case 'customer-search':
        return this.customerSearch()
      case 'consultation-status':
        return this.consultationStatus()
      case 'insurance-needed':
        return this.insuranceNeeded()
      default:
        return null
    }
  }

  /** A cross-workspace daily briefing. */
  briefing(): JarvisAnswerResult {
    const fc = fcRepository.getSummary()
    const perf = performanceRepository.getSummary()
    const schedule = scheduleRepository.getSummary()
    const sales = salesActivityRepository.getSummary()
    const cards: AnswerCard[] = [
      { label: 'FC 출근', value: `${fc.checkedIn}/${fc.totalFc}명`, tone: 'text-emerald-300' },
      { label: '오늘 일정', value: `${schedule.today}건`, tone: 'text-sky-300' },
      { label: '이번달 실적', value: won(perf.monthlyPremiumTotal), tone: 'text-emerald-300' },
      { label: '달성률', value: `${perf.achievementRate}%` },
      { label: '오늘 활동', value: `${sales.today}건` },
      { label: '클로징 파이프라인', value: `${sales.closingPipeline}건`, tone: 'text-amber-300' }
    ]
    return {
      commandUnderstood: '오늘 브리핑',
      sourceWorkspace: 'Live Company (통합)',
      summary: `오늘 출근 ${fc.checkedIn}/${fc.totalFc}명 · 일정 ${schedule.today}건 · 활동 ${sales.today}건 · 이번달 실적 ${won(perf.monthlyPremiumTotal)}(달성률 ${perf.achievementRate}%) · 클로징 파이프라인 ${sales.closingPipeline}건.`,
      cards,
      recommendedNextAction: schedule.overdue > 0 ? `연체 일정 ${schedule.overdue}건 우선 처리` : '오늘 클로징 예정 고객 확인',
      navigationTarget: 'company',
      suggestedCommands: ['오늘 FC 출근 현황', '오늘 일정', '클로징 예정 고객', '미완료 활동']
    }
  }

  private fcAttendance(): JarvisAnswerResult {
    const s = fcRepository.getSummary()
    return {
      commandUnderstood: '오늘 FC 출근 현황',
      sourceWorkspace: 'FC OS',
      summary: `전체 ${s.totalFc}명 중 출근 ${s.checkedIn}명, 지각 ${s.late}명, 외근 ${s.outside}명, 결근 ${s.absent}명. 오늘 활동 미기록 FC ${s.inactiveFcCount}명.`,
      cards: [
        { label: '출근', value: `${s.checkedIn}명`, tone: 'text-emerald-300' },
        { label: '지각', value: `${s.late}명`, tone: 'text-amber-300' },
        { label: '외근', value: `${s.outside}명`, tone: 'text-sky-300' },
        { label: '결근', value: `${s.absent}명`, tone: 'text-rose-300' }
      ],
      recommendedNextAction: s.inactiveFcCount > 0 ? `활동 미기록 ${s.inactiveFcCount}명 팀장 확인` : '전 FC 활동 정상',
      navigationTarget: 'fcos',
      suggestedCommands: ['이번 달 실적', '팀별 실적', '오늘 일정']
    }
  }

  private performance(): JarvisAnswerResult {
    const s = performanceRepository.getSummary()
    return {
      commandUnderstood: '이번 달 실적',
      sourceWorkspace: 'Performance Workspace',
      summary: `이번달 보험료 ${won(s.monthlyPremiumTotal)}, 계약 ${s.contractTotal}건, 목표 ${won(s.targetPremiumTotal)} 대비 달성률 ${s.achievementRate}%. 최우수 FC ${s.topFcName}, 선두 팀 ${s.topTeamName}.`,
      cards: [
        { label: '보험료', value: won(s.monthlyPremiumTotal), tone: 'text-emerald-300' },
        { label: '계약', value: `${s.contractTotal}건` },
        { label: '달성률', value: `${s.achievementRate}%`, tone: 'text-sky-300' },
        { label: '목표달성 FC', value: `${s.targetHitCount}명`, tone: 'text-amber-300' }
      ],
      recommendedNextAction: `선두 팀(${s.topTeamName}) 사례 공유 및 하위 팀 코칭`,
      navigationTarget: 'performance',
      suggestedCommands: ['팀별 실적', '오늘 FC 출근 현황', '클로징 예정 고객']
    }
  }

  private teamPerformance(): JarvisAnswerResult {
    const teams = performanceRepository.getTeamRanking()
    const cards: AnswerCard[] = teams.slice(0, 4).map((t) => ({
      label: t.team,
      value: `${t.achievementRate}%`,
      tone: t.achievementRate >= 100 ? 'text-emerald-300' : undefined
    }))
    return {
      commandUnderstood: '팀별 실적',
      sourceWorkspace: 'Performance Workspace',
      summary: `팀 실적 순위 · ${teams.map((t) => `${t.team} ${won(t.monthlyPremium)}(${t.achievementRate}%)`).join(', ')}.`,
      cards,
      recommendedNextAction: teams.length > 0 ? `${teams[teams.length - 1].team} 달성률 점검` : '팀 데이터 없음',
      navigationTarget: 'performance',
      suggestedCommands: ['이번 달 실적', '오늘 FC 출근 현황']
    }
  }

  private todaySchedule(): JarvisAnswerResult {
    const s = scheduleRepository.getSummary()
    return {
      commandUnderstood: '오늘 일정',
      sourceWorkspace: 'Schedule Workspace',
      summary: `오늘 일정 ${s.today}건 · 다가오는 ${s.upcoming}건 · 연체 ${s.overdue}건. 미팅/약속 ${s.meetings + s.appointments}건, 고객 후속 ${s.followUps}건.`,
      cards: [
        { label: '오늘', value: `${s.today}건`, tone: 'text-sky-300' },
        { label: '다가오는', value: `${s.upcoming}건` },
        { label: '연체', value: `${s.overdue}건`, tone: 'text-rose-300' },
        { label: '고객 후속', value: `${s.followUps}건`, tone: 'text-amber-300' }
      ],
      recommendedNextAction: s.overdue > 0 ? `연체 일정 ${s.overdue}건 재조율` : '오늘 미팅 준비 확인',
      navigationTarget: 'schedule',
      suggestedCommands: ['클로징 예정 고객', '미완료 활동', '오늘 연락할 고객']
    }
  }

  private pendingActivities(): JarvisAnswerResult {
    const s = salesActivityRepository.getSummary()
    return {
      commandUnderstood: '미완료 활동',
      sourceWorkspace: 'Sales Activity Workspace',
      summary: `예정 ${s.planned}건, 진행중 ${s.inProgress}건, 연기 ${s.delayed}건, 노쇼 ${s.noShow}건. 후속 필요 ${s.followUpNeeded}건, 연체 후속 ${s.overdueFollowUp}건.`,
      cards: [
        { label: '예정', value: `${s.planned}건` },
        { label: '진행중', value: `${s.inProgress}건`, tone: 'text-sky-300' },
        { label: '후속 필요', value: `${s.followUpNeeded}건`, tone: 'text-amber-300' },
        { label: '연체 후속', value: `${s.overdueFollowUp}건`, tone: 'text-rose-300' }
      ],
      recommendedNextAction: s.overdueFollowUp > 0 ? `연체 후속 ${s.overdueFollowUp}건 즉시 처리` : '진행중 활동 마감 관리',
      navigationTarget: 'sales-activity',
      suggestedCommands: ['클로징 예정 고객', '오늘 일정', '오늘 FC 출근 현황']
    }
  }

  private closingCustomers(): JarvisAnswerResult {
    const s = salesActivityRepository.getSummary()
    const closing = salesActivityRepository
      .listActivities()
      .filter((a) => a.type === 'closing' && a.status !== 'completed' && a.status !== 'cancelled')
    return {
      commandUnderstood: '클로징 예정 고객',
      sourceWorkspace: 'Sales Activity Workspace',
      summary:
        closing.length === 0
          ? '클로징 예정 고객이 없습니다.'
          : `클로징 파이프라인 ${s.closingPipeline}건 · ${closing.map((a) => a.customerName ?? a.title).join(', ')}.`,
      cards: [{ label: '클로징 파이프라인', value: `${s.closingPipeline}건`, tone: 'text-amber-300' }],
      recommendedNextAction: closing.length > 0 ? '클로징 미팅 우선 배정 및 팀장 동행 검토' : '제안 단계 고객 클로징 전환',
      navigationTarget: 'sales-activity',
      suggestedCommands: ['상담 진행 현황', '오늘 일정', '미완료 활동']
    }
  }

  private todayContacts(): JarvisAnswerResult {
    const s = customerRepository.getSummary()
    return {
      commandUnderstood: '오늘 연락할 고객',
      sourceWorkspace: 'Customer Workspace',
      summary: `후속 필요 고객 ${s.followUpNeeded}명, 상담중 ${s.consulting}명, 제안 준비 ${s.proposalReady}명. 전체 고객 ${s.total}명.`,
      cards: [
        { label: '후속 필요', value: `${s.followUpNeeded}명`, tone: 'text-amber-300' },
        { label: '상담중', value: `${s.consulting}명`, tone: 'text-sky-300' },
        { label: '제안 준비', value: `${s.proposalReady}명` },
        { label: '휴면', value: `${s.dormant}명`, tone: 'text-rose-300' }
      ],
      recommendedNextAction: s.followUpNeeded > 0 ? `후속 필요 ${s.followUpNeeded}명 오늘 연락 배정` : '휴면 고객 재활성화 캠페인',
      navigationTarget: 'customer',
      suggestedCommands: ['클로징 예정 고객', '상담 진행 현황', '보험분석 필요한 고객']
    }
  }

  private customerSearch(): JarvisAnswerResult {
    const s = customerRepository.getSummary()
    return {
      commandUnderstood: '고객 검색',
      sourceWorkspace: 'Customer Workspace',
      summary: `전체 고객 ${s.total}명 · 리드 ${s.leads}, 상담중 ${s.consulting}, 계약 ${s.contracted}. 월납 합계 ${won(s.monthlyPremiumTotal)}, 보유 증권 ${s.policyTotal}건.`,
      cards: [
        { label: '전체', value: `${s.total}명` },
        { label: '상담중', value: `${s.consulting}명`, tone: 'text-sky-300' },
        { label: '계약', value: `${s.contracted}명`, tone: 'text-emerald-300' },
        { label: '월납 합계', value: won(s.monthlyPremiumTotal) }
      ],
      recommendedNextAction: '고객 워크스페이스에서 우선순위/후속 필터로 상세 조회',
      navigationTarget: 'customer',
      suggestedCommands: ['오늘 연락할 고객', '보험분석 필요한 고객', '상담 진행 현황']
    }
  }

  private consultationStatus(): JarvisAnswerResult {
    const s = consultationRepository.getSummary()
    return {
      commandUnderstood: '상담 진행 현황',
      sourceWorkspace: 'Consultation Workspace',
      summary: `진행중 상담 ${s.active}건, 클로징 단계 ${s.closingStage}건, 성공 ${s.won}건, 성공률 ${s.winRate}%. 사후관리 ${s.afterCare}건.`,
      cards: [
        { label: '진행중', value: `${s.active}건`, tone: 'text-sky-300' },
        { label: '클로징 단계', value: `${s.closingStage}건`, tone: 'text-amber-300' },
        { label: '성공률', value: `${s.winRate}%`, tone: 'text-emerald-300' },
        { label: '보류/실패', value: `${s.onHold}/${s.lost}`, tone: 'text-rose-300' }
      ],
      recommendedNextAction: s.closingStage > 0 ? `클로징 단계 ${s.closingStage}건 마무리 지원` : '제안 단계 상담 클로징 전환',
      navigationTarget: 'consultation',
      suggestedCommands: ['클로징 예정 고객', '보험분석 필요한 고객', '오늘 일정']
    }
  }

  private insuranceNeeded(): JarvisAnswerResult {
    const s = analysisRepository.getSummary()
    return {
      commandUnderstood: '보험분석 필요한 고객',
      sourceWorkspace: 'Insurance Analysis Entry',
      summary: `분석 ${s.total}건 · 보장부족 고객 ${s.underinsured}명, 보장 공백 ${s.totalGaps}건(고위험 ${s.highSeverityGaps}건). 검토완료 ${s.reviewed}건.`,
      cards: [
        { label: '보장부족', value: `${s.underinsured}명`, tone: 'text-rose-300' },
        { label: '보장 공백', value: `${s.totalGaps}건`, tone: 'text-amber-300' },
        { label: '고위험 공백', value: `${s.highSeverityGaps}건`, tone: 'text-rose-300' },
        { label: '검토완료', value: `${s.reviewed}건`, tone: 'text-emerald-300' }
      ],
      recommendedNextAction: s.underinsured > 0 ? `보장부족 ${s.underinsured}명 재설계 제안` : '분석 대상 확대',
      navigationTarget: 'insurance-analysis',
      suggestedCommands: ['상담 진행 현황', '오늘 연락할 고객', '클로징 예정 고객']
    }
  }
}
