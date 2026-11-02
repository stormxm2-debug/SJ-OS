/**
 * SJ CLAIM FINDER — UI 상태 위생 테스트.
 * 리뷰 반영: 고객 변경 / 동의 철회 / DEMO 토글 시 이전 고객 결과·검토메모가 남지 않음을 고정.
 * 실행: node --test test/claimUiState.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

async function load(src) {
  const r = await build({ entryPoints: [src], bundle: true, format: 'esm', write: false, platform: 'node' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-ui-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, r.outputFiles[0].text, 'utf8')
  return import(file)
}

const { claimUiReducer, INITIAL_UI_STATE } = await load('src/renderer/src/services/claim-finder/uiState.ts')

const fakeResult = (tag) => ({ candidates: [{ id: 'c1' }], warnings: [], rulesVersion: 'v0.2', generatedAt: '2026-11-02', tag })

test('고객 변경 → 이전 결과·검토메모·동의·DEMO 전부 초기화', () => {
  let s = { ...INITIAL_UI_STATE, customerId: 'A', consent: true }
  s = claimUiReducer(s, { type: 'ANALYZE_DONE', result: fakeResult('A') })
  s = claimUiReducer(s, { type: 'SET_REVIEW', id: 'c1', patch: { note: 'A고객 메모' } })
  assert.equal(s.result.tag, 'A')
  assert.equal(s.review.c1.note, 'A고객 메모')

  // 다른 고객 선택
  s = claimUiReducer(s, { type: 'SELECT_CUSTOMER', customerId: 'B' })
  assert.equal(s.customerId, 'B')
  assert.equal(s.result, null, '이전 고객 결과가 남으면 안 됨')
  assert.deepEqual(s.review, {}, '이전 고객 검토메모가 남으면 안 됨')
  assert.equal(s.consent, false, '동의는 고객별로 다시 받아야 함')
  assert.equal(s.isDemo, false)
})

test('같은 고객 재선택 → 상태 유지(불필요 초기화 없음)', () => {
  let s = { ...INITIAL_UI_STATE, customerId: 'A', consent: true }
  s = claimUiReducer(s, { type: 'ANALYZE_DONE', result: fakeResult('A') })
  const before = s
  s = claimUiReducer(s, { type: 'SELECT_CUSTOMER', customerId: 'A' })
  assert.equal(s, before, '동일 고객 재선택은 상태를 바꾸지 않음')
})

test('동의 철회 → 결과·검토메모 즉시 제거', () => {
  let s = { ...INITIAL_UI_STATE, customerId: 'A', consent: true }
  s = claimUiReducer(s, { type: 'ANALYZE_DONE', result: fakeResult('A') })
  s = claimUiReducer(s, { type: 'SET_REVIEW', id: 'c1', patch: { note: '메모' } })
  s = claimUiReducer(s, { type: 'SET_CONSENT', consent: false })
  assert.equal(s.consent, false)
  assert.equal(s.result, null, '동의 철회 시 결과가 남으면 안 됨')
  assert.deepEqual(s.review, {}, '동의 철회 시 검토메모가 남으면 안 됨')
})

test('동의 재확인(on) → 기존 상태 보존, 결과는 자동 복구 안 함', () => {
  let s = { ...INITIAL_UI_STATE, customerId: 'A' }
  s = claimUiReducer(s, { type: 'SET_CONSENT', consent: true })
  assert.equal(s.consent, true)
  assert.equal(s.result, null)
})

test('DEMO → 실분석 전환 시 DEMO 결과·메모가 섞이지 않음', () => {
  let s = { ...INITIAL_UI_STATE, customerId: 'A', consent: true }
  s = claimUiReducer(s, { type: 'DEMO_DONE', result: fakeResult('demo') })
  s = claimUiReducer(s, { type: 'SET_REVIEW', id: 'c1', patch: { note: 'demo메모' } })
  assert.equal(s.isDemo, true)
  s = claimUiReducer(s, { type: 'ANALYZE_DONE', result: fakeResult('real') })
  assert.equal(s.isDemo, false)
  assert.equal(s.result.tag, 'real')
  assert.deepEqual(s.review, {}, '실분석 결과에 DEMO 검토메모가 남으면 안 됨')
})

test('실분석 → DEMO 전환 시에도 메모 초기화 + DEMO 표시', () => {
  let s = { ...INITIAL_UI_STATE, customerId: 'A', consent: true }
  s = claimUiReducer(s, { type: 'ANALYZE_DONE', result: fakeResult('real') })
  s = claimUiReducer(s, { type: 'SET_REVIEW', id: 'c1', patch: { note: 'real메모' } })
  s = claimUiReducer(s, { type: 'DEMO_DONE', result: fakeResult('demo') })
  assert.equal(s.isDemo, true)
  assert.deepEqual(s.review, {})
})

test('검토 메모 병합(여러 후보 독립)', () => {
  let s = { ...INITIAL_UI_STATE }
  s = claimUiReducer(s, { type: 'SET_REVIEW', id: 'c1', patch: { status: 'EXCLUDED' } })
  s = claimUiReducer(s, { type: 'SET_REVIEW', id: 'c1', patch: { note: 'n1' } })
  s = claimUiReducer(s, { type: 'SET_REVIEW', id: 'c2', patch: { note: 'n2' } })
  assert.equal(s.review.c1.status, 'EXCLUDED')
  assert.equal(s.review.c1.note, 'n1')
  assert.equal(s.review.c2.note, 'n2')
})
