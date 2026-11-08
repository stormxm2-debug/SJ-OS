import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// 청구 관리 상태 건수·되돌리기 도우미(순수 로직) 검증 — 합성 키·합성 서비스 mock만 사용.
async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-claim-undo-')), file = join(dir, 'module.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(pathToFileURL(file).href)
}
const u = await load('src/renderer/src/services/health-record/claimUndo.ts')
const RID = '11111111-1111-4111-8111-111111111111'
const key = (n) => `hrv1-${n.toString(16).padStart(64, '0')}`
const check = (status, at = 't0', by = 'me') => ({ status, checked_at: at, checked_by: by })

/** 합성 서버: 실제 RPC처럼 한 상태·최대 200키만 받고 전체 states를 돌려준다. */
function fakeServer(initial, { failSaveAt = -1, failLoad = false, onLoad } = {}) {
  let states = structuredClone(initial), saves = 0, tick = 0
  const calls = []
  return {
    calls, get states() { return states },
    set(next) { states = next },
    load: async () => { calls.push(['load']); onLoad?.(); return failLoad ? { ok: false, error: 'x' } : { ok: true, states: structuredClone(states) } },
    save: async (rid, keys, status) => {
      calls.push(['save', status, [...keys]])
      assert.equal(rid, RID); assert.ok(keys.length >= 1 && keys.length <= 200, '저장은 200키 이하')
      if (saves++ === failSaveAt) return { ok: false, error: 'fail' }
      tick++
      for (const k of keys) states[k] = check(status, `t${tick}`, 'me')
      return { ok: true, states: structuredClone(states) }
    }
  }
}
/** 화면의 저장 흐름과 같게: 이전 states → save → 성공 응답으로 토큰 생성. */
async function saveAndToken(server, keys, status, scope = 1) {
  const before = structuredClone(server.states)
  const reply = await server.save(RID, keys, status)
  return u.createUndoToken({ requestId: RID, scope, status, keys, before, reply: reply.states })
}

test('상태 건수는 같은 기반 목록에서 집계해 합계가 일치하고, 준비 전에는 집계하지 않는다', () => {
  const recs = [{ s: 'claimed' }, { s: 'unclaimed' }, { s: 'unknown' }, { s: 'unclaimed' }]
  const c = u.claimCounts(recs, (r) => r.s, true)
  assert.deepEqual(c, { all: 4, unknown: 1, unclaimed: 2, claimed: 1 })
  assert.equal(c.unknown + c.unclaimed + c.claimed, c.all)
  assert.equal(u.claimCounts(recs, (r) => r.s, false), null)
})

test('혼합 이전 상태(미등록·미청구·완료)를 상태별 묶음으로 복원하고, 원래 같은 상태였던 키는 건드리지 않는다', async () => {
  const [a, b, c, d] = [key(1), key(2), key(3), key(4)]
  const server = fakeServer({ [b]: check('unclaimed'), [c]: check('claimed'), [d]: check('unknown') })
  // a: 미등록, b: 미청구, c: 이미 완료, d: 확인 필요(등록됨) → 모두 '청구 완료'로 표시
  const token = await saveAndToken(server, [a, b, c, d], 'claimed')
  assert.deepEqual(token.targets.map((t) => [t.key, t.prev]), [[a, 'unknown'], [b, 'unclaimed'], [d, 'unknown']])
  assert.deepEqual(u.undoGroups(token).map((g) => [g.status, g.keys]), [['unknown', [a, d]], ['unclaimed', [b]]])
  server.calls.length = 0
  const out = await u.runClaimUndo(token, { load: server.load, save: server.save, isCurrent: () => true })
  assert.equal(out.kind, 'done'); assert.equal(out.restored, 3)
  assert.equal(server.states[a].status, 'unknown'); assert.equal(server.states[b].status, 'unclaimed')
  assert.equal(server.states[c].status, 'claimed'); assert.equal(server.states[c].checked_at, 't1', '원래 같은 상태였던 키는 되돌리기 쓰기 대상이 아님')
  assert.deepEqual(server.calls.map((c) => c[0]), ['load', 'save', 'save'])
  assert.equal(out.states[b].status, 'unclaimed')
})

test('이미 모두 같은 상태였으면 되돌리기를 만들지 않는다', async () => {
  const server = fakeServer({ [key(1)]: check('claimed') })
  assert.equal(await saveAndToken(server, [key(1)], 'claimed'), null)
})

test('저장 실패 응답이면 토큰 생성 입력이 없어야 하고, 응답에 없는 키는 대상에서 빠진다', () => {
  const t = u.createUndoToken({ requestId: RID, scope: 1, status: 'claimed', keys: [key(1), key(2)], before: {}, reply: { [key(1)]: check('claimed', 't1') } })
  assert.deepEqual(t.targets.map((x) => x.key), [key(1)])
})

