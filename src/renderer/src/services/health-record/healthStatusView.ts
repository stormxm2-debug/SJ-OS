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
      // 요청일이 잘못돼 경과일을 계산할 수 없으면 만료로 단정하지 않고 '확인 필요'로 구분(열람 불가).
      if (!Number.isFinite(ageDays) || !Number.isFinite(retainDays)) return { text: '보관 기간 확인 필요 — 요청일을 확인할 수 없어 결과 열람 불가', tone: 'muted', canOpen: false }
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

export interface HistoryRefresher {
  /** 같은 검색어로 진행 중인 요청이 있으면 그 요청을 공유하고, 검색어가 다르면 새 요청을 시작한다. */
  refresh: () => Promise<void>
  state: () => HistoryLoadState
}

/**
 * 최근 요청 새로고침 조정기. 10초 폴링·수동 새로고침이 같은 검색어로 겹치면 진행 중 요청 하나를 공유해
 * 응답이 10초 넘게 걸려도 그 응답이 수용되게 한다(매번 새 순번을 발급해 모든 응답이 폐기되는 문제 방지).
 * 검색어가 바뀌면 즉시 새 요청을 시작하고, 이전 검색어 응답은 순번 가드로 최신 목록을 덮지 않는다.
 */
export function createHistoryRefresher<T>(o: {
  load: (query: string) => Promise<{ ok: boolean; items: T[] }>
  query: () => string
  now: () => number
  publish: (s: HistoryLoadState) => void
  apply: (items: T[]) => void
}): HistoryRefresher {
  type Active = { query: string; seq: number; promise: Promise<void> }
  let state = initialHistoryLoad
  let seq = 0
  let active: Active | null = null
  const refresh = (): Promise<void> => {
    const q = o.query()
    if (active && active.query === q) return active.promise
    const my = ++seq
    const entry: Active = { query: q, seq: my, promise: Promise.resolve() }
    active = entry // load 가 동기 예외를 던져도 아래에서 정리되도록 먼저 등록
    state = historyLoadStart(state, my)
    o.publish(state)
    entry.promise = (async () => {
      let r: { ok: boolean; items: T[] }
      try { r = await o.load(q) } catch { r = { ok: false, items: [] } }
      // 이전(다른 검색어) 요청의 정리가 현재 진행 중 요청을 지우지 않게 가드.
      if (active === entry) active = null
      const d = historyLoadDone(state, my, r.ok, q, o.now())
      state = d.next
      o.publish(state)
      if (d.apply) o.apply(r.items)
    })()
    return entry.promise
  }
  return { refresh, state: () => state }
}

/** 화면 오류 상태 — 메시지와 응답 code 를 한 값으로 다뤄 새 오류·초기화마다 code 가 함께 바뀐다(이전 code 잔존 방지). */
export interface HealthUiError { message: string; code: string }
export function healthUiError(message: string | null, code = ''): HealthUiError | null {
  return message === null ? null : { message, code: code ?? '' }
}

// ── 진행 중 요청(start/confirm/invite)의 화면 반영 가드 ──
// 표시용 가드일 뿐 서버 요청을 취소하거나 다시 보내지 않는다. 새 작업 시작·고객/상품/입력방식 전환·
// 저장 결과 열람 시 세대를 올려, 늦게 온 이전 응답(성공·결과·링크·오류·busy 해제)이 새 화면을 덮지 않게 한다.
export interface ForegroundTask { readonly id: number; isCurrent(): boolean }
export interface ForegroundGuard {
  /** 새 작업 시작 — 이전 작업은 자동으로 오래된 작업이 된다. */
  begin(): ForegroundTask
  /** 진행 중 작업을 무효화. 무효화한 작업이 있었으면 true. */
  invalidate(): boolean
  /** 아직 끝나지 않은 현재 작업이 있는지. */
  pending(): boolean
}
export function createForegroundGuard(): ForegroundGuard {
  let gen = 0
  let open = false
  const task = (id: number): ForegroundTask => ({ id, isCurrent: () => id === gen })
  return {
    begin() { gen += 1; open = true; return task(gen) },
    invalidate() { const was = open; gen += 1; open = false; return was },
    pending: () => open
  }
}

export type ForegroundOutcome = 'applied' | 'failed' | 'stale'
/**
 * 작업 하나를 실행하고, 현재 작업일 때만 apply/fail/settle 을 부른다. 오래된 작업이면 stale(선택,
 * 예: 최근 요청 목록 수동 갱신)만 부르고 현재 화면·busy·오류는 건드리지 않는다.
 */
export async function runForeground<T>(
  guard: ForegroundGuard,
  t: ForegroundTask,
  o: { work: () => Promise<T>; apply: (r: T) => void; fail: () => void; settle: () => void; stale?: () => void }
): Promise<ForegroundOutcome> {
  let outcome: ForegroundOutcome
  try {
    const r = await o.work()
    if (!t.isCurrent()) outcome = 'stale'
    else { o.apply(r); outcome = 'applied' }
  } catch {
    if (!t.isCurrent()) outcome = 'stale'
    else { o.fail(); outcome = 'failed' }
  }
  if (t.isCurrent()) {
    guard.invalidate() // 끝난 작업 — 이후 전환은 "진행 중 무효화"가 아니다
    o.settle()
  } else o.stale?.()
  return outcome
}
/** 진행 중에 고객·상품·입력방식을 바꿨을 때의 짧은 안내(이전 서버 작업은 계속됨). */
export const PREV_REQUEST_NOTE = '이전 요청은 「최근 요청」에서 확인하세요.'
