/**
 * 건강기록 화면 표시 분류(표시 전용, 순수 함수).
 *
 * 상단 상태 카드·오류 안내·최근 요청 행이 같은 분류를 써서 "다음 행동 하나"가 서로 충돌하지 않게 한다.
 * 요청 서비스·요청 매개변수·폴링에는 관여하지 않는다.
 */
import type { HealthRecordRequest } from '@renderer/services/commercial/healthRecordService'

export type HealthErrorKind = 'uncertain' | 'hours' | 'name' | 'identity' | 'session' | 'general'

export interface HealthErrorView {
  kind: HealthErrorKind
  title: string
  /** 사용자가 할 행동 1~2줄(구현 설명 없음). */
  action: string
  /** 응답 확인 필요: 최근 요청 확인이 주행동이고, 새 인증·조회는 보조행동. */
  checkHistoryFirst: boolean
}

export function classifyHealthError(message: string, code = ''): HealthErrorView {
  const m = message ?? ''
  const all = `${code ?? ''} ${m}`
  if (code === 'HEALTH_TIMEOUT' || code === 'HEALTH_NETWORK' || /TIMEOUT|시간.*초과|응답.*지연|연결할 수 없/i.test(all))
    return { kind: 'uncertain', checkHistoryFirst: true, title: '응답 확인 필요', action: '서버에서 이미 끝났을 수 있습니다. 먼저 최근 요청을 새로고침해 진행 상태를 확인하세요.' }
  if (/이용.*시간|운영.*시간|점검|서비스.*시간/.test(m))
    return { kind: 'hours', checkHistoryFirst: false, title: '기관 이용 시간 확인', action: '기관의 공식 이용 시간을 확인한 뒤 다시 요청하세요.' }
  if (/외국인|성명|이름|userName/i.test(m))
    return { kind: 'name', checkHistoryFirst: false, title: '고객 이름 확인', action: '인증서에 등록된 이름과 같은지(외국인은 공백·순서) 확인하고 다시 요청하세요.' }
  if (/주민|생년|identity|CF-13000/i.test(all))
    return { kind: 'identity', checkHistoryFirst: false, title: '본인확인 정보 확인', action: '생년월일·주민번호를 다시 확인하세요. 같은 오류가 반복되면 담당자에게 문의하세요.' }
  if (/만료|완료된 요청|CF-00025/.test(all))
    return { kind: 'session', checkHistoryFirst: true, title: '인증 세션 종료', action: '먼저 최근 요청에서 완료 여부를 확인하고, 없으면 인증을 새로 요청하세요.' }
  return { kind: 'general', checkHistoryFirst: false, title: '조회 실패', action: '입력 내용을 확인하고 다시 요청하세요. 반복되면 오류 코드와 함께 담당자에게 문의하세요.' }
}

export type RowActionTone = 'wait' | 'open' | 'error' | 'muted'
export interface HistoryRowAction { text: string; tone: RowActionTone; canOpen: boolean }

/** 최근 요청 행 다음 행동. 실제 서버 상태값만 보고, 서버에 없는 상태를 만들지 않는다. */
export function historyRowAction(h: Pick<HealthRecordRequest, 'status' | 'result' | 'error'>, ageDays: number, retainDays: number): HistoryRowAction {
  switch (h.status) {
    case 'awaiting_customer': return { text: '고객이 링크에서 정보 입력 대기', tone: 'wait', canOpen: false }
    case 'awaiting_auth': return { text: '고객 휴대폰 승인 대기', tone: 'wait', canOpen: false }
    case 'consented':
    case 'fetching': return { text: '조회 진행 중 — 잠시 후 자동 갱신', tone: 'wait', canOpen: false }
    case 'completed':
      if (ageDays > retainDays) return { text: `보관 기간(${retainDays}일) 경과 — 결과 열람 불가`, tone: 'muted', canOpen: false }
      if (!h.result) return { text: '완료됐지만 결과 자료가 없습니다 — 자료 확인 필요', tone: 'muted', canOpen: false }
      return { text: `결과 열기 가능 · ${Math.max(0, retainDays - ageDays)}일 남음`, tone: 'open', canOpen: true }
    case 'failed': {
      const v = classifyHealthError(h.error ?? '')
      return { text: `${v.title} — ${v.action}`, tone: 'error', canOpen: false }
    }
    default: return { text: '상태 확인 필요', tone: 'muted', canOpen: false }
  }
}

/**
 * 최근 요청 목록 로딩 메타데이터. 요청 순번(seq)으로 늦게 온 이전 응답이 최신 상태를 덮지 않게 한다.
 */
export interface HistoryLoadState {
  latestSeq: number
  /** 화면 목록이 반영한 검색어(성공 응답 기준). */
  shownQuery: string
  loading: boolean
  failed: boolean
  lastOkAt: number | null
}
export const initialHistoryLoad: HistoryLoadState = { latestSeq: 0, shownQuery: '', loading: false, failed: false, lastOkAt: null }

export function historyLoadStart(s: HistoryLoadState, seq: number): HistoryLoadState {
  return { ...s, latestSeq: Math.max(s.latestSeq, seq), loading: true }
}
/** 응답 적용 여부(apply)와 다음 메타데이터. 최신 요청이 아닌 응답은 무시. */
export function historyLoadDone(s: HistoryLoadState, seq: number, ok: boolean, query: string, now: number): { apply: boolean; next: HistoryLoadState } {
  if (seq !== s.latestSeq) return { apply: false, next: s }
  if (!ok) return { apply: false, next: { ...s, loading: false, failed: true } }
  return { apply: true, next: { ...s, loading: false, failed: false, shownQuery: query, lastOkAt: now } }
}
