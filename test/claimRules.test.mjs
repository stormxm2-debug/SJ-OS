/**
 * SJ CLAIM FINDER — 규칙 엔진 테스트 (v0.2: 보수성 강화).
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
  const r = await build({ entryPoints: [src], bundle: true, format: 'esm', write: false, platform: 'node' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-claim-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, r.outputFiles[0].text, 'utf8')
  return import(file)
}

const { analyzeClaims, sumConfirmedAmounts, isValidYmd } = await load('src/renderer/src/services/claim-finder/claimRules.ts')

const srcC = { kind: 'coverage_pdf' }
const srcT = { kind: 'health_record_json' }
// 보장 개시/종료/면책이 '확인'된 기본 담보(검증 가능 상태).
const cov = (o) => ({ id: 'c1', contractId: 'k1', name: '담보', category: 'diagnosis', source: srcC, startDate: '20240101', endDate: '20991231', waitingDays: 0, clauseId: 'T', ...o })
const contract = (coverages, o) => ({ id: 'k1', insurer: '테스트', contractDate: '20240101', coverages, source: srcC, ...o })
const treat = (o) => ({ id: 't1', date: '20250601', source: srcT, ...o })
const verif = (tid, cid) => ({ treatmentEventId: tid, coverageId: cid, conditionVerified: true })
const run = (coverages, treatments, opt = {}) =>
  analyzeClaims({ contracts: [contract(coverages)], treatments, claimHistory: opt.history ?? [], verifications: opt.verifications ?? [], asOf: '20261101' })
const only = (r) => {
  assert.equal(r.candidates.length, 1, `정확히 1개 후보 예상, 실제 ${r.candidates.length}`)
  return r.candidates[0]
}

// ── 날짜/숫자 검증 ──────────────────────────────────────────────
test('isValidYmd: 달력상 불가능한 날짜 거부', () => {
  assert.equal(isValidYmd('20250231'), false)
  assert.equal(isValidYmd('20251301'), false)
  assert.equal(isValidYmd('20250000'), false)
  assert.equal(isValidYmd('2025-06-01'), false)
  assert.equal(isValidYmd('20250601'), true)
  assert.equal(isValidYmd('20240229'), true) // 윤년
})

test('불가능한 날짜 진료는 제외 + warning', () => {
  const r = run([cov({ verifiedPayoutAmount: 1 })], [treat({ date: '20250231', diagnosisName: '암' })], { verifications: [verif('t1', 'c1')] })
  assert.equal(r.candidates.length, 0)
  assert.ok(r.warnings.length >= 1)
})

// ── 점1: 약관ID만/이름만으로 인정 금지 ───────────────────────────
test('약관 미연결 → NEED_DOCUMENTS, 금액 null', () => {
  const c = only(run([cov({ clauseId: null, verifiedPayoutAmount: 1 })], [treat({ diagnosisName: '암' })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(c.status, 'NEED_DOCUMENTS')
  assert.equal(c.estimatedAmount, null)
  assert.ok(c.missingDocs.some((m) => m.code === 'POLICY_TERMS'))
})

test('약관 ID만 있고 조건 미검증 → NEED_DOCUMENTS, 금액 null (약관ID만으로 불충분)', () => {
  const c = only(run([cov({ verifiedPayoutAmount: 20000000 })], [treat({ diagnosisName: '대장암' })])) // verifications 없음
  assert.equal(c.status, 'NEED_DOCUMENTS')
  assert.equal(c.estimatedAmount, null)
  assert.equal(c.conditionVerified, false)
  assert.ok(c.missingDocs.some((m) => m.code === 'CONDITION_MATCH'))
})

test('진단비: 조건 검증 + 전부 충족 → CONFIRMED + 정액', () => {
  const c = only(run([cov({ verifiedPayoutAmount: 20000000 })], [treat({ diagnosisName: '대장암', date: '20250701' })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(c.status, 'CONFIRMED_CONDITIONS')
  assert.equal(c.estimatedAmount, 20000000)
  assert.ok(c.reasons.some((x) => x.includes('지급확정 아님')))
})

test('입원일당: 외래 다일 방문은 관련 후보 아님(입원일당 확정 금지)', () => {
  const r = run([cov({ category: 'hospitalization_daily', perDayAmount: 30000 })], [treat({ treatType: '외래', visitDays: 5 })], { verifications: [verif('t1', 'c1')] })
  assert.equal(r.candidates.length, 0)
})

test('입원일당: 입원 표기 있으나 증빙 미검증 → NEED_DOCUMENTS', () => {
  const c = only(run([cov({ category: 'hospitalization_daily', perDayAmount: 30000 })], [treat({ treatType: '입원', visitDays: 5 })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(c.status, 'NEED_DOCUMENTS')
  assert.equal(c.estimatedAmount, null)
  assert.ok(c.missingDocs.some((m) => m.code === 'HOSPITAL_PROOF'))
})

test('입원일당: 증빙 검증 + 조건 검증 → CONFIRMED, 일당×입원일수, 일수한도', () => {
  const base = { category: 'hospitalization_daily', perDayAmount: 30000 }
  const c1 = only(run([cov({ ...base, limitDays: 120 })], [treat({ treatType: '입원', inpatientVerified: true, admissionDays: 10 })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(c1.status, 'CONFIRMED_CONDITIONS')
  assert.equal(c1.estimatedAmount, 300000)
  const c2 = only(run([cov({ ...base, limitDays: 5 })], [treat({ treatType: '입원', inpatientVerified: true, admissionDays: 10 })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(c2.estimatedAmount, 150000)
})

test('수술: 이름만 → NEED_DOCUMENTS / 검증+조건검증 → CONFIRMED', () => {
  const s = { category: 'surgery', verifiedPayoutAmount: 1000000 }
  const n = only(run([cov(s)], [treat({ procedureName: 'x', surgeryVerified: false })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(n.status, 'NEED_DOCUMENTS')
  assert.equal(n.estimatedAmount, null)
  const y = only(run([cov(s)], [treat({ procedureName: 'x', surgeryVerified: true })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(y.status, 'CONFIRMED_CONDITIONS')
  assert.equal(y.estimatedAmount, 1000000)
})

// ── 점2: 개시/종료/면책/숫자 검증 ────────────────────────────────
test('보장 개시 전 → EXCLUDED', () => {
  const c = only(run([cov({ category: 'hospitalization_daily', perDayAmount: 30000 })], [treat({ date: '20231201', treatType: '입원', inpatientVerified: true, admissionDays: 5 })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(c.status, 'EXCLUDED')
})

test('보장 종료 후 → EXCLUDED (종료일 검사)', () => {
  const c = only(run([cov({ endDate: '20250101', verifiedPayoutAmount: 1 })], [treat({ date: '20250601', diagnosisName: '암' })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(c.status, 'EXCLUDED')
  assert.ok(c.reasons.some((x) => x.includes('보장 종료')))
})

test('면책기간 이내 → EXCLUDED', () => {
  const c = only(run([cov({ waitingDays: 90, verifiedPayoutAmount: 1 })], [treat({ date: '20240201', diagnosisName: '암' })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(c.status, 'EXCLUDED')
})

test('개시/종료/면책 미확인 → 정상조건으로 간주 금지(NEED_DOCUMENTS)', () => {
  const c = only(run([cov({ startDate: null, endDate: null, waitingDays: null, verifiedPayoutAmount: 1 })], [treat({ diagnosisName: '암' })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(c.status, 'NEED_DOCUMENTS')
  assert.equal(c.eligibilityVerified, false)
  assert.ok(c.missingDocs.some((m) => m.code === 'COV_START'))
  assert.ok(c.missingDocs.some((m) => m.code === 'COV_END'))
  assert.ok(c.missingDocs.some((m) => m.code === 'COV_WAIT'))
})

test('비정상 금액/일수(NaN/Infinity/음수)는 산정하지 않음(null, NaN 아님)', () => {
  const c1 = only(run([cov({ category: 'hospitalization_daily', perDayAmount: Number.NaN })], [treat({ treatType: '입원', inpatientVerified: true, admissionDays: 10 })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(c1.estimatedAmount, null)
  assert.notEqual(c1.status, 'CONFIRMED_CONDITIONS') // 금액 미산정 → POTENTIAL
  const c2 = only(run([cov({ verifiedPayoutAmount: Infinity })], [treat({ diagnosisName: '암' })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(c2.estimatedAmount, null)
  const c3 = only(run([cov({ category: 'hospitalization_daily', perDayAmount: 30000 })], [treat({ treatType: '입원', inpatientVerified: true, admissionDays: -5 })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(c3.status, 'NEED_DOCUMENTS') // 음수 입원일수 → 증빙 부족 처리
})

test('비정상 감액률(>1/음수)은 적용 안 함(NaN 금지)', () => {
  const bad = only(run([cov({ verifiedPayoutAmount: 20000000, reductionRules: [{ withinDays: 365, ratio: 1.5 }] })], [treat({ diagnosisName: '암', date: '20240601' })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(bad.estimatedAmount, 20000000) // 감액 미적용(원금)
  const good = only(run([cov({ verifiedPayoutAmount: 20000000, waitingDays: 0, reductionRules: [{ withinDays: 365, ratio: 0.5 }] })], [treat({ diagnosisName: '암', date: '20240601' })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(good.estimatedAmount, 10000000) // 정상 50% 감액
})

test('약관 있으나 지급규칙 없음 → 금액 null(가입금액 대체 금지), POTENTIAL', () => {
  const c = only(run([cov({ subscribedAmount: 50000000 })], [treat({ diagnosisName: '암' })], { verifications: [verif('t1', 'c1')] }))
  assert.equal(c.estimatedAmount, null)
  assert.notEqual(c.estimatedAmount, 0)
  assert.equal(c.status, 'POTENTIAL')
  assert.ok(c.missingDocs.some((m) => m.code === 'PAYOUT_RULE'))
})

// ── 점3: ALREADY_PAID 엄격화 ────────────────────────────────────
test('ALREADY_PAID: 검증된 지급 + 동일 사건(event id) 매칭만', () => {
  const h = [{ id: 'h', coverageId: 'c1', treatmentEventId: 't1', date: '20250701', status: '지급', verified: true, source: { kind: 'claim_history' } }]
  const c = only(run([cov({ verifiedPayoutAmount: 1 })], [treat({ date: '20250701', diagnosisName: '암' })], { history: h, verifications: [verif('t1', 'c1')] }))
  assert.equal(c.status, 'ALREADY_PAID')
})

test('같은 날짜 지급이나 사건 식별 불일치 → ALREADY_PAID 아님(확인 플래그)', () => {
  const h = [{ id: 'h', coverageId: 'c1', treatmentEventId: 'OTHER', date: '20250701', status: '지급', verified: true, source: { kind: 'claim_history' } }]
  const c = only(run([cov({ verifiedPayoutAmount: 1 })], [treat({ date: '20250701', diagnosisName: '암' })], { history: h, verifications: [verif('t1', 'c1')] }))
  assert.notEqual(c.status, 'ALREADY_PAID')
  assert.ok(c.reasons.some((x) => x.includes('동일 사건 여부 확인')))
})

test('거절/부지급 이력은 지급완료로 처리하지 않음', () => {
  const h = [{ id: 'h', coverageId: 'c1', treatmentEventId: 't1', date: '20250701', status: '부지급', verified: true, source: { kind: 'claim_history' } }]
  const c = only(run([cov({ verifiedPayoutAmount: 1 })], [treat({ date: '20250701', diagnosisName: '암' })], { history: h, verifications: [verif('t1', 'c1')] }))
  assert.notEqual(c.status, 'ALREADY_PAID')
  assert.ok(c.reasons.some((x) => x.includes('거절') || x.includes('부지급')))
})

test('청구 이력 미확인 → 미청구 단정 금지(근거/서류)', () => {
  const c = only(run([cov({ verifiedPayoutAmount: 1 })], [treat({ diagnosisName: '암' })], { verifications: [verif('t1', 'c1')] }))
  assert.notEqual(c.status, 'ALREADY_PAID')
  assert.ok(c.reasons.some((x) => x.includes('청구 이력 미확인')))
  assert.ok(c.missingDocs.some((m) => m.code === 'CLAIM_HISTORY'))
})

// ── 무병합 / 중복 합산 방지 ─────────────────────────────────────
test('같은 날짜·기관이라도 별개 진료는 병합하지 않음(2건)', () => {
  const r = run([cov({ category: 'hospitalization_daily', perDayAmount: 30000 })], [
    { id: 'ta', date: '20250905', institution: 'G', treatType: '입원', inpatientVerified: true, admissionDays: 2, source: srcT },
    { id: 'tb', date: '20250905', institution: 'G', treatType: '입원', inpatientVerified: true, admissionDays: 3, source: srcT }
  ])
  assert.equal(r.candidates.length, 2)
})

test('CI 주계약+선지급 중복 합산 방지 — 그룹 최대 1건', () => {
  const r = analyzeClaims({
    asOf: '20261101',
    contracts: [contract([
      cov({ id: 'ci-main', category: 'diagnosis', verifiedPayoutAmount: 30000000, dedupeGroup: 'CI' }),
      cov({ id: 'ci-pre', category: 'diagnosis', verifiedPayoutAmount: 10000000, dedupeGroup: 'CI' })
    ])],
    treatments: [treat({ id: 'tdx', diagnosisName: '뇌출혈' })],
    verifications: [verif('tdx', 'ci-main'), verif('tdx', 'ci-pre')]
  })
  const confirmed = r.candidates.filter((c) => c.status === 'CONFIRMED_CONDITIONS')
  assert.equal(confirmed.length, 2)
  const sum = sumConfirmedAmounts(r.candidates)
  assert.equal(sum.total, 30000000)
  assert.equal(sum.countedCandidateIds.length, 1)
})
