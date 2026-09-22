/**
 * 조합 설계안(담보별 최저가 쪼개기) 테스트.
 *
 * 돈이 걸린 계산이라 규칙을 여기에 고정한다.
 * - 비교 기준은 가입금액 1,000만원당 월 보험료(단가)
 * - 가입금액을 못 읽으면 보험료로만 비교하고 '확인 필요'
 * - 보장 범위가 다른 담보(뇌혈관 vs 뇌졸중)는 섞어 비교하지 않는다
 *
 * 실행: node --test test/coverageMix.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

async function load(src) {
  const result = await build({ entryPoints: [src], bundle: true, format: 'esm', write: false, platform: 'node' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-mix-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, result.outputFiles[0].text, 'utf8')
  return import(file)
}

const { buildMix, mixKeyOf, familyOf, unitBasis, unitPriceAt, rankOffers, parseAmountManwon, parsePremiumWon } = await load(
  'src/renderer/src/services/commercial/coverageMix.ts'
)

const item = (company, coverageName, amount, premium) => ({
  company,
  coverageName,
  amount,
  premium,
  plan: 'comprehensive',
  groupKey: 'comp-diagnosis'
})

test('가입금액을 만원 단위로 읽는다', () => {
  assert.equal(parseAmountManwon('3,000만원'), 3000)
  assert.equal(parseAmountManwon('5000만원'), 5000)
  assert.equal(parseAmountManwon('1억원'), 10000)
  assert.equal(parseAmountManwon('1억5,000만원'), 15000)
  assert.equal(parseAmountManwon('30,000,000원'), 3000)
  assert.equal(parseAmountManwon('확인필요'), null)
  assert.equal(parseAmountManwon(''), null)
})

test('보험료를 원 단위로 읽는다', () => {
  assert.equal(parsePremiumWon('12,340원'), 12340)
  assert.equal(parsePremiumWon('8,900'), 8900)
  assert.equal(parsePremiumWon('-'), null)
})

test('보장 범위가 다른 담보는 섞어 비교하지 않는다', () => {
  const keys = ['뇌혈관질환진단비', '뇌졸중진단비', '뇌출혈진단비', '허혈성심장질환진단비', '급성심근경색진단비'].map(
    (n) => mixKeyOf(n).key
  )
  assert.equal(new Set(keys).size, keys.length, '서로 다른 키여야 합니다')
})

test('회사마다 다른 표기의 같은 담보는 한 줄로 모은다', () => {
  assert.equal(mixKeyOf('(무)암진단비(유사암제외)').key, mixKeyOf('일반암진단비').key)
  assert.notEqual(mixKeyOf('암진단비').key, mixKeyOf('유사암진단비').key)
})

test('가입금액이 같으면 보험료가 싼 회사를 고른다', () => {
  const mix = buildMix([
    item('A생명', '암진단비', '3,000만원', '18,000원'),
    item('B화재', '암진단비', '3,000만원', '15,000원')
  ])
  assert.equal(mix.rows.length, 1)
  assert.equal(mix.rows[0].best.company, 'B화재')
  assert.equal(mix.mixPremium, 15000)
  assert.equal(mix.rows[0].needsReview, false)
})

test('가입금액이 다르면 1,000만원당 단가로 고른다 (싼 보험료에 속지 않는다)', () => {
  // A: 3,000만원에 18,000원 → 1,000만원당 6,000원
  // B: 1,000만원에  9,000원 → 1,000만원당 9,000원 (보험료는 싸지만 단가는 비싸다)
  const mix = buildMix([
    item('A생명', '암진단비', '3,000만원', '18,000원'),
    item('B화재', '암진단비', '1,000만원', '9,000원')
  ])
  assert.equal(mix.rows[0].best.company, 'A생명')
  assert.equal(mix.rows[0].amountsDiffer, true)
  assert.equal(mix.rows[0].candidates.find((c) => c.company === 'A생명').unitPrice, 6000)
  assert.equal(mix.rows[0].candidates.find((c) => c.company === 'B화재').unitPrice, 9000)
})

test('가입금액을 못 읽으면 보험료로만 비교하고 확인 필요로 표시한다', () => {
  const mix = buildMix([
    item('A생명', '암진단비', '확인필요', '18,000원'),
    item('B화재', '암진단비', '확인필요', '15,000원')
  ])
  assert.equal(mix.rows[0].best.company, 'B화재')
  assert.equal(mix.rows[0].needsReview, true)
})

test('담보별로 회사를 쪼갠다 — 암은 A, 뇌·심장은 B', () => {
  const mix = buildMix([
    item('A생명', '암진단비', '3,000만원', '12,000원'),
    item('A생명', '뇌혈관질환진단비', '2,000만원', '20,000원'),
    item('A생명', '급성심근경색진단비', '2,000만원', '18,000원'),
    item('B화재', '암진단비', '3,000만원', '16,000원'),
    item('B화재', '뇌혈관질환진단비', '2,000만원', '11,000원'),
    item('B화재', '급성심근경색진단비', '2,000만원', '9,000원')
  ])
  const pick = (label) => mix.rows.find((r) => r.label === label).best.company
  assert.equal(pick('암진단비(일반암)'), 'A생명')
  assert.equal(pick('뇌혈관질환진단비'), 'B화재')
  assert.equal(pick('급성심근경색진단비'), 'B화재')

  // 조합 = 12,000 + 11,000 + 9,000
  assert.equal(mix.mixPremium, 32000)
  assert.deepEqual(mix.usedCompanies.slice().sort(), ['A생명', 'B화재'])

  // 한 회사로만 가면 A는 50,000원 / B는 36,000원 → 가장 싼 단일은 B(36,000원)
  assert.equal(mix.cheapestSingle.company, 'B화재')
  assert.equal(mix.cheapestSingle.premium, 36000)
  assert.equal(mix.savedVsSingle, 4000)
})

test('제안서 3개도 그대로 비교한다', () => {
  const mix = buildMix([
    item('A생명', '암진단비', '3,000만원', '12,000원'),
    item('B화재', '암진단비', '3,000만원', '16,000원'),
    item('C손보', '암진단비', '3,000만원', '9,000원'),
    item('A생명', '골절진단비', '100만원', '900원'),
    item('B화재', '골절진단비', '100만원', '700원'),
    item('C손보', '골절진단비', '100만원', '1,200원')
  ])
  assert.equal(mix.byCompany.length, 3)
  assert.equal(mix.rows.find((r) => r.label === '암진단비(일반암)').best.company, 'C손보')
  assert.equal(mix.rows.find((r) => r.label === '골절진단비').best.company, 'B화재')
  assert.equal(mix.mixPremium, 9700)
})

test('한 회사에만 있는 담보는 비교가 아니라 단독으로 표시한다', () => {
  const mix = buildMix([
    item('A생명', '암진단비', '3,000만원', '12,000원'),
    item('B화재', '암진단비', '3,000만원', '16,000원'),
    item('A생명', '깁스치료비', '30만원', '500원')
  ])
  const cast = mix.rows.find((r) => r.label === '깁스치료비')
  assert.equal(cast.soleOffer, true)
  assert.equal(cast.best.company, 'A생명')
  // B는 깁스치료비가 없으므로 '전 담보 보유'가 아니다 → 단일 회사 비교 대상에서 빠진다
  assert.equal(mix.cheapestSingle.company, 'A생명')
})

test('같은 회사에 같은 담보가 두 줄이면 보험료를 합치고 가입금액은 큰 쪽을 쓴다', () => {
  const mix = buildMix([
    item('A생명', '암진단비', '2,000만원', '8,000원'),
    item('A생명', '암진단비(갱신형)', '3,000만원', '5,000원')
  ])
  const only = mix.rows[0].candidates[0]
  assert.equal(only.premiumWon, 13000)
  assert.equal(only.amountManwon, 3000)
})

test('담보가 없으면 빈 결과를 낸다', () => {
  const mix = buildMix([])
  assert.deepEqual(mix.rows, [])
  assert.equal(mix.mixPremium, 0)
  assert.equal(mix.cheapestSingle, null)
  assert.equal(mix.savedVsSingle, null)
})

test('뇌·심장 담보는 회사마다 달라도 비교표에서 한 줄로 모은다', () => {
  const fam = (name) => {
    const { key, label } = mixKeyOf(name)
    return familyOf(key, label)
  }
  // 회사마다 넣는 담보가 달라도 같은 줄에서 비교돼야 한다.
  assert.equal(fam('뇌혈관질환진단비').key, 'fam-brain')
  assert.equal(fam('뇌졸중진단비').key, 'fam-brain')
  assert.equal(fam('뇌출혈진단비').key, 'fam-brain')
  assert.equal(fam('허혈성심장질환진단비').key, 'fam-heart')
  assert.equal(fam('급성심근경색증진단비').key, 'fam-heart')

  // 묶인 줄은 칸마다 실제 담보를 같이 보여줘야 하므로 표시가 필요하다.
  assert.equal(fam('뇌졸중진단비').grouped, true)
  assert.equal(fam('뇌졸중진단비').label, '뇌 진단비')
})

test('보험금이 따로 나오는 담보는 묶지 않는다', () => {
  const fam = (name) => {
    const { key, label } = mixKeyOf(name)
    return familyOf(key, label)
  }
  // 일반암과 유사암은 각각 보험금이 나오므로 한 줄로 합치면 안 된다.
  assert.notEqual(fam('암진단비').key, fam('유사암진단비').key)
  assert.equal(fam('암진단비').grouped, false)
  // 수술비·사망도 그대로 둔다.
  assert.equal(fam('질병수술비').grouped, false)
  assert.equal(fam('상해사망').grouped, false)
})

test('담보 크기에 맞는 단가 단위를 고른다', () => {
  // 진단비처럼 큰 담보
  assert.deepEqual(unitBasis(3000), { perManwon: 1000, label: '1,000만원당' })
  assert.deepEqual(unitBasis(1000), { perManwon: 1000, label: '1,000만원당' })
  // 골절·화상 같은 소액 담보
  assert.deepEqual(unitBasis(500), { perManwon: 100, label: '100만원당' })
  assert.deepEqual(unitBasis(100), { perManwon: 100, label: '100만원당' })
  // 입원일당처럼 일당으로 가입하는 담보
  assert.deepEqual(unitBasis(10), { perManwon: 1, label: '1만원당' })
  assert.deepEqual(unitBasis(3), { perManwon: 1, label: '1만원당' })
  // 가입금액을 못 읽으면 단가도 없다
  assert.equal(unitBasis(null), null)
  assert.equal(unitBasis(0), null)
})

test('단위당 보험료를 계산한다', () => {
  // 암진단비 3,000만원에 51,300원 -> 1,000만원당 17,100원
  assert.equal(unitPriceAt(51300, 3000, unitBasis(3000)), 17100)
  // 골절진단비 100만원에 900원 -> 100만원당 900원
  assert.equal(unitPriceAt(900, 100, unitBasis(100)), 900)
  // 입원일당 10만원에 2,500원 -> 1만원당 250원
  assert.equal(unitPriceAt(2500, 10, unitBasis(10)), 250)
  // 못 읽은 값은 계산하지 않는다
  assert.equal(unitPriceAt(null, 3000, unitBasis(3000)), null)
  assert.equal(unitPriceAt(51300, null, null), null)
})

test('단위를 바꿔도 한 줄 안에서 회사 순위는 그대로다', () => {
  // 보여주기용 단위가 달라져도 어디가 싼지는 변하지 않아야 한다.
  const a = unitPriceAt(18000, 3000, unitBasis(3000))
  const b = unitPriceAt(21000, 3000, unitBasis(3000))
  assert.ok(a < b)
  assert.ok(18000 / 3000 < 21000 / 3000)
})

/* ---------- 담보 카드: 회사 줄 세우기 ---------- */

