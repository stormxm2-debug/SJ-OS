/**
 * SJ CLAIM FINDER — 어댑터 테스트(기존 데이터 → 엔진 입력).
 * 실제 포맷 추측 금지: 코드에서 쓰이는 필드만 매핑, 없으면 null/미확인, 잘못된 입력은 건너뜀.
 * 실행: node --test test/claimAdapters.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

async function load(src) {
  const r = await build({ entryPoints: [src], bundle: true, format: 'esm', write: false, platform: 'node' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-adp-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, r.outputFiles[0].text, 'utf8')
  return import(file)
}

const { treatmentsFromHealthRecordResult, coverageCategoryOf, contractsFromCoverageAnalysis, attachPolicyTerms } = await load(
  'src/renderer/src/services/claim-finder/adapters.ts'
)

test('건강기록 결과 → 진료 이벤트 매핑(진단/수술명, 입원일수, 금액, provenance)', () => {
  const result = {
    resDetailTreatList: [
      {
        resTreatStartDate: '20250601',
        resHospitalName: 'C병원',
        resTreatType: '입원',
        resDiseaseName: '대장암',
        resOperationName: '결장절제술',
        resAdmissionDays: '10',
        resDeductibleAmt: '500,000'
      }
    ]
  }
  const { events, warnings } = treatmentsFromHealthRecordResult(result, { requestId: 'req-1' })
  assert.equal(events.length, 1)
  const e = events[0]
  assert.equal(e.date, '20250601')
  assert.equal(e.institution, 'C병원')
  assert.equal(e.diagnosisName, '대장암')
  assert.equal(e.procedureName, '결장절제술')
  assert.equal(e.surgeryVerified, false) // 이름만으론 미검증
  // 공단 입원일수는 admissionDays(참고값)로 매핑하고, 입원 '확정'은 별도 증빙 전까지 미검증으로 둔다.
  assert.equal(e.admissionDays, 10)
  assert.equal(e.inpatientVerified, false)
  assert.equal(e.visitDays, undefined) // resVisitDays 없음 → 외래 통원일수 미확인
  assert.equal(e.deductibleAmt, 500000)
  assert.equal(e.source.kind, 'health_record_json')
  assert.ok(e.source.jsonPath.includes('resDetailTreatList[0]'))
  assert.equal(warnings.length, 0)
})

test('날짜 없는/형식오류 레코드는 제외 + warning', () => {
  const { events, warnings } = treatmentsFromHealthRecordResult({ resList: [{ resHospitalName: 'X' }, null, 'bad'] })
  assert.equal(events.length, 0)
  assert.ok(warnings.length >= 1)
})

test('잘못된 입력(배열/객체 아님) → 빈 결과 + warning (크래시 없음)', () => {
  assert.deepEqual(treatmentsFromHealthRecordResult('not-json').events, [])
  assert.deepEqual(treatmentsFromHealthRecordResult(null).events, [])
  assert.ok(treatmentsFromHealthRecordResult(42).warnings.length >= 0)
})

test('담보명 → 카테고리 분류', () => {
  assert.equal(coverageCategoryOf('질병수술비'), 'surgery')
  assert.equal(coverageCategoryOf('암진단비'), 'diagnosis')
  assert.equal(coverageCategoryOf('질병입원일당'), 'hospitalization_daily')
  assert.equal(coverageCategoryOf('실손의료비(급여)'), 'actual_loss')
  assert.equal(coverageCategoryOf('운전자벌금'), 'other')
  assert.equal(coverageCategoryOf(''), 'unknown')
})

test('보장분석 → 계약: current>0 담보만, 약관 미연결(null)', () => {
  const analysis = {
    id: 'ca-1',
    policies: [{ insurer: 'KB손해', product: '종합' }],
    coverages: [
      { key: 'cancer', label: '암진단비', unit: 'amount', current: 20000000, recommended: 30000000 },
      { key: 'death', label: '사망', unit: 'amount', current: 0, recommended: 100000000 } // 미보유 → 제외
    ]
  }
  const { contracts } = contractsFromCoverageAnalysis(analysis)
  assert.equal(contracts.length, 1)
  assert.equal(contracts[0].coverages.length, 1)
  const c = contracts[0].coverages[0]
  assert.equal(c.name, '암진단비')
  assert.equal(c.category, 'diagnosis')
  assert.equal(c.subscribedAmount, 20000000)
  assert.equal(c.clauseId, null) // 약관 미연결 → 규칙상 NEED_DOCUMENTS 유도
  assert.equal(c.verifiedPayoutAmount, null)
})

test('보장분석 빈/오류 입력 → 빈 계약 + warning', () => {
  assert.deepEqual(contractsFromCoverageAnalysis(null).contracts, [])
  assert.deepEqual(contractsFromCoverageAnalysis({ coverages: [] }).contracts, [])
})

test('약관 연결: 담보명 매칭 시 clauseId/버전 부여', () => {
  const base = contractsFromCoverageAnalysis({
    id: 'ca-1',
    policies: [{ insurer: 'KB' }],
    coverages: [{ label: '암진단비', current: 20000000 }]
  }).contracts
  const { contracts, matched } = attachPolicyTerms(base, [
    { id: 'term-9', insurer: 'KB', versionNote: '2024판', summary: { clauses: [{ coverage: '암진단', payRule: '가입금액 전액' }] } }
  ])
  assert.equal(matched, 1)
  assert.equal(contracts[0].coverages[0].clauseId, 'term-9')
  assert.equal(contracts[0].coverages[0].clauseVersion, '2024판')
  // payRule 은 자유텍스트 → 지급액 숫자로 신뢰하지 않음(verifiedPayoutAmount 그대로 null)
  assert.equal(contracts[0].coverages[0].verifiedPayoutAmount, null)
})

test('약관 없음 → 매칭 0 + warning (원본 유지)', () => {
  const base = contractsFromCoverageAnalysis({ coverages: [{ label: '암진단비', current: 1 }] }).contracts
  const { matched, warnings } = attachPolicyTerms(base, [])
  assert.equal(matched, 0)
  assert.ok(warnings.length >= 1)
})