test('저장 후 다른 변경(상태·확인 시각·확인자)이 발견되면 복원 쓰기 없이 중단한다', async () => {
  for (const mutate of [(s, k) => { s[k] = check('unclaimed', 't1') }, (s, k) => { s[k] = { ...s[k], checked_at: 't9' } }, (s, k) => { s[k] = { ...s[k], checked_by: 'other' } }]) {
    const server = fakeServer({})
    const token = await saveAndToken(server, [key(1), key(2)], 'claimed')
    const next = structuredClone(server.states); mutate(next, key(2)); server.set(next)
    server.calls.length = 0
    const out = await u.runClaimUndo(token, { load: server.load, save: server.save, isCurrent: () => true })
    assert.equal(out.kind, 'conflict'); assert.equal(out.changed, 1)
    assert.deepEqual(server.calls.map((c) => c[0]), ['load'], '복원 쓰기 없음')
  }
})

test('직전 조회 실패 시 복원 쓰기 없이 중단한다', async () => {
  const server = fakeServer({})
  const token = await saveAndToken(server, [key(1)], 'claimed')
  const failing = fakeServer(server.states, { failLoad: true })
  const out = await u.runClaimUndo(token, { load: failing.load, save: failing.save, isCurrent: () => true })
  assert.equal(out.kind, 'load-failed')
  assert.deepEqual(failing.calls.map((c) => c[0]), ['load'])
})

test('부분 실패: 성공한 묶음은 유지하고 남은 묶음·재시도 없이 성공/미완료 건수를 돌려준다', async () => {
  const [a, b, c] = [key(1), key(2), key(3)]
  const server = fakeServer({ [b]: check('unclaimed'), [c]: check('unknown') })
  const token = await saveAndToken(server, [a, b, c], 'claimed')
  // 복원 묶음: unknown[a,c] → unclaimed[b]. 두 번째 복원 쓰기(전체 저장 기준 3번째)에서 실패.
  const flaky = fakeServer(server.states, { failSaveAt: 1 })
  const out = await u.runClaimUndo(token, { load: flaky.load, save: flaky.save, isCurrent: () => true })
  assert.deepEqual([out.kind, out.restored, out.remaining], ['partial', 2, 1])
  assert.deepEqual(flaky.calls.map((c) => [c[0], c[1]]), [['load', undefined], ['save', 'unknown'], ['save', 'unclaimed']], '실패 후 추가 쓰기·재시도·이전 묶음 재복원 없음')
  assert.equal(flaky.states[a].status, 'unknown'); assert.equal(flaky.states[b].status, 'claimed')
})

test('화면 범위가 바뀌면 남은 묶음 쓰기를 보내지 않는다(이미 보낸 쓰기는 취소로 가정하지 않음)', async () => {
  const [a, b] = [key(1), key(2)]
  const server = fakeServer({ [b]: check('unclaimed') })
  const token = await saveAndToken(server, [a, b], 'claimed')
  let current = true
  const deps = { load: server.load, isCurrent: () => current, save: async (...args) => { const r = await server.save(...args); current = false; return r } }
  server.calls.length = 0
  const out = await u.runClaimUndo(token, deps)
  assert.equal(out.kind, 'aborted'); assert.equal(out.restored, 1)
  assert.equal(server.calls.filter((c) => c[0] === 'save').length, 1, '전환 후 두 번째 묶음 미전송')
  // 조회 중 전환되어도 쓰기 없음
  const server2 = fakeServer({})
  const token2 = await saveAndToken(server2, [a], 'claimed')
  let cur2 = true
  server2.calls.length = 0
  const out2 = await u.runClaimUndo(token2, { load: async (r) => { const x = await server2.load(r); cur2 = false; return x }, save: server2.save, isCurrent: () => cur2 })
  assert.equal(out2.kind, 'aborted'); assert.deepEqual(server2.calls.map((c) => c[0]), ['load'])
})

test('200건 저장의 되돌리기 묶음도 각 200키 이하이며 최대 3묶음', async () => {
  const keys = Array.from({ length: 200 }, (_, i) => key(i + 1))
  const initial = {}
  keys.forEach((k, i) => { if (i % 3 === 1) initial[k] = check('unclaimed'); if (i % 3 === 2) initial[k] = check('unknown') })
  const server = fakeServer(initial)
  const token = await saveAndToken(server, keys, 'claimed')
  const groups = u.undoGroups(token)
  assert.ok(groups.length <= 3 && groups.every((g) => g.keys.length <= u.CLAIM_SAVE_LIMIT))
  assert.equal(groups.reduce((n, g) => n + g.keys.length, 0), 200)
  const out = await u.runClaimUndo(token, { load: server.load, save: server.save, isCurrent: () => true })
  assert.equal(out.kind, 'done')
  keys.forEach((k, i) => assert.equal(server.states[k].status, i % 3 === 1 ? 'unclaimed' : 'unknown'))
})
