import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-remote-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const rt = await load('src/shared/remoteTask.ts')
const poll = await load('src/shared/remoteTaskPoll.ts')

const BT = '```'
const directive = (over = {}) => {
  const h = { task: 'test-001', runner: 'PC-A', title: '샘플 작업', ...over }
  const fields = ['task', 'runner', 'title', 'branch'].filter((k) => h[k]).map((k) => `${k}: ${h[k]}`).join('\n')
  const body = over.body ?? "docs/REMOTE_TEST.md 파일을 만들어 'hello' 한 줄 작성."
  return `설명 텍스트\n\n${BT}sj-run\n${fields}\n---\n${body}\n${BT}\n꼬리말`
}
const ctx = (over = {}) => ({ commentAuthor: 'stormxm2-debug', allowedAuthors: ['stormxm2-debug'], runnerId: 'PC-A', repo: 'o/r', expectedRepo: 'o/r', ...over })

test('parseTaskDirective: 유효 블록을 파싱', () => {
  const d = rt.parseTaskDirective(directive())
  assert.equal(d.taskId, 'test-001')
  assert.equal(d.runnerId, 'PC-A')
  assert.equal(d.title, '샘플 작업')
  assert.match(d.body, /REMOTE_TEST\.md/)
})
test('parseTaskDirective: 블록 없으면 null', () => {
  assert.equal(rt.parseTaskDirective('그냥 일반 댓글입니다. 코드 실행해줘.'), null)
})
test('parseTaskDirective: task/runner 없으면 null', () => {
  const body = `${BT}sj-run\ntitle: x\n---\n본문\n${BT}`
  assert.equal(rt.parseTaskDirective(body), null)
})

test('validateDirective: 정상 통과', () => {
  assert.equal(rt.validateDirective(rt.parseTaskDirective(directive()), ctx()).ok, true)
})
test('validateDirective: 허용되지 않은 작성자 거부', () => {
  const v = rt.validateDirective(rt.parseTaskDirective(directive()), ctx({ commentAuthor: 'stranger' }))
  assert.equal(v.ok, false); assert.equal(v.code, 'author-not-allowed')
})
test('validateDirective: 다른 PC(runner) 대상은 거부', () => {
  const v = rt.validateDirective(rt.parseTaskDirective(directive({ runner: 'PC-B' })), ctx())
  assert.equal(v.ok, false); assert.equal(v.code, 'runner-mismatch')
})
test('validateDirective: repo 불일치 거부', () => {
  const v = rt.validateDirective(rt.parseTaskDirective(directive()), ctx({ repo: 'o/other' }))
  assert.equal(v.ok, false); assert.equal(v.code, 'repo-mismatch')
})
test('validateDirective: 잘못된 task id 거부', () => {
  const v = rt.validateDirective(rt.parseTaskDirective(directive({ task: 'bad id!' })), ctx())
  assert.equal(v.ok, false); assert.equal(v.code, 'bad-task-id')
})
test('validateDirective: 빈 본문 거부', () => {
  const v = rt.validateDirective(rt.parseTaskDirective(directive({ body: '' })), ctx())
  assert.equal(v.ok, false)
})

test('isAlreadyHandled: claimed/running/succeeded 는 중복, failed/rejected 는 재시도 허용', () => {
  let s = {}
  s = rt.withProcessed(s, { taskId: 't', status: 'claimed', updatedAt: 'x' })
  assert.equal(rt.isAlreadyHandled(s, 't'), true)
  s = rt.withProcessed(s, { taskId: 't', status: 'failed', updatedAt: 'x' })
  assert.equal(rt.isAlreadyHandled(s, 't'), false)
})

test('classifyGhError: 오프라인/로그인만료/기타 구분', () => {
  assert.equal(rt.classifyGhError('could not resolve host: api.github.com'), 'offline')
  assert.equal(rt.classifyGhError('error: Bad credentials (401)'), 'auth-expired')
  assert.equal(rt.classifyGhError('some other failure', 1), 'other')
})

test('redactForPublic: 토큰·주민번호 마스킹', () => {
  const r = rt.redactForPublic('token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 rrn 900101-1234567 end')
  assert.ok(!r.includes('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ'))
  assert.ok(!r.includes('900101-1234567'))
  assert.match(r, /\[REDACTED\]/)
})

