/**
 * SJ CLAIM FINDER — 접근 권한·동의 가드 테스트.
 * ※ 실제 강제는 서버(RLS/엣지함수). 이 테스트는 결정론 가드 로직을 고정한다.
 * 실행: node --test test/claimAccess.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

async function load(src) {
  const r = await build({ entryPoints: [src], bundle: true, format: 'esm', write: false, platform: 'node' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-acc-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, r.outputFiles[0].text, 'utf8')
  return import(file)
}

const { canAccessCustomerResource, isConsentValid, authorizeClaimAnalysis } = await load(
  'src/renderer/src/services/claim-finder/access.ts'
)

const ctx = { orgId: 'org-1', userId: 'u-1', role: 'fc' }
const res = (o) => ({ orgId: 'org-1', customerId: 'cust-1', ...o })

test('같은 조직·같은 고객 → 허용', () => {
  assert.equal(canAccessCustomerResource(ctx, res(), 'cust-1').ok, true)
})

test('다른 조직 자원 → 차단(CROSS_ORG)', () => {
  const g = canAccessCustomerResource(ctx, res({ orgId: 'org-2' }), 'cust-1')
  assert.equal(g.ok, false)
  assert.equal(g.code, 'CROSS_ORG')
})

test('다른 고객 자원 → 차단(CROSS_CUSTOMER)', () => {
  const g = canAccessCustomerResource(ctx, res({ customerId: 'cust-9' }), 'cust-1')
  assert.equal(g.ok, false)
  assert.equal(g.code, 'CROSS_CUSTOMER')
})

test('동의 유효성: 동의됨·철회 없음 → true', () => {
  assert.equal(isConsentValid({ customerId: 'cust-1', granted: true, grantedAt: '2026-01-01T00:00:00Z' }, '2026-06-01T00:00:00Z'), true)
})

test('동의 철회됨 → false', () => {
  const c = { customerId: 'cust-1', granted: true, grantedAt: '2026-01-01T00:00:00Z', revokedAt: '2026-03-01T00:00:00Z' }
  assert.equal(isConsentValid(c, '2026-06-01T00:00:00Z'), false)
})

test('미동의 → false', () => {
  assert.equal(isConsentValid({ customerId: 'cust-1', granted: false }), false)
  assert.equal(isConsentValid(null), false)
})

test('종합 인가: 소유권 OK + 동의 유효 → ok', () => {
  const g = authorizeClaimAnalysis({
    ctx,
    resource: res(),
    requestedCustomerId: 'cust-1',
    consent: { customerId: 'cust-1', granted: true, grantedAt: '2026-01-01T00:00:00Z' },
    asOf: '2026-06-01T00:00:00Z'
  })
  assert.equal(g.ok, true)
})

test('종합 인가: 동의 철회 시 → 차단(CONSENT_REVOKED)', () => {
  const g = authorizeClaimAnalysis({
    ctx,
    resource: res(),
    requestedCustomerId: 'cust-1',
    consent: { customerId: 'cust-1', granted: true, grantedAt: '2026-01-01T00:00:00Z', revokedAt: '2026-02-01T00:00:00Z' },
    asOf: '2026-06-01T00:00:00Z'
  })
  assert.equal(g.ok, false)
  assert.equal(g.code, 'CONSENT_REVOKED')
})

test('종합 인가: 다른 조직이면 동의와 무관하게 차단', () => {
  const g = authorizeClaimAnalysis({
    ctx,
    resource: res({ orgId: 'org-2' }),
    requestedCustomerId: 'cust-1',
    consent: { customerId: 'cust-1', granted: true },
    asOf: '2026-06-01T00:00:00Z'
  })
  assert.equal(g.ok, false)
  assert.equal(g.code, 'CROSS_ORG')
})
