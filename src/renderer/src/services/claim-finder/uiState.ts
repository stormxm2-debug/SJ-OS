/**
 * SJ CLAIM FINDER — 결과 수명주기(UI) 상태 리듀서(순수 함수, 단독 테스트 가능).
 *
 * 리뷰 반영(상태 위생): 아래 전이는 **이전 고객의 결과·검토메모가 남지 않도록** 보장한다.
 *  - 고객 변경(외부 hub 변경 포함): 동의·결과·검토·DEMO·필터·안내를 모두 초기화.
 *  - 동의 해제(철회): 결과·검토메모·DEMO·안내를 즉시 제거(동의 없이 결과 노출 금지).
 *  - DEMO 토글/실분석: 결과 교체 시 검토메모를 초기화(다른 고객/합성 결과의 메모 혼입 금지).
 */

import type { AnalyzeResult, ClaimStatus } from './claimRules'

export type ReviewMap = Record<string, { status?: ClaimStatus; note?: string }>

export interface ClaimUiState {
  customerId: string | null
  consent: boolean
  result: AnalyzeResult | null
  isDemo: boolean
  review: ReviewMap
  filter: ClaimStatus | 'ALL'
  notice: string | null
  error: string | null
  /** 서버에 저장된 run id(저장 후에만). 검토이력 저장은 이 id 가 있어야 가능. */
  savedRunId: string | null
}

export const INITIAL_UI_STATE: ClaimUiState = {
  customerId: null,
  consent: false,
  result: null,
  isDemo: false,
  review: {},
  filter: 'ALL',
  notice: null,
  error: null,
  savedRunId: null
}

/** 결과·검토 등 "현재 결과에 속한" 상태만 비운다(고객/동의는 유지). */
function clearedResult(s: ClaimUiState): ClaimUiState {
  return { ...s, result: null, isDemo: false, review: {}, filter: 'ALL', notice: null, savedRunId: null }
}

export type ClaimUiAction =
  | { type: 'SELECT_CUSTOMER'; customerId: string | null }
  | { type: 'SET_CONSENT'; consent: boolean }
  | { type: 'ANALYZE_DONE'; result: AnalyzeResult; notice?: string }
  | { type: 'DEMO_DONE'; result: AnalyzeResult; notice?: string }
  | { type: 'SET_FILTER'; filter: ClaimStatus | 'ALL' }
  | { type: 'SET_REVIEW'; id: string; patch: { status?: ClaimStatus; note?: string } }
  | { type: 'SET_NOTICE'; notice: string | null }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SAVE_DONE'; runId: string; notice?: string }
  | { type: 'CLEAR_RESULT'; notice?: string } // 입력이 결과와 달라지면 결과 무효화(고객/동의 유지)
  | { type: 'LOADED_RUN'; result: AnalyzeResult; review: ReviewMap; isDemo: boolean; runId: string; notice?: string }

export function claimUiReducer(state: ClaimUiState, action: ClaimUiAction): ClaimUiState {
  switch (action.type) {
    case 'SELECT_CUSTOMER': {
      // 같은 고객 재선택이면 아무 것도 지우지 않는다(불필요한 초기화 방지).
      if (action.customerId === state.customerId) return state
      // 고객이 바뀌면 동의·결과·검토·DEMO 전부 초기화(이전 고객 흔적 제거).
      return { ...INITIAL_UI_STATE, customerId: action.customerId }
    }
    case 'SET_CONSENT': {
      if (!action.consent) {
        // 동의 해제(철회): 결과·검토메모까지 제거.
        return { ...clearedResult(state), consent: false }
      }
      return { ...state, consent: true }
    }
    case 'ANALYZE_DONE':
      return { ...state, result: action.result, isDemo: false, review: {}, filter: 'ALL', notice: action.notice ?? null, error: null, savedRunId: null }
    case 'DEMO_DONE':
      return { ...state, result: action.result, isDemo: true, review: {}, filter: 'ALL', notice: action.notice ?? null, error: null, savedRunId: null }
    case 'SAVE_DONE':
      return { ...state, savedRunId: action.runId, notice: action.notice ?? state.notice }
    case 'CLEAR_RESULT':
      return state.result == null ? state : { ...clearedResult(state), notice: action.notice ?? null }
    case 'LOADED_RUN':
      // 저장된 run 을 불러옴 — 이미 저장됐으므로 savedRunId 설정(중복 저장 방지).
      return {
        ...state,
        result: action.result,
        review: action.review,
        isDemo: action.isDemo,
        savedRunId: action.runId,
        filter: 'ALL',
        notice: action.notice ?? null,
        error: null
      }
    case 'SET_FILTER':
      return { ...state, filter: action.filter }
    case 'SET_REVIEW':
      return { ...state, review: { ...state.review, [action.id]: { ...state.review[action.id], ...action.patch } } }
    case 'SET_NOTICE':
      return { ...state, notice: action.notice }
    case 'SET_ERROR':
      return { ...state, error: action.error }
    default:
      return state
  }
}
