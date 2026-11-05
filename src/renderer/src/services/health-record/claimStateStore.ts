import { getSupabaseClient, initSupabaseClient } from '../commercial/supabaseClient'
import type { ClaimState } from './careWorkspace'

export interface ClaimCheck { status: ClaimState; checked_at: string; checked_by: string }
export type ClaimChecks = Record<string, ClaimCheck>
export interface ClaimRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
}
export interface ClaimStoreResult { ok: boolean; states?: ClaimChecks; error?: string }
const message = '청구 상태를 불러오거나 저장하지 못했습니다. 로그인·조회 접근 권한·보관기간 및 건강기록 청구 상태 DB 마이그레이션을 확인하세요.'
export function createHealthClaimStore(getClient: () => Promise<ClaimRpcClient | null>) {
  async function call(requestId: string, keys?: string[], status?: ClaimState): Promise<ClaimStoreResult> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) return { ok: false, error: '저장된 건강기록 요청을 먼저 선택하세요.' }
    if (keys && (!keys.length || keys.length > 200 || keys.some(k => !/^hrv1-[0-9a-f]{64}$/.test(k)) || !['unknown', 'unclaimed', 'claimed'].includes(status ?? ''))) return { ok: false, error: '선택한 청구 기록이나 상태가 올바르지 않습니다.' }
    try {
      const client = await getClient()
      if (!client) return { ok: false, error: '로그인·서버 연결 후 청구 상태를 저장할 수 있습니다.' }
      const response = await client.rpc(keys ? 'set_health_record_claim_states' : 'get_health_record_claim_states', keys
        ? { p_request_id: requestId, p_record_keys: [...new Set(keys)], p_status: status }
        : { p_request_id: requestId })
      if (response.error || !response.data || typeof response.data !== 'object' || Array.isArray(response.data)) return { ok: false, error: message }
      const states: ClaimChecks = {}
      for (const [key, value] of Object.entries(response.data)) {
        if (!/^hrv1-[0-9a-f]{64}$/.test(key) || !value || typeof value !== 'object') continue
        const v = value as Record<string, unknown>
        if (!['unknown', 'unclaimed', 'claimed'].includes(String(v.status))) continue
        states[key] = { status: v.status as ClaimState, checked_at: String(v.checked_at ?? ''), checked_by: String(v.checked_by ?? '') }
      }
      // A missing acknowledgement must never look like a successfully saved state.
      if (keys?.some(key => states[key]?.status !== status)) return { ok: false, error: '저장된 상태를 서버에서 확인하지 못했습니다. 다시 불러온 후 확인하세요.' }
      return { ok: true, states }
    } catch {
      return { ok: false, error: message }
    }
  }
  return { load: (requestId: string) => call(requestId), save: (requestId: string, keys: string[], status: ClaimState) => call(requestId, keys, status) }
}
export const healthClaimStore = createHealthClaimStore(async () => {
  await initSupabaseClient()
  return getSupabaseClient() as ClaimRpcClient | null
})
