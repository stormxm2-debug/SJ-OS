/**
 * 가입제안서 담보 → 플랜/그룹 분류 테스트.
 *
 * 담보명은 5개사 제안서에서 실제로 쓰는 표기를 옮긴 것이다. 분류가 틀어지면 FC가 엉뚱한
 * 플랜에서 담보를 찾게 되므로, 플랜뿐 아니라 그룹까지 고정한다.
 *
 * 실행: npm run test:plans
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

const SRC = 'src/renderer/src/services/commercial/coveragePlans.ts'

async function loadModule() {
  const result = await build({ entryPoints: [SRC], bundle: true, format: 'esm', write: false, platform: 'node' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-plans-'))
  const file = join(dir, 'coveragePlans.mjs')
  await writeFile(file, result.outputFiles[0].text, 'utf8')
  return import(file)
}

const plans = await loadModule()
const { classifyPlanGroup, groupsOfPlan, defaultOnKeys, normalizeCoverageName, PLANS } = plans

/** [담보명, 기대 플랜, 기대 그룹 키] */
const CASES = [
  // 실손 — 3대 비급여가 '비급여 입원·통원'보다 먼저 잡혀야 한다.
  ['급여 입원의료비', 'actual', 'actual-cov'],
  ['비급여 통원의료비(병원)', 'actual', 'actual-non'],
  ['비급여 도수치료·체외충격파치료·증식치료', 'actual', 'actual-3'],
  ['비급여 자기공명영상진단(MRI/MRA)', 'actual', 'actual-3'],
  ['비급여 주사료', 'actual', 'actual-3'],
  ['실손의료비보장(4세대)', 'actual', 'actual-base'],

  // 운전자 — 종합의 '치료비'·'진단비' 패턴에 먼저 걸리면 안 된다.
  ['자동차사고 교통사고처리지원금(중대법규위반)', 'driver', 'driver-accident'],
  ['변호사선임비용(자가용)', 'driver', 'driver-lawyer'],
  ['자동차사고 벌금(대인)', 'driver', 'driver-fine'],
  ['자동차사고부상치료비(1~14급)', 'driver', 'driver-injury'],
  ['면허정지위로금', 'driver', 'driver-license'],
  ['자동차보험료할증지원금', 'driver', 'driver-etc'],

  // 종합 — 진단비
  ['(무)암진단비(유사암제외)', 'comprehensive', 'comp-diagnosis'],
  ['뇌혈관질환진단비', 'comprehensive', 'comp-diagnosis'],
  ['급성심근경색증진단비', 'comprehensive', 'comp-diagnosis'],

  // 종합 — 수술·사망·후유장해
  ['질병수술비(1~5종)', 'comprehensive', 'comp-surgery'],
  ['상해후유장해(3~100%)', 'comprehensive', 'comp-death'],
  ['일반사망보험금', 'comprehensive', 'comp-death'],

  // 종합 — 소액 담보. 이름에 '진단비'가 들어가도 진단비 그룹이 아니다.
  ['골절진단비(치아파절제외)', 'comprehensive', 'comp-minor'],
  ['화상진단비', 'comprehensive', 'comp-minor'],
  ['깁스치료비', 'comprehensive', 'comp-minor'],
  ['응급실내원비(응급)', 'comprehensive', 'comp-minor']
]

test('담보명을 플랜과 그룹으로 분류한다', () => {
  for (const [name, wantPlan, wantGroup] of CASES) {
    const group = classifyPlanGroup(name, false)
    assert.ok(group, `${name}: 분류되지 않았습니다`)
    assert.equal(group.plan, wantPlan, `${name}: 플랜이 ${group.plan}`)
    assert.equal(group.key, wantGroup, `${name}: 그룹이 ${group.label}`)
  }
})

test('입원비 양식 항목을 찾은 담보는 다른 플랜으로 새지 않는다', () => {
  for (const name of ['질병입원일당', '상급종합병원 1인실 입원일당', '간병인사용일당']) {
    assert.equal(classifyPlanGroup(name, true), null, `${name}: 입원비플랜이어야 합니다`)
  }
})

test('담보명이 비어 있으면 분류하지 않는다', () => {
  for (const name of ['', '   ', '(무배당)']) {
    assert.equal(classifyPlanGroup(name, false), null)
  }
})

test('상품 형태 표기를 떼고 분류한다', () => {
  assert.equal(normalizeCoverageName('1. (무)암진단비 (해약환급금 미지급형, 일반심사형)'), '암진단비')
  const group = classifyPlanGroup('1. (무)암진단비 (해약환급금 미지급형, 일반심사형)', false)
  assert.equal(group?.key, 'comp-diagnosis')
})

test('종합 기본 셋팅은 진단비·수술·사망·골절 네 그룹이고 기타는 꺼져 있다', () => {
  const on = defaultOnKeys('comprehensive').slice().sort()
  assert.deepEqual(on, ['comp-death', 'comp-diagnosis', 'comp-minor', 'comp-surgery'])
  const etc = groupsOfPlan('comprehensive').find((g) => g.key === 'comp-etc')
  assert.equal(etc?.defaultOn, false)
})

test('입원비플랜은 그룹을 쓰지 않는다(기존 양식 항목 분류를 그대로 쓴다)', () => {
  assert.deepEqual(groupsOfPlan('hospital'), [])
  assert.equal(PLANS.length, 4)
})
