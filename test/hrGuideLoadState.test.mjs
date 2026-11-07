/**
 * 가입 검토 기준 조회 상태(guideLoadStatus) 회귀 테스트 — 합성 상태만 사용.
 * 핵심: 두 소스 성공(0건 포함)·부분 실패·전체 실패를 구분하고, 재조회 중에는 이전 성공을 표시하지 않는다.
 * 실행: node --test test/hrGuideLoadState.test.mjs
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
  const dir = await mkdtemp(join(tmpdir(), 'sj-hrguide-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, r.outputFiles[0].text, 'utf8')
  return import(pathToFileURL(file).href)
}

const { guideLoadStatus } = await load('src/renderer/src/services/health-record/guideLoadState.ts')
const st = (busy, underwritingOk, exceptionOk) => guideLoadStatus({ busy, underwritingOk, exceptionOk })

test('미조회는 idle — 성공·0건으로 보이지 않음', () => {
  assert.equal(st(false, null, null), 'idle')
})

test('두 소스 성공은 ok (일치 건수와 무관)', () => {
  assert.equal(st(false, true, true), 'ok')
})

test('한 소스만 실패하면 partial — 성공 소스가 있어도 ok로 숨기지 않음', () => {
  assert.equal(st(false, true, false), 'partial')
  assert.equal(st(false, false, true), 'partial')
})

test('두 소스 실패·예외(catch)는 failed', () => {
  assert.equal(st(false, false, false), 'failed')
})

test('재조회 중에는 이전 결과와 무관하게 loading 우선', () => {
  assert.equal(st(true, true, true), 'loading')
  assert.equal(st(true, false, true), 'loading')
  assert.equal(st(true, null, null), 'loading')
})
