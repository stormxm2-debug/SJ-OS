/**
 * SJ CLAIM FINDER — 분석 실행/검토 저장 서비스.
 *
 * 경계 원칙:
 *  - 저장은 **사용자 세션(JWT)** 으로 supabase-js 를 통해 insert 하므로 서버 RLS 가 실제 경계다
 *    (service_role 우회 없음). 아래 클라이언트측 검사는 방어적 사전검증일 뿐 경계가 아니다.
 *  - **미구성 시 비활성화**: supabase 미설정이면 저장을 시도하지 않고 명확히 안내한다(disabled=true).
 *  - 운영 DB 에 `claim_finder_runs/reviews` 마이그레이션이 적용돼 있어야 실제로 동작한다
 *    (미적용이면 서버가 오류를 반환 → ok:false 로 그대로 노출, 성공 가장하지 않음).
 *  - 의존성 주입(DI): 테스트는 가짜 클라이언트를 넣어 payload/비활성 동작을 검증한다.
 */

import {
  getSupabaseConfigStatus,
  getSupabaseClientOrNull,
  initSupabaseClient
} from '../commercial/supabaseClient'

// supabase-js 중 이 서비스가 쓰는 최소 형태만 구조적으로 요구(무거운 타입 의존 회피).
export interface ClaimStoreClient {
  from(table: string): {
    insert(rows: Record<string, unknown>): {
      select(cols?: string): { single(): Promise<{ data: { id?: string } | null; error: { message: string } | null }> }
    }
    select(cols?: string): {
      eq(col: string, val: unknown): {
        order(col: string, opts: { ascending: boolean }): {
          limit(n: number): Promise<{ data: unknown[] | null; error: { message: string } | null }>
        }
      }
    }
  }
}

export interface ClaimStoreDeps {
  /** null 이면 "미구성"(저장 비활성). */
  getClient: () => Promise<ClaimStoreClient | null>
}

export interface SaveRunInput {
  customerId: string | null
  customerName?: string | null
  healthRecordRequestId: string | null
  coverageAnalysisRef?: string | null
  rulesVersion: string
  isDemo: boolean
  consentAt?: string | null
  status?: 'draft' | 'running' | 'completed' | 'failed'
  result: unknown
  warnings?: unknown
}

export interface SaveReviewInput {
  runId: string
  candidateId: string
  statusOverride?: string | null
  note?: string | null
}

export interface StoreResult<T = void> {
  ok: boolean
  disabled?: boolean // 미구성으로 저장을 시도하지 않음
  id?: string
  data?: T
  error?: string
}

const DISABLED_MSG =
  '저장이 비활성 상태입니다(Supabase 미구성 또는 claim_finder 테이블 미적용). 담당자가 마이그레이션 적용 후 사용하세요. 현재는 화면에만 보관됩니다.'

export function createClaimFinderStore(deps: ClaimStoreDeps) {
  async function saveRun(input: SaveRunInput): Promise<StoreResult> {
    // 방어적 사전검증(서버 RLS 가 최종 경계).
    if (input.isDemo) {
      if (input.customerId || input.healthRecordRequestId) {
        return { ok: false, error: 'DEMO 실행은 실제 고객/건강기록과 연결해 저장할 수 없습니다.' }
      }
    } else if (!input.healthRecordRequestId) {
      return { ok: false, error: '실데이터 저장에는 건강기록 연결(health_record_request_id)이 필요합니다.' }
    }

    const db = await deps.getClient()
    if (!db) return { ok: false, disabled: true, error: DISABLED_MSG }

    const row: Record<string, unknown> = {
      customer_id: input.isDemo ? null : input.customerId,
      customer_name: input.customerName ?? null,
      health_record_request_id: input.isDemo ? null : input.healthRecordRequestId,
      coverage_analysis_ref: input.coverageAnalysisRef ?? null,
      rules_version: input.rulesVersion,
      status: input.status ?? 'completed',
      consent_at: input.isDemo ? null : input.consentAt ?? null,
      is_demo: input.isDemo,
      result: input.result ?? null,
      warnings: input.warnings ?? null
      // staff_id 는 서버 기본값 auth.uid() 로 채워진다(클라이언트가 지정하지 않음).
    }
    try {
      const { data, error } = await db.from('claim_finder_runs').insert(row).select('id').single()
      if (error) return { ok: false, error: error.message }
      return { ok: true, id: data?.id }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async function addReview(input: SaveReviewInput): Promise<StoreResult> {
    if (!input.runId) return { ok: false, error: 'runId 가 필요합니다(저장된 실행에만 검토를 추가할 수 있습니다).' }
    if (!input.candidateId) return { ok: false, error: 'candidateId 가 필요합니다.' }
    const db = await deps.getClient()
    if (!db) return { ok: false, disabled: true, error: DISABLED_MSG }
    const row: Record<string, unknown> = {
      run_id: input.runId,
      candidate_id: input.candidateId,
      status_override: input.statusOverride ?? null,
      note: input.note ?? null
    }
    try {
      const { data, error } = await db.from('claim_finder_reviews').insert(row).select('id').single()
      if (error) return { ok: false, error: error.message }
      return { ok: true, id: data?.id }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  return { saveRun, addReview }
}

/** 실제 구성(사용자 세션 기반). 미구성이면 getClient 가 null → 저장 비활성. */
export const claimFinderStore = createClaimFinderStore({
  getClient: async () => {
    if (!getSupabaseConfigStatus().isConfigured) return null
    await initSupabaseClient()
    return (getSupabaseClientOrNull() as ClaimStoreClient | null) ?? null
  }
})

/** UI 가 저장 버튼 활성/안내를 결정할 때 사용. */
export function isClaimFinderPersistenceConfigured(): boolean {
  return getSupabaseConfigStatus().isConfigured
}
