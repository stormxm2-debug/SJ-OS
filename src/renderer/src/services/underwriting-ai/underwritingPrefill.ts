import type { CustomerRecord } from '@shared/commercial/models'

/**
 * 고객관리 → AI 사전심사 페이지로 넘어갈 때의 프리필 전달 (메모리 1회용).
 *
 * View 타입에 파라미터를 늘리지 않고 페이지 간 고객 컨텍스트를 넘기기 위한
 * 최소 장치. 민감정보(병력)가 포함되므로 localStorage 등에 남기지 않는다.
 */

let pending: CustomerRecord | null = null

export function setUnderwritingPrefill(customer: CustomerRecord): void {
  pending = customer
}

/** 꺼내면서 비운다 — 새로고침·재방문 시 이전 고객이 남지 않도록. */
export function takeUnderwritingPrefill(): CustomerRecord | null {
  const c = pending
  pending = null
  return c
}
