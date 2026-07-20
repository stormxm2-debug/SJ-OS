import type { CustomerRecord } from '@shared/commercial/models'
import type { CoverageItem } from './planRequestService'

/**
 * AI 사전심사·보장분석 → 설계 요청서로 넘어갈 때의 프리필 전달 (메모리 1회용).
 *
 * underwritingPrefill과 같은 원칙: View 타입에 파라미터를 늘리지 않고,
 * 병력 등 민감정보가 포함될 수 있어 localStorage 등에 남기지 않는다.
 */

export interface PlanRequestPrefill {
  customer?: CustomerRecord
  /** 요청 보험 구분 (INSURANCE_KINDS 중 하나). */
  insuranceKind?: string
  /** 미리 체크할 특약들. */
  coverages?: CoverageItem[]
  /** 기타 요청사항 초안 (예: AI 사전심사 조건 요약). */
  extraRequest?: string
  /** 병력 고지 포함 여부 초깃값 (간편심사 유도 시 true). */
  includeMedical?: boolean
}

let pending: PlanRequestPrefill | null = null

export function setPlanRequestPrefill(p: PlanRequestPrefill): void {
  pending = p
}

/** 꺼내면서 비운다 — 새로고침·재방문 시 이전 컨텍스트가 남지 않도록. */
export function takePlanRequestPrefill(): PlanRequestPrefill | null {
  const p = pending
  pending = null
  return p
}
