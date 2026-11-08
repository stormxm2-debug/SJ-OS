import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

async function load(src) {
  const output = await build({ entryPoints:[src], bundle:true, format:'esm', platform:'node', write:false, tsconfig:'tsconfig.web.json', logLevel:'silent' })
  const dir = await mkdtemp(join(tmpdir(),'sj-hr-status-')), file = join(dir,'module.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(pathToFileURL(file).href)
}
const v = await load('src/renderer/src/services/health-record/healthStatusView.ts')

test('timeout/network → 응답 확인 필요, 최근 요청 우선', () => {
  for (const code of ['HEALTH_TIMEOUT','HEALTH_NETWORK']) {
    const e = v.classifyHealthError('아무 메시지', code)
    assert.equal(e.kind,'uncertain'); assert.equal(e.title,'응답 확인 필요'); assert.equal(e.checkHistoryFirst,true)
    assert.match(e.action,/최근 요청/)
  }
  assert.equal(v.classifyHealthError('서버에 연결할 수 없습니다.').kind,'uncertain')
})
test('분류별 행동 · 구현설명/미검증 운영시간 없음', () => {
  const cases = [['서비스 이용 시간이 아닙니다','hours'],['외국인 성명 불일치','name'],['주민등록번호 오류','identity'],['x','session','CF-00025'],['알 수 없는 오류','general']]
  for (const [m,k,c] of cases) {
    const e = v.classifyHealthError(m,c)
    assert.equal(e.kind,k)
    assert.doesNotMatch(e.title+e.action,/identity|암호화|엣지|9시/)
  }
  assert.equal(v.classifyHealthError('x','CF-00025').checkHistoryFirst,true)
  assert.equal(v.classifyHealthError('알 수 없는 오류').checkHistoryFirst,false)
})
test('행 다음 행동 · 30일 경계 · 결과없음 구분', () => {
  const A = (status, extra={}) => ({ status, result:null, error:null, ...extra })
  assert.match(v.historyRowAction(A('awaiting_customer'),0,30).text,/링크/)
  assert.match(v.historyRowAction(A('awaiting_auth'),0,30).text,/승인 대기/)
  assert.match(v.historyRowAction(A('fetching'),0,30).text,/진행/)
  assert.match(v.historyRowAction(A('consented'),0,30).text,/진행/)
  const ok = v.historyRowAction(A('completed',{result:{a:1}}),30,30)
  assert.equal(ok.canOpen,true); assert.match(ok.text,/0일 남음/)
  const exp = v.historyRowAction(A('completed',{result:{a:1}}),31,30)
  assert.equal(exp.canOpen,false); assert.match(exp.text,/열람 불가/)
  const none = v.historyRowAction(A('completed'),3,30)
  assert.equal(none.canOpen,false); assert.match(none.text,/자료 확인 필요/); assert.doesNotMatch(none.text,/보관/)
  const f = v.historyRowAction(A('failed',{error:'응답 시간이 초과'}),0,30)
  assert.equal(f.tone,'error'); assert.match(f.text,/최근 요청/)
})
test('로딩 가드: 늦은 이전 응답 무시 · 실패 시 목록 유지 · 마지막 성공 시각', () => {
  let s = v.initialHistoryLoad
  s = v.historyLoadStart(s,1) // 검색 A
  s = v.historyLoadStart(s,2) // 검색 B
  let d = v.historyLoadDone(s,2,true,'B',1000); assert.equal(d.apply,true); s = d.next
  assert.equal(s.shownQuery,'B'); assert.equal(s.loading,false); assert.equal(s.lastOkAt,1000)
  d = v.historyLoadDone(s,1,true,'A',2000); assert.equal(d.apply,false); assert.deepEqual(d.next,s) // A 늦게 도착 → 무시
  s = v.historyLoadStart(s,3)
  d = v.historyLoadDone(s,3,false,'B',3000); assert.equal(d.apply,false); s = d.next
  assert.equal(s.failed,true); assert.equal(s.loading,false); assert.equal(s.lastOkAt,1000); assert.equal(s.shownQuery,'B')
  s = v.historyLoadStart(s,4); s = v.historyLoadStart(s,5)
  d = v.historyLoadDone(s,4,false,'B',4000); assert.equal(d.next.loading,true) // 이전 실패가 최신 로딩을 뒤집지 않음
})

// ── 보완: 새로고침 coalesce · 오류 code 원자화 · 보관일수 NaN ──
function deferred() { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b }); return { p, resolve, reject } }
function harness() {
  const calls = [], applied = [], published = []
  let query = '', clock = 0
  const r = v.createHistoryRefresher({
    load: (q) => { const d = deferred(); calls.push({ q, d }); return d.p },
    query: () => query, now: () => clock,
    publish: (s) => published.push(s), apply: (items) => applied.push(items)
  })
  return { r, calls, applied, published, setQuery: (q) => { query = q }, setClock: (t) => { clock = t } }
}
const flush = () => new Promise((res) => setImmediate(res))