test('buildResultComment: task·branch·PR 링크 포함, 비밀 없음', () => {
  const md = rt.buildResultComment({ taskId: 't1', runnerId: 'PC-A', branch: 'claude/remote-t1', prUrl: 'https://github.com/o/r/pull/9', checks: { typecheck: 'passed', build: 'passed', test: 'passed' }, changedFiles: ['docs/a.md'], ok: true })
  assert.match(md, /t1/); assert.match(md, /claude\/remote-t1/); assert.match(md, /pull\/9/)
})

// --- 오케스트레이터(pollOnce) ---------------------------------------------
function fakeDeps(over = {}) {
  const calls = { run: 0, pr: 0, push: 0, comment: 0, saves: 0 }
  const saved = []
  const deps = {
    now: () => '2026-11-06T00:00:00Z',
    saveState: (s) => { calls.saves++; saved.push(s) },
    listIssueComments: async () => ({ ok: true, comments: [{ author: 'stormxm2-debug', body: directive() }] }),
    runTaskOnBranch: async () => { calls.run++; return { ok: true, changedFiles: ['docs/REMOTE_TEST.md'], checks: { typecheck: 'passed', build: 'passed' } } },
    pushBranch: async () => { calls.push++; return { ok: true } },
    createReviewPr: async () => { calls.pr++; return { ok: true, url: 'https://github.com/o/r/pull/9' } },
    postComment: async () => { calls.comment++; return { ok: true } },
    ...over
  }
  return { deps, calls, saved }
}
const cfg = { enabled: true, repo: 'o/r', issueNumber: 76, allowedAuthors: ['stormxm2-debug'], runnerId: 'PC-A', pollSeconds: 60 }

test('pollOnce: 유효 신규 작업 → 실행·PR·완료', async () => {
  const { deps, calls } = fakeDeps()
  const out = await poll.pollOnce(cfg, {}, deps)
  assert.equal(calls.run, 1); assert.equal(calls.pr, 1); assert.equal(calls.comment, 1)
  assert.equal(out.state['test-001'].status, 'succeeded')
  assert.ok(out.actions.includes('done:test-001'))
})

test('pollOnce: 중복은 재실행하지 않음', async () => {
  const { deps, calls } = fakeDeps()
  const state = rt.withProcessed({}, { taskId: 'test-001', status: 'succeeded', updatedAt: 'x' })
  const out = await poll.pollOnce(cfg, state, deps)
  assert.equal(calls.run, 0); assert.equal(calls.pr, 0)
  assert.ok(out.actions.includes('skip-dup:test-001'))
})

test('pollOnce: 오프라인(list 실패)은 성공으로 처리하지 않음', async () => {
  const { deps, calls } = fakeDeps({ listIssueComments: async () => ({ ok: false, comments: [], errorKind: 'offline' }) })
  const out = await poll.pollOnce(cfg, {}, deps)
  assert.equal(calls.run, 0)
  assert.ok(out.actions.some((a) => a.startsWith('list-failed:offline')))
})

test('pollOnce: 허용되지 않은 작성자는 실행 안 함(거부 기록)', async () => {
  const { deps, calls } = fakeDeps({ listIssueComments: async () => ({ ok: true, comments: [{ author: 'stranger', body: directive() }] }) })
  const out = await poll.pollOnce(cfg, {}, deps)
  assert.equal(calls.run, 0)
  assert.equal(out.state['test-001'].status, 'rejected')
})

test('pollOnce: 작업 실행 실패는 fail 로 기록·완료 아님', async () => {
  const { deps, calls } = fakeDeps({ runTaskOnBranch: async () => ({ ok: false, changedFiles: [], checks: {}, reason: '미커밋 변경 있음' }) })
  const out = await poll.pollOnce(cfg, {}, deps)
  assert.equal(calls.pr, 0); assert.equal(calls.comment, 1) // 실패해도 결과 댓글은 남김, PR 은 없음
  assert.equal(out.state['test-001'].status, 'failed')
  assert.ok(out.actions.includes('fail:test-001'))
})
