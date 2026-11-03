/**
 * SJ CLAIM FINDER — 복원(restore) 테스트: 저장 run → AnalyzeResult 복원·검증, 검토 최신값.
 * 실행: node --test test/claimRestore.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

async function load(src) {
  const r = await build({ entryPoints: [src], bundle: true, format: 'esm', write: false, platform: 'node' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-rst-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, r.outputFiles[0].text, 'utf8')
  return import(file)
}

const { validateSavedRun, reviewsToLatestMap } = await load('src/renderer/src/services/claim-finder/restore.ts')

const cand = (id, status) => ({ id, status, coverageName: 'x', insurer: 'y', category: 'diagnosis', estimatedAmount: null, amountBasis: null, reasons: [], missingDocs: [], sources: [], treatmentEventIds: [], rulesVersion: 'v0.2' })

test('정상 run 복원 → AnalyzeResult + 저장 시점 generatedAt', () => {
  const run = { result: [cand('c1', 'POTENTIAL'), cand('c2', 'NEED_DOCUMENTS')], warnings: ['w1'], rulesVersion: 'v0.2.0-demo', createdAt: '2026-11-03T00:00:00Z', isDemo: true }
  const v = validateSavedRun(run, 'v0.2.0-demo')
  assert.equal(v.ok, true)
  assert.equal(v.result.candidates.length, 2)
  assert.equal(v.result.generatedAt, '2026-11-03T00:00:00Z')
  assert.deepEqual(v.result.warnings, ['w1'])
  assert.equal(v.warnings.length, 0)
})

test('result 가 배열이 아니면 오류(손상)', () => {
  const v = validateSavedRun({ result: { nope: 1 }, rulesVersion: 'v0.2', createdAt: 't', isDemo: false }, 'v0.2')
  assert.equal(v.ok, false)
  assert.ok(v.errors[0].includes('후보 배열이 아닙니다'))
})

test('후보 shape 오류(알 수 없는 status/ id 누락) → 복원 중단', () => {
  const v1 = validateSavedRun({ result: [{ id: 'c1', status: 'WAT' }], rulesVersion: 'v0.2', createdAt: 't', isDemo: false }, 'v0.2')
  assert.equal(v1.ok, false)
  const v2 = validateSavedRun({ result: [{ status: 'POTENTIAL' }], rulesVersion: 'v0.2', createdAt: 't', isDemo: false }, 'v0.2')
  assert.equal(v2.ok, false)
})

test('규칙버전 불일치 → warning(복원은 성공, 재분석 안내)', () => {
  const v = validateSavedRun({ result: [cand('c1', 'POTENTIAL')], rulesVersion: 'v0.1', createdAt: 't', isDemo: false }, 'v0.2')
  assert.equal(v.ok, true)
  assert.ok(v.warnings.some((w) => w.includes('규칙')))
})

test('검토 최신값 복원: 후보별 created_at 최신 1건', () => {
  const rows = [
    { candidate_id: 'c1', status_override: 'NEED_DOCUMENTS', note: 'old', created_at: '2026-11-01T00:00:00Z' },
    { candidate_id: 'c1', status_override: 'EXCLUDED', note: 'new', created_at: '2026-11-03T00:00:00Z' },
    { candidate_id: 'c2', status_override: null, note: 'memo2', created_at: '2026-11-02T00:00:00Z' }
  ]
  const map = reviewsToLatestMap(rows)
  assert.equal(map.c1.status, 'EXCLUDED')
  assert.equal(map.c1.note, 'new') // 최신
  assert.equal(map.c2.status, undefined) // 알 수 없는/없음 → undefined
  assert.equal(map.c2.note, 'memo2')
})

test('검토 빈/형식오류 입력 → 빈 맵(크래시 없음)', () => {
  assert.deepEqual(reviewsToLatestMap([]), {})
  assert.deepEqual(reviewsToLatestMap([{ note: 'x' }]), {}) // candidate_id 없음 → 제외
})
