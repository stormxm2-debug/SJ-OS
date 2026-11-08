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
