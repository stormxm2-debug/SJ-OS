/**
 * SJ CLAIM FINDER — 규칙 엔진 테스트.
 * 돈·지급조건이 걸린 로직이라 규칙을 여기에 고정한다.
 * 실행: node --test test/claimRules.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

async function load(src) {
  const result = await build({ entryPoints: [src], bundle: true, format: 'esm', write: false, platform: 'node' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-claim-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, result.outputFiles[0].text, 'utf8')
  return import(file)
}

const { analyzeClaims, sumConfirmedAmounts, CLAIM_RULES_VERSION } = await load(
  'src/renderer/src/services/claim-finder/claimRules.ts'
)

const srcC = { kind: 'coverage_pdf', note: 'test' }
const srcT = { kind: 'health_record_json', jsonPath: 'test[0]' }
const cov = (o) => ({ id: 'c1', contractId: 'k1', name: '담보', category: 'diagnosis', source: srcC, ...o })
const contract = (coverages, o) => ({ id: 'k1', insurer: '테스트', contractDate: '20240101', coverages, source: srcC, ...o })
const treat = (o) => ({ id: 't1', date: '20250601', source: srcT, ...o })
const run = (coverages, treatments, history = []) =>
  analyzeClaims({ contracts: [contract(coverages)], treatments, claimHistory: history, asOf: '20261101' })

const only = (r) => {
  assert.equal(r.candidates.length, 1, `정확히 1개 후보 예상, 실제 ${r.candidates.length}`)
  return r.candidates[0]
}

test('약관 미연결 → NEED_DOCUMENTS, 금액 null(미산정, 0 아님)', () => {
  const c = only(
    run([cov({ category: 'diagnosis', clauseId: null, subscribedAmount: 20000000 })], [treat({ diagnosisName: '대장암' })])
  )
  assert.equal(c.status, 'NEED_DOCUMENTS')
  assert.equal(c.estimatedAmount, null) // 0 이 아니라 null
  assert.ok(c.missingDocs.some((m) => m.code === 'POLICY_TERMS'))
  assert.equal(c.rulesVersion, CLAIM_RULES_VERSION)
})

test('계약/보장 개시 전 진료 → EXCLUDED', () => {
  const c = only(
    run(
      [cov({ category: 'hospitalization_daily', clauseId: 'T', startDate: '20240101', perDayAmount: 30000 })],
      [treat({ date: '20231201', treatType: '입원', visitDays: 5 })]
    )
  )
  assert.equal(c.status, 'EXCLUDED')
  assert.equal(c.estimatedAmount, null)
})

test('면책기간 이내 진료 → EXCLUDED', () => {
  const c = only(
    run(
      [cov({ category: 'diagnosis', clauseId: 'T', startDate: '20240101', waitingDays: 90, verifiedPayoutAmount: 10000000 })],
      [treat({ date: '20240201', diagnosisName: '위암' })] // 개시+90일(~0401) 이내
    )
  )
  assert.equal(c.status, 'EXCLUDED')
})

test('검증된 지급 이력 매칭 → ALREADY_PAID', () => {
  const c = only(
    run(
      [cov({ id: 'c1', category: 'diagnosis', clauseId: 'T', startDate: '20240101', verifiedPayoutAmount: 10000000 })],
      [treat({ date: '20250701', diagnosisName: '대장암' })],
      [{ id: 'h1', coverageId: 'c1', date: '20250701', paidAmount: 10000000, status: '지급', verified: true, source: { kind: 'claim_history' } }]
    )
  )
  assert.equal(c.status, 'ALREADY_PAID')
})

test('청구 이력 미확인 → ALREADY_PAID 아님 + 미청구 단정 금지(근거/서류 표기)', () => {
  const c = only(
    run(
      [cov({ id: 'c1', category: 'diagnosis', clauseId: 'T', startDate: '20240101', verifiedPayoutAmount: 10000000 })],
      [treat({ date: '20250701', diagnosisName: '대장암' })],
      [] // 이력 없음(미확인)
    )
  )
  assert.notEqual(c.status, 'ALREADY_PAID')
  assert.ok(c.reasons.some((r) => r.includes('청구 이력 미확인')))
  assert.ok(c.missingDocs.some((m) => m.code === 'CLAIM_HISTORY'))
})

test('수술: 의료행위 이름만으론 인정 금지 → NEED_DOCUMENTS', () => {
  const c = only(
    run(
      [cov({ category: 'surgery', clauseId: 'T', startDate: '20240101', verifiedPayoutAmount: 1000000 })],
      [treat({ procedureName: '가상절제술', surgeryVerified: false })]
    )
  )
  assert.equal(c.status, 'NEED_DOCUMENTS')
  assert.ok(c.missingDocs.some((m) => m.code === 'SURGERY_PROOF'))
  assert.equal(c.estimatedAmount, null)
})

test('수술 근거 검증됨 → CONFIRMED_CONDITIONS + 약관 정액 금액', () => {
  const c = only(
    run(
      [cov({ category: 'surgery', clauseId: 'T', startDate: '20240101', verifiedPayoutAmount: 1000000 })],
      [treat({ procedureName: '담낭절제술', surgeryVerified: true })]
    )
  )
  assert.equal(c.status, 'CONFIRMED_CONDITIONS')
  assert.equal(c.estimatedAmount, 1000000)
  assert.ok(c.amountBasis && c.amountBasis.includes('약관'))
})

test('입원일당: 일당 × 일수, 일수한도 적용', () => {
  const c1 = only(
    run(
      [cov({ category: 'hospitalization_daily', clauseId: 'T', startDate: '20240101', perDayAmount: 30000, limitDays: 120 })],
      [treat({ treatType: '입원', visitDays: 10 })]
    )
  )
  assert.equal(c1.status, 'CONFIRMED_CONDITIONS')
  assert.equal(c1.estimatedAmount, 300000)

  const c2 = only(
    run(
      [cov({ category: 'hospitalization_daily', clauseId: 'T', startDate: '20240101', perDayAmount: 30000, limitDays: 5 })],
      [treat({ treatType: '입원', visitDays: 10 })]
    )
  )
  assert.equal(c2.estimatedAmount, 150000) // 5일 한도
})

test('감액 규칙: 보장 개시 1년 이내 50% 감액', () => {
  const c = only(
    run(
      [
        cov({
          category: 'diagnosis',
          clauseId: 'T',
          startDate: '20240101',
          waitingDays: 90,
          verifiedPayoutAmount: 20000000,
          reductionRules: [{ withinDays: 365, ratio: 0.5 }]
        })
      ],
      [treat({ date: '20240601', diagnosisName: '대장암' })] // 면책 이후, 1년 이내
    )
  )
  assert.equal(c.status, 'CONFIRMED_CONDITIONS')
  assert.equal(c.estimatedAmount, 10000000) // 50% 감액
})

test('약관은 있으나 지급액 규칙 없음 → 금액 null(가입금액으로 대체 안 함)', () => {
  const c = only(
    run(
      [cov({ category: 'diagnosis', clauseId: 'T', startDate: '20240101', subscribedAmount: 50000000 })], // verifiedPayoutAmount 없음
      [treat({ diagnosisName: '대장암' })]
    )
  )
  assert.equal(c.estimatedAmount, null)
  assert.notEqual(c.estimatedAmount, 0)
  assert.ok(c.reasons.some((r) => r.includes('가입금액은 지급액 아님')))
})

test('같은 날짜·기관이라도 별개 진료는 병합하지 않음(2건 → 2 후보)', () => {
  const r = run(
    [cov({ category: 'hospitalization_daily', clauseId: 'T', startDate: '20240101', perDayAmount: 30000 })],
    [
      { id: 'ta', date: '20250905', institution: 'G병원', treatType: '입원', visitDays: 2, source: srcT },
      { id: 'tb', date: '20250905', institution: 'G병원', treatType: '입원', visitDays: 3, source: srcT }
    ]
  )
  assert.equal(r.candidates.length, 2)
  assert.deepEqual(
    r.candidates.map((c) => c.treatmentEventIds).flat().sort(),
    ['ta', 'tb']
  )
})

test('CI 주계약+선지급 중복 합산 방지 — 그룹 내 1건(최대값)만 합산', () => {
  const r = analyzeClaims({
    asOf: '20261101',
    contracts: [
      contract([
        cov({ id: 'ci-main', name: 'CI주계약', category: 'diagnosis', clauseId: 'T', startDate: '20240101', verifiedPayoutAmount: 30000000, dedupeGroup: 'CI' }),
        cov({ id: 'ci-pre', name: 'CI선지급', category: 'diagnosis', clauseId: 'T', startDate: '20240101', verifiedPayoutAmount: 10000000, dedupeGroup: 'CI' })
      ])
    ],
    treatments: [treat({ id: 'tdx', diagnosisName: '뇌출혈' })]
  })
  const confirmed = r.candidates.filter((c) => c.status === 'CONFIRMED_CONDITIONS')
  assert.equal(confirmed.length, 2) // 둘 다 조건 확인
  const sum = sumConfirmedAmounts(r.candidates)
  assert.equal(sum.total, 30000000) // 합산은 그룹 내 최대 1건만 → 40M 아님
  assert.equal(sum.countedCandidateIds.length, 1)
})

test('잘못된 진료 입력(날짜 형식오류)은 제외 + warning', () => {
  const r = analyzeClaims({
    asOf: '20261101',
    contracts: [contract([cov({ category: 'diagnosis', clauseId: 'T', startDate: '20240101', verifiedPayoutAmount: 1 })])],
    treatments: [{ id: 'bad', date: '2025-6-1', diagnosisName: 'X', source: srcT }]
  })
  assert.equal(r.candidates.length, 0)
  assert.ok(r.warnings.length >= 1)
})

test('CONFIRMED_CONDITIONS 는 "지급확정"이 아님을 근거에 명시', () => {
  const c = only(
    run(
      [cov({ category: 'surgery', clauseId: 'T', startDate: '20240101', verifiedPayoutAmount: 1000000 })],
      [treat({ procedureName: 'x', surgeryVerified: true })]
    )
  )
  assert.ok(c.reasons.some((r) => r.includes('지급확정 아님')))
})
