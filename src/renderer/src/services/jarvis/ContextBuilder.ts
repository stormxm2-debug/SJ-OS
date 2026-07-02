import { fcRepository } from '@renderer/services/fc/FcRepository'
import { customerRepository } from '@renderer/services/customer/CustomerRepository'
import { salesActivityRepository } from '@renderer/services/sales-activity/SalesActivityRepository'
import { scheduleRepository } from '@renderer/services/schedule/ScheduleRepository'
import { performanceRepository } from '@renderer/services/performance/PerformanceRepository'
import { consultationRepository } from '@renderer/services/consultation/ConsultationRepository'
import { analysisRepository } from '@renderer/services/insurance-analysis/AnalysisRepository'
import { teamLeaderRepository } from '@renderer/services/team-leader/TeamLeaderRepository'

/**
 * Jarvis Safe Context Builder.
 *
 * Prepares a small, SANITIZED summary of the local SJ OS workspaces to send to
 * the GPT proxy as grounding context.
 *
 * SAFETY RULES (enforced here):
 *  - Aggregate COUNTS and STATUS only — never customer names, phone numbers,
 *    contract details, or any other personal/sensitive data.
 *  - Reads only from mock/local repository summaries already used by the UI.
 *  - Compact by design so the proxy payload stays small.
 */

/** A compact, PII-free snapshot of the SJ OS workspaces. */
export interface SjOsSnapshot {
  fcOs: {
    totalFc: number
    checkedIn: number
    late: number
    outside: number
    absent: number
    inactiveFc: number
  }
  performance: {
    monthlyPremiumTotal: number
    contractTotal: number
    targetPremiumTotal: number
    achievementRate: number
    targetHitCount: number
  }
  schedule: {
    today: number
    upcoming: number
    overdue: number
    followUps: number
  }
  salesActivity: {
    planned: number
    inProgress: number
    followUpNeeded: number
    overdueFollowUp: number
    closingPipeline: number
  }
  customer: {
    total: number
    consulting: number
    contracted: number
    followUpNeeded: number
    dormant: number
  }
  teamLeader: {
    teams: number
  }
  consultation: {
    active: number
    closingStage: number
    winRate: number
    onHold: number
    lost: number
  }
  insuranceAnalysis: {
    total: number
    underinsured: number
    totalGaps: number
    highSeverityGaps: number
    reviewed: number
  }
}

export default class ContextBuilder {
  /** Build a PII-free snapshot object from local workspace summaries. */
  buildSnapshot(): SjOsSnapshot {
    const fc = fcRepository.getSummary()
    const perf = performanceRepository.getSummary()
    const schedule = scheduleRepository.getSummary()
    const sales = salesActivityRepository.getSummary()
    const customer = customerRepository.getSummary()
    const consultation = consultationRepository.getSummary()
    const analysis = analysisRepository.getSummary()
    const teams = teamLeaderRepository.listTeams()

    return {
      fcOs: {
        totalFc: fc.totalFc,
        checkedIn: fc.checkedIn,
        late: fc.late,
        outside: fc.outside,
        absent: fc.absent,
        inactiveFc: fc.inactiveFcCount
      },
      performance: {
        monthlyPremiumTotal: perf.monthlyPremiumTotal,
        contractTotal: perf.contractTotal,
        targetPremiumTotal: perf.targetPremiumTotal,
        achievementRate: perf.achievementRate,
        targetHitCount: perf.targetHitCount
      },
      schedule: {
        today: schedule.today,
        upcoming: schedule.upcoming,
        overdue: schedule.overdue,
        followUps: schedule.followUps
      },
      salesActivity: {
        planned: sales.planned,
        inProgress: sales.inProgress,
        followUpNeeded: sales.followUpNeeded,
        overdueFollowUp: sales.overdueFollowUp,
        closingPipeline: sales.closingPipeline
      },
      customer: {
        total: customer.total,
        consulting: customer.consulting,
        contracted: customer.contracted,
        followUpNeeded: customer.followUpNeeded,
        dormant: customer.dormant
      },
      teamLeader: {
        teams: teams.length
      },
      consultation: {
        active: consultation.active,
        closingStage: consultation.closingStage,
        winRate: consultation.winRate,
        onHold: consultation.onHold,
        lost: consultation.lost
      },
      insuranceAnalysis: {
        total: analysis.total,
        underinsured: analysis.underinsured,
        totalGaps: analysis.totalGaps,
        highSeverityGaps: analysis.highSeverityGaps,
        reviewed: analysis.reviewed
      }
    }
  }

  /** Build a compact one-block Korean text summary for the GPT prompt. */
  buildContextText(): string {
    const s = this.buildSnapshot()
    return [
      `FC OS: 전체 ${s.fcOs.totalFc}명, 출근 ${s.fcOs.checkedIn}, 지각 ${s.fcOs.late}, 외근 ${s.fcOs.outside}, 결근 ${s.fcOs.absent}, 활동미기록 ${s.fcOs.inactiveFc}`,
      `실적: 이번달 보험료 ${s.performance.monthlyPremiumTotal}원, 계약 ${s.performance.contractTotal}건, 목표 ${s.performance.targetPremiumTotal}원, 달성률 ${s.performance.achievementRate}%, 목표달성 FC ${s.performance.targetHitCount}명`,
      `일정: 오늘 ${s.schedule.today}, 다가오는 ${s.schedule.upcoming}, 연체 ${s.schedule.overdue}, 고객후속 ${s.schedule.followUps}`,
      `영업활동: 예정 ${s.salesActivity.planned}, 진행중 ${s.salesActivity.inProgress}, 후속필요 ${s.salesActivity.followUpNeeded}, 연체후속 ${s.salesActivity.overdueFollowUp}, 클로징 ${s.salesActivity.closingPipeline}`,
      `고객: 전체 ${s.customer.total}, 상담중 ${s.customer.consulting}, 계약 ${s.customer.contracted}, 후속필요 ${s.customer.followUpNeeded}, 휴면 ${s.customer.dormant}`,
      `팀: ${s.teamLeader.teams}개 팀`,
      `상담: 진행중 ${s.consultation.active}, 클로징단계 ${s.consultation.closingStage}, 성공률 ${s.consultation.winRate}%, 보류 ${s.consultation.onHold}, 실패 ${s.consultation.lost}`,
      `보험분석: 분석 ${s.insuranceAnalysis.total}, 보장부족 ${s.insuranceAnalysis.underinsured}, 공백 ${s.insuranceAnalysis.totalGaps}(고위험 ${s.insuranceAnalysis.highSeverityGaps}), 검토완료 ${s.insuranceAnalysis.reviewed}`
    ].join('\n')
  }
}

export const contextBuilder = new ContextBuilder()
