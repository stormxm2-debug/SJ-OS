import type { CustomerRecord } from '@shared/commercial/models'

/**
 * 보험 허브 — 보험 도구들(보장분석·청구비서·AI사전심사·인수가이드·DB배정)이 공유하는
 * "지금 작업 중인 고객" 컨텍스트. 한 도구에서 고객을 고르면 다른 도구로 이동해도
 * 유지되어 고객 정보를 다시 검색·입력할 필요가 없다.
 *
 * 병력 등 민감정보가 담기므로 메모리에만 두고 localStorage 등에 영속화하지 않는다
 * (underwritingPrefill의 1회용 전달 원칙을 상시 컨텍스트로 확장한 것).
 */

type HubListener = (customer: CustomerRecord | null) => void

let current: CustomerRecord | null = null
const listeners = new Set<HubListener>()

export function getHubCustomer(): CustomerRecord | null {
  return current
}

export function setHubCustomer(customer: CustomerRecord | null): void {
  current = customer
  listeners.forEach((fn) => fn(current))
}

/** 변경 구독 — 반환된 함수를 호출하면 구독 해제. */
export function subscribeHubCustomer(fn: HubListener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
