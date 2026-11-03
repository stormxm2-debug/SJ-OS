/**
 * SJ CLAIM FINDER — 저장된 run/검토 복원(순수 함수, 단독 테스트).
 *
 * - validateSavedRun: 저장된 run(result jsonb)을 화면용 AnalyzeResult 로 복원하며 shape·규칙버전을 검증.
 *   손상/형식오류는 error, 규칙버전 불일치는 warning(참고용, 재분석 권장).
 * - reviewsToLatestMap: 검토 행(여러 개 가능)에서 후보별 **최신값**만 복원.
 */
import { STATUS_LABEL, type AnalyzeResult, type ClaimCandidate, type ClaimStatus } from './claimRules'
import type { ReviewMap } from './uiState'

const STATUS_SET = new Set(Object.keys(STATUS_LABEL))

export interface RestoreResult {
  ok: boolean
  result?: AnalyzeResult
  errors: string[]
  warnings: string[]
}

/** 저장된 run → AnalyzeResult 복원 + 검증. */
export function validateSavedRun(
  run: { result: unknown; warnings?: unknown; rulesVersion: string; createdAt: string; isDemo: boolean },
  currentRulesVersion: string
): RestoreResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!Array.isArray(run.result)) {
    errors.push('저장된 결과(result)가 후보 배열이 아닙니다 — 손상되었거나 형식이 다릅니다.')
    return { ok: false, errors, warnings }
  }
  const candidates: ClaimCandidate[] = []
  for (let i = 0; i < run.result.length; i++) {
    const c = run.result[i] as Partial<ClaimCandidate> | null
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || typeof c.status !== 'string' || !STATUS_SET.has(c.status)) {
      errors.push(`후보[${i}] 형식 오류(id/status 누락 또는 알 수 없는 상태) — 복원 중단.`)
      return { ok: false, errors, warnings }
    }
    candidates.push(c as ClaimCandidate)
  }

  if (!run.rulesVersion) warnings.push('저장 당시 규칙 버전이 비어 있습니다(참고용).')
  else if (run.rulesVersion !== currentRulesVersion) {
    warnings.push(`저장 당시 규칙(${run.rulesVersion}) ≠ 현재 규칙(${currentRulesVersion}) — 복원은 저장 시점 결과이며, 최신 규칙 반영은 재분석이 필요합니다.`)
  }

  const savedWarnings = Array.isArray(run.warnings) ? (run.warnings as unknown[]).filter((w): w is string => typeof w === 'string') : []

  const result: AnalyzeResult = {
    candidates,
    warnings: savedWarnings,
    rulesVersion: run.rulesVersion,
    generatedAt: run.createdAt
  }
  return { ok: true, result, errors, warnings }
}

/** 검토 행(여러 개 가능) → 후보별 최신값. created_at 내림차순 기준으로 first-wins. */
export function reviewsToLatestMap(
  rows: Array<{ candidate_id?: unknown; status_override?: unknown; note?: unknown; created_at?: unknown }>
): ReviewMap {
  const sorted = [...(rows ?? [])].sort((a, b) => String(b?.created_at ?? '').localeCompare(String(a?.created_at ?? '')))
  const map: ReviewMap = {}
  for (const r of sorted) {
    const cid = typeof r?.candidate_id === 'string' ? r.candidate_id : null
    if (!cid || map[cid]) continue // 최신 1건만(이미 있으면 건너뜀)
    const status = typeof r?.status_override === 'string' && STATUS_SET.has(r.status_override) ? (r.status_override as ClaimStatus) : undefined
    const note = typeof r?.note === 'string' ? r.note : undefined
    map[cid] = { status, note }
  }
  return map
}