test('동일 query 10초 폴링 + 11초 응답: 요청 공유 · 응답 수용 · 로딩 해제', async () => {
  const h = harness()
  const p0 = h.r.refresh()             // t=0 첫 요청
  h.setClock(10_000); const p1 = h.r.refresh() // t=10s 폴링(같은 query) → 진행 중 요청 공유
  assert.equal(h.calls.length, 1); assert.equal(p0, p1)
  assert.equal(h.r.state().loading, true)
  h.setClock(11_000); h.calls[0].d.resolve({ ok: true, items: ['x'] }); await p0
  assert.deepEqual(h.applied, [['x']])
  assert.equal(h.r.state().loading, false); assert.equal(h.r.state().lastOkAt, 11_000)
  h.r.refresh(); assert.equal(h.calls.length, 2) // 끝난 뒤 다음 폴링은 새 요청
})
test('61초 시뮬: 매 응답 11초 · 10초 폴링에도 응답 폐기되지 않음', async () => {
  const h = harness()
  const pending = [] // [resolveAt, call]
  for (let t = 0; t <= 61_000; t += 1_000) {
    h.setClock(t)
    for (const e of pending.filter((e) => e.at === t)) { e.c.d.resolve({ ok: true, items: [t] }); await flush() }
    if (t % 10_000 === 0) { const n = h.calls.length; h.r.refresh(); if (h.calls.length > n) pending.push({ at: t + 11_000, c: h.calls.at(-1) }) }
  }
  await flush()
  assert.ok(h.applied.length >= 2, `applied=${h.applied.length}`)
  assert.equal(h.applied.length, pending.filter((e) => e.at <= 61_000).length) // 도착한 응답은 모두 수용
  assert.ok(h.r.state().lastOkAt !== null)
})
test('A→B→A: 최신 query 응답만 반영 · 이전 finally 가 현재 요청을 지우지 않음', async () => {
  const h = harness()
  h.setQuery('A'); const pa1 = h.r.refresh()
  h.setQuery('B'); h.r.refresh()      // 검색어 변경 → 즉시 새 요청
  h.setQuery('A'); const pa3 = h.r.refresh() // 다시 A → A1 과 공유하지 않고 새 요청(현재 active 는 B였음)
  assert.deepEqual(h.calls.map((c) => c.q), ['A', 'B', 'A'])
  h.calls[0].d.resolve({ ok: true, items: ['A-old'] }); await pa1 // 늦은 A1: 무시, active(A3) 유지
  assert.deepEqual(h.applied, []); assert.equal(h.r.state().loading, true)
  const again = h.r.refresh(); assert.equal(again, pa3); assert.equal(h.calls.length, 3) // A3 와 공유
  h.calls[1].d.resolve({ ok: true, items: ['B'] }); await flush() // 늦은 B: 무시
  assert.deepEqual(h.applied, [])
  h.calls[2].d.resolve({ ok: true, items: ['A-new'] }); await pa3
  assert.deepEqual(h.applied, [['A-new']]); assert.equal(h.r.state().shownQuery, 'A'); assert.equal(h.r.state().loading, false)
})
test('실패/예외 후 정리 · 재시도는 새 요청', async () => {
  const h = harness()
  const p = h.r.refresh(); h.calls[0].d.reject(new Error('net')); await p
  assert.equal(h.r.state().failed, true); assert.equal(h.r.state().loading, false); assert.deepEqual(h.applied, [])
  const p2 = h.r.refresh(); assert.equal(h.calls.length, 2)
  h.calls[1].d.resolve({ ok: false, items: [] }); await p2
  assert.equal(h.r.state().failed, true); assert.deepEqual(h.applied, []) // 실패 응답은 목록 유지
  const p3 = h.r.refresh(); h.calls[2].d.resolve({ ok: true, items: ['ok'] }); await p3
  assert.equal(h.r.state().failed, false); assert.deepEqual(h.applied, [['ok']])
  // load 가 동기 예외를 던져도 정리되어 다음 요청 가능
  let n = 0
  const r2 = v.createHistoryRefresher({ load: () => { n++; throw new Error('sync') }, query: () => '', now: () => 1, publish: () => {}, apply: () => {} })
  await r2.refresh(); await r2.refresh(); assert.equal(n, 2); assert.equal(r2.state().failed, true)
})
test('연속 오류: 새 오류는 이전 code 를 남기지 않음', () => {
  let s = v.healthUiError('응답 지연', 'HEALTH_TIMEOUT')
  assert.equal(v.classifyHealthError(s.message, s.code).kind, 'uncertain')
  s = v.healthUiError('알 수 없는 오류') // 같은 배치의 다음 오류(코드 없음)
  assert.equal(s.code, ''); assert.equal(v.classifyHealthError(s.message, s.code).kind, 'general')
  s = v.healthUiError('x', 'CF-00025'); assert.equal(v.classifyHealthError(s.message, s.code).kind, 'session')
  s = v.healthUiError('고객 성함을 확인해주세요'); assert.equal(v.classifyHealthError(s.message, s.code).checkHistoryFirst, false)
  assert.equal(v.healthUiError(null), null) // 새 작업/고객/상품/결과 열기 → 메시지·code 함께 초기화
})
test('보관일수: NaN 은 확인 필요(열람 불가, 만료 단정 안 함) · 30일 포함 · 31일 초과', () => {
  const done = { status: 'completed', result: { a: 1 }, error: null }
  const nan = v.historyRowAction(done, NaN, 30)
  assert.equal(nan.canOpen, false); assert.match(nan.text, /확인 필요/); assert.doesNotMatch(nan.text, /NaN|경과|남음/)
  assert.equal(v.historyRowAction(done, 30, 30).canOpen, true)
  assert.equal(v.historyRowAction(done, 31, 30).canOpen, false)
  assert.equal(v.historyRowAction(done, 0, 30).canOpen, true)
})
