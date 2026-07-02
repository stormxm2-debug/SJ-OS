import { implementationRepository } from '@renderer/services/implementation/ImplementationRepository'
import type {
  ImplementationPriority,
  ImplementationRiskLevel,
  ImplementationRequest,
  TargetWorkspace
} from '@renderer/services/implementation/types'
import type { JarvisClassification } from './types'

/**
 * Bridges a Jarvis implementation-mode classification into a routed
 * Implementation Request. Infers priority, risk level and approval requirement
 * from the raw command with local keyword rules (no AI/API), then delegates all
 * routing to implementationRepository.submitCommand — which never edits files or
 * runs git.
 */

/** Human-readable Korean labels for target workspaces. */
export const WORKSPACE_LABEL: Record<string, string> = {
  'fc-os': 'FC OS',
  customer: '고객 워크스페이스',
  'sales-activity': '영업활동 워크스페이스',
  schedule: '일정 워크스페이스',
  performance: '실적 워크스페이스',
  'team-leader': '팀장 워크스페이스',
  consultation: '상담 워크스페이스',
  'insurance-analysis': '보험분석 엔트리',
  jarvis: 'Jarvis',
  autopilot: 'Autopilot',
  company: 'Live Company',
  unknown: '대상 미정'
}

/** Keywords that make a change high-risk and approval-gated. */
const HIGH_RISK_MARKERS = [
  '삭제',
  '제거',
  '배포',
  '릴리스',
  'release',
  'deploy',
  '외부',
  'api',
  '결제',
  '개인정보',
  '데이터베이스',
  ' db',
  '보안',
  '마이그레이션',
  '초기화'
]

/** Workspaces whose changes touch sensitive data and warrant approval. */
const SENSITIVE_WORKSPACES = new Set<TargetWorkspace>(['insurance-analysis', 'customer'])

function inferPriority(lowered: string): ImplementationPriority {
  if (['긴급', '즉시', 'asap', '오늘', 'urgent'].some((k) => lowered.includes(k))) return 'P0'
  if (['중요', 'high', '우선'].some((k) => lowered.includes(k))) return 'P1'
  if (['다음 스프린트', '나중', '천천히', 'later'].some((k) => lowered.includes(k))) return 'P3'
  return 'P2'
}

function inferRisk(lowered: string, workspace: TargetWorkspace): {
  riskLevel: ImplementationRiskLevel
  approvalRequired: boolean
} {
  if (HIGH_RISK_MARKERS.some((k) => lowered.includes(k))) {
    return { riskLevel: 'high', approvalRequired: true }
  }
  if (SENSITIVE_WORKSPACES.has(workspace)) {
    return { riskLevel: 'medium', approvalRequired: true }
  }
  return { riskLevel: 'low', approvalRequired: false }
}

export default class ImplementationIntake {
  /** Create + route an implementation request from a classified command. */
  intake(raw: string, classification: JarvisClassification): ImplementationRequest | null {
    const lowered = raw.toLowerCase()
    const workspace = (classification.targetWorkspace as TargetWorkspace) ?? 'unknown'
    const label = WORKSPACE_LABEL[workspace] ?? WORKSPACE_LABEL.unknown
    const priority = inferPriority(lowered)
    const { riskLevel, approvalRequired } = inferRisk(lowered, workspace)

    const result = implementationRepository.submitCommand({
      rawUserCommand: raw,
      interpretedGoal: `${label} 구현/개선 요청: ${raw.trim()}`,
      targetWorkspace: workspace,
      priority,
      riskLevel,
      approvalRequired,
      requestedBy: 'CEO (Jarvis)',
      title: raw.trim().slice(0, 80)
    })

    return result.success && result.data ? result.data : null
  }
}
