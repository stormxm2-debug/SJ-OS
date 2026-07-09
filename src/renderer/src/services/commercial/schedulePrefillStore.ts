import type { ScheduleType } from './scheduleValidation'

/**
 * 화면 간 일정 등록 프리필 — 상담기록의 "일정으로 등록" 버튼이 여기에 값을 넣고
 * 일정관리로 이동하면, 일정관리가 마운트 시 꺼내 등록 폼을 자동으로 연다.
 * (1회성 — 꺼내면 비워짐. 저장소는 메모리라 새로고침 시 사라지는 것이 정상.)
 */

export interface SchedulePrefill {
  type: ScheduleType
  customerId?: string
  hint?: string
}

let pending: SchedulePrefill | null = null

export function setSchedulePrefill(p: SchedulePrefill): void {
  pending = p
}

export function takeSchedulePrefill(): SchedulePrefill | null {
  const p = pending
  pending = null
  return p
}
