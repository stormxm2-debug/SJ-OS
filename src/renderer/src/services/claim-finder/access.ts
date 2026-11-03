/**
 * SJ CLAIM FINDER — 접근 권한·동의 가드 (순수 로직)
 *
 * ★ 실제 강제는 서버(Supabase RLS)에서 한다(운영 kmjnluubjgyxkppxxjel 에 2026-11-03 적용됨).
 *   이 모듈은 그 규칙을 "결정론 함수"로 재현해 단위 테스트와 서비스 계층 사전검증에 쓴다.
 *   - 조직(org)·고객 소유권 확인: 다른 조직/다른 고객의 파일·결과 접근 차단.
 *   - 고객 동의 유효성·철회 확인: 철회됐거나 미동의면 분석/열람 금지.
 * ※ 이 가드를 "우회"하지 않는다. 서버 측 검증을 대체하지 않으며 보조할 뿐이다.
 */

export type Role = 'owner' | 'admin' | 'team-leader' | 'fc' | 'back-office'

export interface AccessContext {
  orgId: string
  userId: string
  role: Role
}

/** 보호 자원(업로드 원본/분석 결과/후보 등)의 소유 정보. */
export interface OwnedResource {
  orgId: string
  customerId: string
}

export interface ConsentState {
  customerId: string
  granted: boolean
  grantedAt?: string | null // ISO
  revokedAt?: string | null // ISO (있으면 철회)
  scope?: string // 예: 'claim-finder'
}

export interface GuardResult {
  ok: boolean
  code?: 'CROSS_ORG' | 'CROSS_CUSTOMER' | 'NO_CONSENT' | 'CONSENT_REVOKED' | 'BAD_INPUT'
  reason?: string
}

const OK: GuardResult = { ok: true }

/** 자원이 호출자의 조직 소유인지 + 요청한 고객과 일치하는지. */
export function canAccessCustomerResource(
  ctx: AccessContext,
  resource: OwnedResource,
  requestedCustomerId: string
): GuardResult {
  if (!ctx?.orgId || !ctx?.userId) return { ok: false, code: 'BAD_INPUT', reason: '인증 컨텍스트가 없습니다.' }
  if (!resource?.orgId || !resource?.customerId) return { ok: false, code: 'BAD_INPUT', reason: '자원 소유 정보가 없습니다.' }
  if (resource.orgId !== ctx.orgId) {
    return { ok: false, code: 'CROSS_ORG', reason: '다른 조직의 자원에 접근할 수 없습니다.' }
  }
  if (requestedCustomerId && resource.customerId !== requestedCustomerId) {
    return { ok: false, code: 'CROSS_CUSTOMER', reason: '다른 고객의 자원에 접근할 수 없습니다.' }
  }
  return OK
}

/** 동의가 "현재 유효"한지(동의됨 + 철회되지 않음). asOf 기본: 현재. */
export function isConsentValid(consent: ConsentState | null | undefined, asOf?: string): boolean {
  if (!consent || consent.granted !== true) return false
  const now = asOf ? Date.parse(asOf) : Date.now()
  if (Number.isNaN(now)) return false
  if (consent.grantedAt) {
    const g = Date.parse(consent.grantedAt)
    if (!Number.isNaN(g) && g > now) return false // 아직 동의 전
  }
  if (consent.revokedAt) {
    const r = Date.parse(consent.revokedAt)
    if (!Number.isNaN(r) && r <= now) return false // 철회됨
  }
  return true
}

/** 분석/열람 종합 인가: 소유권 + 동의 유효성 둘 다 통과해야 함. */
export function authorizeClaimAnalysis(args: {
  ctx: AccessContext
  resource: OwnedResource
  requestedCustomerId: string
  consent: ConsentState | null | undefined
  asOf?: string
}): GuardResult {
  const own = canAccessCustomerResource(args.ctx, args.resource, args.requestedCustomerId)
  if (!own.ok) return own
  if (!args.consent || args.consent.granted !== true) {
    return { ok: false, code: 'NO_CONSENT', reason: '고객 동의가 없습니다.' }
  }
  if (!isConsentValid(args.consent, args.asOf)) {
    return { ok: false, code: 'CONSENT_REVOKED', reason: '고객 동의가 철회되었거나 유효하지 않습니다.' }
  }
  return OK
}
