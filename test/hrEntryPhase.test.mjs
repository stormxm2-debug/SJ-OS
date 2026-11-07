/**
 * 건강기록 입력 화면 상태 파생(deriveEntryPhase) 회귀 테스트 — 합성 상태만 사용.
 * 핵심: 완료 결과를 열어 둔 상태에서 새 링크/인증 작업이 결과 표시('done')에 가려지지 않는다.
 * 실행: node --test test/hrEntryPhase.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function load(src) {
  const r = await build({ entryPoints: [src], bundle: true, format: 'esm', write: false, platform: 'node' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-hrphase-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, r.outputFiles[0].text, 'utf8')
  return import(pathToFileURL(file).href)
}

const { deriveEntryPhase } = await load('src/renderer/src/services/health-record/entryPhase.ts')

const base = { inputMode: 'customer', hasResult: false, busy: false, hasTwoWay: false, inviteBusy: false, hasInvite: false, hasError: false }
const ph = (o) => deriveEntryPhase({ ...base, ...o })

test('완료 결과 열기 → 결과 보기(done)', () => {
  assert.equal(ph({ hasResult: true }), 'done')
  assert.equal(ph({ inputMode: 'staff', hasResult: true }), 'done')
})

test('완료 결과 열기 → 링크 재발급 진행/성공/실패가 결과 표시에 가려지지 않음', () => {
  // 핸들러가 결과를 비우기 전 같은 렌더에 결과가 남아 있더라도 새 작업 상태가 우선해야 한다.
  assert.equal(ph({ hasResult: true, inviteBusy: true }), 'requesting')
  assert.equal(ph({ hasResult: true, hasInvite: true }), 'link_sent')
  assert.equal(ph({ hasResult: true, hasError: true }), 'failed')
  // onInvite는 결과를 비운다 → 성공: link_sent, 실패: failed
  assert.equal(ph({ hasInvite: true }), 'link_sent')
  assert.equal(ph({ hasError: true }), 'failed')
})

test('고객 링크: 기본/생성 중/발급/실패', () => {
  assert.equal(ph({}), 'idle')
  assert.equal(ph({ inviteBusy: true }), 'requesting')
  assert.equal(ph({ hasInvite: true }), 'link_sent')
  assert.equal(ph({ hasError: true }), 'failed')
})

test('직원 직접 입력: 요청 → 승인 대기 → 결과 조회 → 완료 / 재요청 / 실패', () => {
  const s = { inputMode: 'staff' }
  assert.equal(ph({ ...s }), 'idle')
  assert.equal(ph({ ...s, busy: true }), 'requesting')
  assert.equal(ph({ ...s, hasTwoWay: true }), 'awaiting')
  assert.equal(ph({ ...s, busy: true, hasTwoWay: true }), 'fetching')
  assert.equal(ph({ ...s, hasResult: true }), 'done')
  // 승인 전 조회 실패(세션 유지) → failed
  assert.equal(ph({ ...s, hasTwoWay: true, hasError: true }), 'failed')
  // 결과 열람 상태에서 재요청 진행 중 → requesting (onStart가 결과를 비움)
  assert.equal(ph({ ...s, hasResult: true, busy: true }), 'requesting')
  assert.equal(ph({ ...s, hasResult: true, hasTwoWay: true }), 'awaiting')
})

test('방식 전환: 직원 모드에서는 고객 링크 상태를 보지 않고, 반대도 같다', () => {
  assert.equal(ph({ inputMode: 'staff', hasInvite: true, inviteBusy: true }), 'idle')
  assert.equal(ph({ inputMode: 'customer', hasTwoWay: true, busy: true }), 'idle')
})
