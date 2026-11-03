/**
 * SJ CLAIM FINDER — 저장 서비스 테스트(의존성 주입: 가짜 supabase 클라이언트).
 * 미구성 비활성, DEMO/실데이터 불변식, payload, 오류 전파, 검토 저장 검증.
 * 실행: node --test test/claimFinderStore.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

async function load(src) {
  const r = await build({ entryPoints: [src], bundle: true, format: 'esm', write: false, platform: 'node' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-store-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, r.outputFiles[0].text, 'utf8')
  return import(file)
}

const { createClaimFinderStore } = await load('src/renderer/src/services/claim-finder/claimFinderStore.ts')

// 가짜 클라이언트: insert payload 를 기록하고 지정한 응답을 돌려준다.
function fakeClient({ error = null } = {}) {
  const calls = []
  return {
    calls,
    rows: [],
    from(table) {
      const self = this
      return {
        insert(row) {
          calls.push({ table, row })
          return { select: () => ({ single: async () => ({ data: error ? null : { id: 'row-1' }, error }) }) }
        },
        select(cols) {
          const run = async (extra) => {
            calls.push({ table, op: 'select', cols, ...extra })
            return { data: error ? null : self.rows, error }
          }
          return {
            eq(col, val) {
              return { order: () => ({ limit: async () => run({ eq: [col, val] }) }) }
            },
            order: () => ({ limit: async () => run({ eq: null }) })
          }
        }
      }
    }
  }
}

const baseRun = {
  customerId: 'cust-A',
  customerName: '홍길동',
  healthRecordRequestId: 'hr-1',
  rulesVersion: 'v0.2',
  isDemo: false,
  consentAt: '2026-11-02T00:00:00Z',
  result: [{ id: 'c1' }]
}

test('미구성(getClient=null) → 저장 비활성, 성공 가장 안 함', async () => {
  const store = createClaimFinderStore({ getClient: async () => null })
  const r = await store.saveRun(baseRun)
  assert.equal(r.ok, false)
  assert.equal(r.disabled, true)
  assert.match(r.error, /비활성/)
})

test('실데이터 저장: payload 에 고객/요청/동의/규칙 포함, staff_id 미지정(서버 기본값)', async () => {
  const client = fakeClient()
  const store = createClaimFinderStore({ getClient: async () => client })
  const r = await store.saveRun(baseRun)
  assert.equal(r.ok, true)
  assert.equal(r.id, 'row-1')
  const row = client.calls[0].row
  assert.equal(client.calls[0].table, 'claim_finder_runs')
  assert.equal(row.customer_id, 'cust-A')
  assert.equal(row.health_record_request_id, 'hr-1')
  assert.equal(row.consent_at, '2026-11-02T00:00:00Z')
  assert.equal(row.is_demo, false)
  assert.equal('staff_id' in row, false, 'staff_id 는 서버 auth.uid() 기본값으로 — 클라이언트가 지정하지 않음')
})

test('실데이터인데 건강기록 미연결 → 저장 거부(서버 가기 전 방어)', async () => {
  const client = fakeClient()
  const store = createClaimFinderStore({ getClient: async () => client })
  const r = await store.saveRun({ ...baseRun, healthRecordRequestId: null })
  assert.equal(r.ok, false)
  assert.equal(client.calls.length, 0, 'DB 호출 없이 거부')
})

test('DEMO 저장: 실고객/요청 연결 금지(강제 null), 연결 시 거부', async () => {
  const client = fakeClient()
  const store = createClaimFinderStore({ getClient: async () => client })
  // 연결 시도 → 거부
  const bad = await store.saveRun({ ...baseRun, isDemo: true })
  assert.equal(bad.ok, false)
  assert.equal(client.calls.length, 0)
  // 올바른 DEMO → 허용, customer/hr null 강제
  const ok = await store.saveRun({ customerId: null, healthRecordRequestId: null, rulesVersion: 'v0.2', isDemo: true, result: [] })
  assert.equal(ok.ok, true)
  assert.equal(client.calls[0].row.customer_id, null)
  assert.equal(client.calls[0].row.health_record_request_id, null)
  assert.equal(client.calls[0].row.is_demo, true)
})

test('서버 오류(예: 테이블 미적용/ RLS 거부) → ok:false 로 그대로 노출', async () => {
  const client = fakeClient({ error: { message: 'relation "claim_finder_runs" does not exist' } })
  const store = createClaimFinderStore({ getClient: async () => client })
  const r = await store.saveRun(baseRun)
  assert.equal(r.ok, false)
  assert.match(r.error, /does not exist/)
})

test('검토 저장: runId 필요, payload 매핑', async () => {
  const client = fakeClient()
  const store = createClaimFinderStore({ getClient: async () => client })
  const noRun = await store.addReview({ runId: '', candidateId: 'c1' })
  assert.equal(noRun.ok, false)
  assert.equal(client.calls.length, 0)
  const ok = await store.addReview({ runId: 'run-1', candidateId: 'c1', statusOverride: 'EXCLUDED', note: '제외' })
  assert.equal(ok.ok, true)
  assert.equal(client.calls[0].table, 'claim_finder_reviews')
  assert.equal(client.calls[0].row.run_id, 'run-1')
  assert.equal(client.calls[0].row.status_override, 'EXCLUDED')
})

test('검토 저장도 미구성 시 비활성', async () => {
  const store = createClaimFinderStore({ getClient: async () => null })
  const r = await store.addReview({ runId: 'run-1', candidateId: 'c1' })
  assert.equal(r.ok, false)
  assert.equal(r.disabled, true)
})

test('getClient 예외 → ok:false 로 처리(비활성 아님, throw 안 함)', async () => {
  const store = createClaimFinderStore({ getClient: async () => { throw new Error('init boom') } })
  const r = await store.saveRun(baseRun)
  assert.equal(r.ok, false)
  assert.notEqual(r.disabled, true)
  assert.match(r.error, /init boom/)
  const rv = await store.addReview({ runId: 'run-1', candidateId: 'c1' })
  assert.equal(rv.ok, false)
  assert.match(rv.error, /init boom/)
})

test('재조회 listRuns: customer 로 필터, data 반환', async () => {
  const client = fakeClient()
  client.rows = [{ id: 'run-1', customer_id: 'cust-A' }]
  const store = createClaimFinderStore({ getClient: async () => client })
  const r = await store.listRuns('cust-A')
  assert.equal(r.ok, true)
  assert.deepEqual(r.data, [{ id: 'run-1', customer_id: 'cust-A' }])
  const sel = client.calls.find((c) => c.op === 'select' && c.table === 'claim_finder_runs')
  assert.deepEqual(sel.eq, ['customer_id', 'cust-A'])
})

test('재조회 listReviews: run 으로 필터', async () => {
  const client = fakeClient()
  client.rows = [{ id: 'rev-1', run_id: 'run-1' }]
  const store = createClaimFinderStore({ getClient: async () => client })
  const r = await store.listReviews('run-1')
  assert.equal(r.ok, true)
  assert.equal(r.data.length, 1)
})

test('재조회도 미구성 시 비활성 + 인자 검증', async () => {
  const store0 = createClaimFinderStore({ getClient: async () => null })
  assert.equal((await store0.listRuns('cust-A')).disabled, true)
  const store = createClaimFinderStore({ getClient: async () => fakeClient() })
  assert.equal((await store.listRuns('')).ok, false)
  assert.equal((await store.listReviews('')).ok, false)
})

test('재조회 서버 오류 → ok:false 로 노출', async () => {
  const client = fakeClient({ error: { message: 'permission denied' } })
  const store = createClaimFinderStore({ getClient: async () => client })
  const r = await store.listRuns('cust-A')
  assert.equal(r.ok, false)
  assert.match(r.error, /permission denied/)
})

test('listVisibleRuns: is_demo=false 필터(RLS 스코프), 요약 매핑', async () => {
  const client = fakeClient()
  client.rows = [{ id: 'run-1', customer_id: 'cust-A', rules_version: 'v0.2', status: 'completed', is_demo: false, created_at: 't1' },
                 { id: 'run-2', customer_id: null, rules_version: 'v0.2', status: 'completed', is_demo: true, created_at: 't2' }]
  const store = createClaimFinderStore({ getClient: async () => client })
  const r = await store.listVisibleRuns()
  assert.equal(r.ok, true)
  assert.equal(r.data.length, 2)
  assert.equal(r.data[0].id, 'run-1')
  assert.equal(r.data[1].isDemo, true)
  const sel = client.calls.find((c) => c.op === 'select' && c.table === 'claim_finder_runs')
  assert.deepEqual(sel.eq, ['is_demo', false], 'DEMO(합성) 실행은 서버 조회에서 제외')
})

test('getRun: id 로 단건 복원(result 포함)', async () => {
  const client = fakeClient()
  client.rows = [{ id: 'run-1', customer_id: 'cust-A', customer_name: '홍', health_record_request_id: 'hr-1', coverage_analysis_ref: null, rules_version: 'v0.2', status: 'completed', is_demo: false, result: [{ id: 'c1' }], warnings: [], created_at: 't1' }]
  const store = createClaimFinderStore({ getClient: async () => client })
  const r = await store.getRun('run-1')
  assert.equal(r.ok, true)
  assert.equal(r.data.id, 'run-1')
  assert.equal(r.data.healthRecordRequestId, 'hr-1')
  assert.deepEqual(r.data.result, [{ id: 'c1' }])
})

test('getRun: RLS 로 안 보이면 data null(성공, 없음)', async () => {
  const client = fakeClient()
  client.rows = []
  const store = createClaimFinderStore({ getClient: async () => client })
  const r = await store.getRun('run-x')
  assert.equal(r.ok, true)
  assert.equal(r.data, null)
})

test('getRun/listVisibleRuns 미구성 시 비활성', async () => {
  const store = createClaimFinderStore({ getClient: async () => null })
  assert.equal((await store.getRun('run-1')).disabled, true)
  assert.equal((await store.listVisibleRuns()).disabled, true)
})

test('서버가 id 없이 반환 → 성공 가장 금지(null id 실패)', async () => {
  const client = {
    from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: {}, error: null }) }) }) })
  }
  const store = createClaimFinderStore({ getClient: async () => client })
  const r = await store.saveRun(baseRun)
  assert.equal(r.ok, false, 'id 없으면 ok:false')
  assert.match(r.error, /id/)
  const rv = await store.addReview({ runId: 'run-1', candidateId: 'c1' })
  assert.equal(rv.ok, false)
})
