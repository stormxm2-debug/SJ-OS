import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-sonson-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const { estimateInsurancePayout, DEFAULT_GEN_RULES } = await load('src/renderer/src/services/health-record/insuranceEstimate.ts')
const rule = (g) => DEFAULT_GEN_RULES[g]

test('기본 규칙에 1~4세대가 모두 있다', () => {
  assert.deepEqual(Object.keys(DEFAULT_GEN_RULES).sort(), ['1', '2', '3', '4'])
})

test('4세대 입원: 급여 20%·비급여 30% 자기부담, 정액공제 없음', () => {
  const r = estimateInsurancePayout({ generation: '4', careType: 'in', coveredMedical: 1_000_000, uncoveredMedical: 500_000 }, rule('4'))
  assert.equal(r.coveredBenefit, 800_000)
  assert.equal(r.uncoveredBenefit, 350_000)
  assert.equal(r.outpatientExtraDeduction, 0)
  assert.equal(r.estimatedPayout, 1_150_000)
})

test('4세대 통원: 자기부담률 공제가 정액공제보다 크면 추가 차감 없음', () => {
  const r = estimateInsurancePayout({ generation: '4', careType: 'out', coveredMedical: 1_000_000, uncoveredMedical: 500_000 }, rule('4'))
  assert.equal(r.rateCopay, 350_000)
  assert.equal(r.outpatientExtraDeduction, 0)
  assert.equal(r.estimatedPayout, 1_150_000)
})

test('소액 통원: 정액공제가 더 크면 그 차액만 추가 차감', () => {
  // 급여 30,000 × 20% = 6,000 자기부담, benefit 24,000. 통원공제 20,000 > 6,000 → 추가 14,000 차감.
  const r = estimateInsurancePayout({ generation: '4', careType: 'out', coveredMedical: 30_000, uncoveredMedical: 0 }, rule('4'))
  assert.equal(r.rateCopay, 6_000)
  assert.equal(r.outpatientExtraDeduction, 14_000)
  assert.equal(r.estimatedPayout, 10_000)
})

test('1세대: 자기부담 0 → 거의 전액', () => {
  const r = estimateInsurancePayout({ generation: '1', careType: 'out', coveredMedical: 100_000, uncoveredMedical: 100_000 }, rule('1'))
  assert.equal(r.estimatedPayout, 200_000)
})

test('연 한도 초과분은 잘린다', () => {
  const r = estimateInsurancePayout({ generation: '4', careType: 'in', coveredMedical: 0, uncoveredMedical: 100_000_000 }, rule('4'))
  // benefit = 70,000,000, 한도 50,000,000 → 지급 50,000,000, 초과 20,000,000.
  assert.equal(r.estimatedPayout, 50_000_000)
  assert.equal(r.limitCut, 20_000_000)
})

test('음수/0 입력은 0으로 처리', () => {
  const r = estimateInsurancePayout({ generation: '2', careType: 'out', coveredMedical: -500, uncoveredMedical: 0 }, rule('2'))
  assert.equal(r.estimatedPayout, 0)
})

test('공제가 보험금 총액을 넘지 않는다(음수 지급 없음)', () => {
  // 통원공제 10,000인데 benefit이 아주 작은 경우
  const r = estimateInsurancePayout({ generation: '2', careType: 'out', coveredMedical: 5_000, uncoveredMedical: 0 }, rule('2'))
  assert.ok(r.estimatedPayout >= 0)
})