const offer = (company, premiumWon, amountManwon) => ({ company, premiumWon, amountManwon })

test('회사를 싼 순으로 줄 세우고 1등을 표시한다', () => {
  const r = rankOffers(
    [offer('A생명', 18000, 3000), offer('B화재', 12000, 3000), offer('C손보', 15000, 3000)],
    unitBasis(3000)
  )
  assert.deepEqual(r.ranked.map((o) => o.company), ['B화재', 'C손보', 'A생명'])
  assert.equal(r.best.company, 'B화재')
  assert.equal(r.ranked[0].best, true)
  assert.equal(r.ranked[1].best, false)
})

test('막대 길이는 제일 비싼 곳이 꽉 차고, 나머지는 그 비율이다', () => {
  const r = rankOffers([offer('A생명', 10000, 1000), offer('B화재', 20000, 1000)], unitBasis(1000))
  assert.equal(r.ranked[1].ratio, 1)
  assert.equal(r.ranked[0].ratio, 0.5)
})

test('1등보다 얼마나 더 내는지 알려준다', () => {
  const r = rankOffers([offer('A생명', 12000, 3000), offer('B화재', 15000, 3000)], unitBasis(3000))
  // 같은 가입금액이면 단가 차이가 곧 보험료 차이 비율이다(3,000만원 -> 1,000만원당)
  assert.equal(r.ranked[0].extra, 0)
  assert.equal(r.ranked[1].extra, 1000)
  assert.equal(r.gap, 1000)
})

