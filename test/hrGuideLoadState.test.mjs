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

const { guideLoadStatus, aiGuideNote } = await load('src/renderer/src/services/health-record/guideLoadState.ts')
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

// AI 반영 기준 안내 — 실제 askHealthRecordAi와 같이 검수된 기준만 센다(합성 기준).
const ctx = (guides, exceptions, insurers = ['삼성화재']) => ({ insurers, guides: guides.map(v => ({ verified: v })), exceptions: exceptions.map(v => ({ verified: v })) })

test('검수 전 인수 1 + 검수 예외 1 → AI 반영 1건(인수 0 · 예외 1), 검수 전 1건 제외 명시', () => {
  const n = aiGuideNote('ok', ctx([false], [true]))
  assert.deepEqual([n.verifiedGuides, n.verifiedExceptions, n.excluded], [0, 1, 1])
  assert.match(n.text, /AI 반영 기준 1건\(검수됨 · 인수 0 · 예외 1\)/)
  assert.match(n.text, /검수 전 1건은 AI 반영에서 제외/)
  assert.doesNotMatch(n.text, /2건/)
})

test('매칭은 있지만 전부 검수 전 → AI 반영 기준 0건 · 건강기록만 요약', () => {
  const n = aiGuideNote('ok', ctx([false, false], [false]))
  assert.equal(n.verifiedGuides + n.verifiedExceptions, 0)
  assert.match(n.text, /AI 반영 기준 0건 · 건강기록만 요약/)
  assert.match(n.text, /검수 전 3건은 AI 반영에서 제외/)
})

test('부분 실패 — 성공 소스 중 검수된 기준만 반영한다고 표시(경고)', () => {
  const n = aiGuideNote('partial', ctx([true, false], []))
  assert.equal(n.warn, true)
  assert.match(n.text, /일부 기준 조회 실패 — 성공한 자료 중 검수된 기준만 반영: AI 반영 기준 1건\(검수됨 · 인수 1 · 예외 0\)/)
  assert.match(n.text, /검수 전 1건은 AI 반영에서 제외/)
  assert.match(aiGuideNote('partial', ctx([false], [])).text, /AI 반영 기준 0건 · 건강기록만 요약/)
})

test('미매칭·미조회·실패·선택 0·조회 중은 기존 안내 유지', () => {
  assert.match(aiGuideNote('ok', ctx([], [])).text, /미매칭/)
  assert.match(aiGuideNote('idle', ctx([], [])).text, /기준 미확인/)
  assert.equal(aiGuideNote('failed', ctx([], [])).warn, true)
  assert.match(aiGuideNote('ok', ctx([true], [], [])).text, /선택한 보험사가 없어/)
  assert.match(aiGuideNote('loading', ctx([true], [true])).text, /조회 중/)
})
