/**
 * 건강기록 조회 입력 화면의 "현재 상태" 파생(표시 전용, 순수 함수).
 *
 * 원칙: 조회 결과(hasResult)는 진행 중인 새 인증/링크 작업이 없을 때만 'done'으로 표시한다.
 * 새 작업이 진행 중이거나 실패했거나 새 링크가 발급되면 그 상태가 우선한다 — 이전 고객 결과를
 * 새 요청의 성공으로 보이지 않게 하기 위함. (핸들러는 새 작업 시작 시 결과를 비운다.)
 */
export type EntryPhase = 'idle' | 'requesting' | 'awaiting' | 'link_sent' | 'fetching' | 'done' | 'failed'

export interface EntryPhaseInput {
  inputMode: 'staff' | 'customer'
  hasResult: boolean
  busy: boolean // 직원 직접 입력: 요청/조회 진행 중
  hasTwoWay: boolean // 직원 직접 입력: 승인 대기 세션 있음
  inviteBusy: boolean // 고객 링크: 링크 생성 중
  hasInvite: boolean // 고객 링크: 새 링크 발급됨
  hasError: boolean
}

export function deriveEntryPhase(s: EntryPhaseInput): EntryPhase {
  if (s.inputMode === 'staff') {
    if (s.busy) return s.hasTwoWay ? 'fetching' : 'requesting'
    if (s.hasError) return 'failed'
    if (s.hasTwoWay) return 'awaiting'
    return s.hasResult ? 'done' : 'idle'
  }
  if (s.inviteBusy) return 'requesting'
  if (s.hasError) return 'failed'
  if (s.hasInvite) return 'link_sent'
  return s.hasResult ? 'done' : 'idle'
}
