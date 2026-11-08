import type { CareRecord, ClaimState } from './careWorkspace'
import type { ClaimCheck, ClaimChecks, ClaimStoreResult } from './claimStateStore'

/**
 * 청구 관리 화면의 순수 상태 도우미 — 상태별 건수와 '마지막 표시 변경 되돌리기'.
 * 서비스 API 계약(한 번에 한 상태·최대 200키, CAS 없음)은 그대로 쓰며 DB/RPC를 늘리지 않는다.
 * 되돌리기는 직전 조회로 '내가 저장한 뒤 바뀐 것이 없는지'만 확인할 수 있다. 조회와 복원 쓰기 사이의
 * 동시 쓰기는 원자적으로 막을 수 없다(docs/HEALTH_RECORD_UI_RELEASE.md v1.0.60 참고).
 */
export const CLAIM_SAVE_LIMIT = 200
export const CLAIM_ORDER: ClaimState[] = ['unknown', 'unclaimed', 'claimed']

export interface ClaimCounts { all: number; unknown: number; unclaimed: number; claimed: number }
/** 같은 기반 목록에서 집계하므로 unknown+unclaimed+claimed === all. 준비 전이면 null(건수 '-'). */
export function claimCounts(records: CareRecord[], statusOf: (r: CareRecord) => ClaimState, ready: boolean): ClaimCounts | null {
  if (!ready) return null
  const counts: ClaimCounts = { all: records.length, unknown: 0, unclaimed: 0, claimed: 0 }
  for (const r of records) counts[statusOf(r)]++
  return counts
}

export interface ClaimUndoToken {
  requestId: string
  scope: number
  status: ClaimState
  /** 저장으로 실제 상태가 바뀐 키와 저장 전 상태(미등록 키는 unknown). */
  targets: { key: string; prev: ClaimState }[]
  /** 저장 성공 응답의 해당 키 스냅샷 — 되돌리기 직전 조회와 비교한다. */
  after: Record<string, ClaimCheck>
}

/** 성공 응답 확인 후에만 호출. 원래 같은 상태였던 키는 되돌릴 대상에서 뺀다. 바뀐 것이 없으면 null. */
export function createUndoToken(input: { requestId: string; scope: number; status: ClaimState; keys: string[]; before: ClaimChecks; reply: ClaimChecks }): ClaimUndoToken | null {
  const targets: ClaimUndoToken['targets'] = []
  const after: Record<string, ClaimCheck> = {}
  for (const key of new Set(input.keys)) {
    const prev = input.before[key]?.status ?? 'unknown'
    const saved = input.reply[key]
    if (prev === input.status || !saved || saved.status !== input.status) continue
    targets.push({ key, prev })
    after[key] = { ...saved }
  }
  return targets.length ? { requestId: input.requestId, scope: input.scope, status: input.status, targets, after } : null
}

/** 이전 상태별 묶음(최대 3개), 각 묶음은 저장 한도 이하로 나눈다. */
export function undoGroups(token: ClaimUndoToken): { status: ClaimState; keys: string[] }[] {
  const groups: { status: ClaimState; keys: string[] }[] = []
  for (const status of CLAIM_ORDER) {
    const keys = token.targets.filter(t => t.prev === status).map(t => t.key)
    for (let i = 0; i < keys.length; i += CLAIM_SAVE_LIMIT) groups.push({ status, keys: keys.slice(i, i + CLAIM_SAVE_LIMIT) })
  }
  return groups
}

/** 저장 이후 서버에서 바뀐 대상 키(상태·확인 시각·확인자 중 하나라도 다르면 다른 변경으로 본다). */
export function undoConflicts(token: ClaimUndoToken, current: ClaimChecks): string[] {
  return token.targets.map(t => t.key).filter(key => {
    const a = token.after[key], b = current[key]
    return !b || b.status !== a.status || b.checked_at !== a.checked_at || b.checked_by !== a.checked_by
  })
}

export type UndoOutcome =
  | { kind: 'done'; restored: number; states: ClaimChecks }
  | { kind: 'conflict'; states: ClaimChecks; changed: number }
  | { kind: 'load-failed'; error: string }
  | { kind: 'partial'; restored: number; remaining: number; error: string }
  | { kind: 'aborted'; restored: number; remaining: number }

export interface UndoDeps {
  load: (requestId: string) => Promise<ClaimStoreResult>
  save: (requestId: string, keys: string[], status: ClaimState) => Promise<ClaimStoreResult>
  /** 요청·기간·새로고침 등으로 화면 범위가 바뀌었으면 false — 남은 쓰기를 보내지 않는다. */
  isCurrent: () => boolean
}

/**
 * 직전 조회로 다른 변경이 없을 때만 묶음별로 순차 복원한다. 실패한 묶음에서 멈추고 이미 성공한 묶음은
 * 다시 되돌리지 않으며 자동 재시도하지 않는다. 이미 전송한 RPC는 취소된다고 가정하지 않는다.
 */
export async function runClaimUndo(token: ClaimUndoToken, deps: UndoDeps): Promise<UndoOutcome> {
  const total = token.targets.length
  if (!deps.isCurrent()) return { kind: 'aborted', restored: 0, remaining: total }
  let loaded: ClaimStoreResult
  try { loaded = await deps.load(token.requestId) } catch { loaded = { ok: false } }
  if (!deps.isCurrent()) return { kind: 'aborted', restored: 0, remaining: total }
  if (!loaded.ok || !loaded.states) return { kind: 'load-failed', error: loaded.error ?? '현재 상태를 확인하지 못했습니다.' }
  const changed = undoConflicts(token, loaded.states).length
  if (changed) return { kind: 'conflict', states: loaded.states, changed }
  let restored = 0
  let states = loaded.states
  for (const group of undoGroups(token)) {
    if (!deps.isCurrent()) return { kind: 'aborted', restored, remaining: total - restored }
    let reply: ClaimStoreResult
    try { reply = await deps.save(token.requestId, group.keys, group.status) } catch { reply = { ok: false } }
    if (!deps.isCurrent()) return { kind: 'aborted', restored: reply.ok ? restored + group.keys.length : restored, remaining: total - restored - (reply.ok ? group.keys.length : 0) }
    if (!reply.ok || !reply.states) return { kind: 'partial', restored, remaining: total - restored, error: reply.error ?? '되돌리기 저장에 실패했습니다.' }
    restored += group.keys.length
    states = reply.states
  }
  return { kind: 'done', restored, states }
}