test('가입금액이 다르면 단가로 줄 세운다 — 싼 보험료에 속지 않는다', () => {
  // A: 3,000만원 18,000원 -> 1,000만원당 6,000원
  // B: 1,000만원  9,000원 -> 1,000만원당 9,000원
  const r = rankOffers([offer('A생명', 18000, 3000), offer('B화재', 9000, 1000)], unitBasis(3000))
  assert.equal(r.best.company, 'A생명')
  assert.equal(r.amountsDiffer, true)
})

test('가입금액을 못 읽은 회사가 있으면 보험료로 비교한다', () => {
  const r = rankOffers([offer('A생명', 18000, 3000), offer('B화재', 15000, null)], unitBasis(3000))
  assert.equal(r.best.company, 'B화재')
  assert.equal(r.ranked[0].score, 15000)
})

test('회사가 하나뿐이면 비교하지 않는다', () => {
  const r = rankOffers([offer('A생명', 12000, 3000)], unitBasis(3000))
  assert.equal(r.gap, null)
  assert.equal(r.best.company, 'A생명')
  assert.equal(r.ranked[0].ratio, 1)
})

test('보험료가 없는 회사는 줄에서 뺀다', () => {
  const r = rankOffers([offer('A생명', 0, 3000), offer('B화재', 12000, 3000)], unitBasis(3000))
  assert.equal(r.ranked.length, 1)
  assert.equal(r.best.company, 'B화재')
})

test('아무 값도 없으면 빈 결과', () => {
  const r = rankOffers([], unitBasis(3000))
  assert.deepEqual(r.ranked, [])
  assert.equal(r.best, null)
  assert.equal(r.gap, null)
})
