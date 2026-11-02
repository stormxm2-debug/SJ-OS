/**
 * SJ CLAIM FINDER — 원본 수집(ingest) 테스트. 합성 입력으로 end-to-end 검증.
 * 실제 HIRA/KB 포맷 정확도는 미검증(테스트는 '추측 금지·안전 비활성·provenance' 동작을 고정).
 * 실행: node --test test/claimIngest.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

async function load(src) {
  const r = await build({ entryPoints: [src], bundle: true, format: 'esm', write: false, platform: 'node' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-ing-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, r.outputFiles[0].text, 'utf8')
  return import(file)
}

const { ingestFile, detectKind, INGEST_LIMITS } = await load('src/renderer/src/services/claim-finder/ingest.ts')

const enc = (s) => new TextEncoder().encode(s)
const pdfBytes = (body = 'x'.repeat(100)) => enc('%PDF-1.4\n' + body)

test('JSON 유효 → 진료 이벤트 추출 + provenance 해시 + 미검증 경고', async () => {
  const json = JSON.stringify({ resDetailTreatList: [{ resTreatStartDate: '20250601', resHospitalName: 'C병원', resTreatType: '입원', resAdmissionDays: '10' }] })
  const r = await ingestFile({ name: 'hira.json', declaredType: 'application/json', bytes: enc(json) })
  assert.equal(r.ok, true)
  assert.equal(r.kind, 'health_record_json')
  assert.equal(r.events.length, 1)
  assert.equal(r.events[0].admissionDays, 10)
  assert.equal(r.events[0].inpatientVerified, false) // 공단자료라도 입원 '확정' 아님
  assert.match(r.fileHash, /^[0-9a-f]{64}$/) // 기본 Web Crypto SHA-256
  assert.ok(r.warnings.some((w) => w.includes('미검증')))
})

test('JSON 파싱 실패 → 오류, ok=false (추측 안 함)', async () => {
  const r = await ingestFile({ name: 'bad.json', bytes: enc('{ not json ') })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('JSON 파싱 실패')))
})

test('JSON 구조 미상(레코드 0) → 오류(사람 확인 필요)', async () => {
  const r = await ingestFile({ name: 'empty.json', bytes: enc('{"foo":123}') })
  assert.equal(r.ok, false)
  assert.deepEqual(r.events, [])
  assert.ok(r.errors.some((e) => e.includes('사람 확인')))
})

test('PDF + 추출기 미설정 → 안전 비활성(조용히 성공 아님)', async () => {
  const r = await ingestFile({ name: 'kb.pdf', declaredType: 'application/pdf', bytes: pdfBytes() })
  assert.equal(r.ok, false)
  assert.equal(r.kind, 'coverage_pdf')
  assert.equal(r.needsManualReview, true)
  assert.ok(r.errors.some((e) => e.includes('비활성')))
})

test('PDF + 추출기 주입 → 페이지 원문만, 사람검토 필요, 자동 담보 추출 안 함', async () => {
  const extractPdfPages = async () => [{ page: 1, text: '암진단비 가입금액 2천만원' }, { page: 2, text: '' }]
  const r = await ingestFile({ name: 'kb.pdf', bytes: pdfBytes() }, { extractPdfPages })
  assert.equal(r.ok, true)
  assert.equal(r.needsManualReview, true)
  assert.equal(r.pages.length, 2)
  assert.equal(r.pages[0].page, 1)
  assert.ok(r.warnings.some((w) => w.includes('가입금액 ≠ 지급액')))
  assert.ok(r.warnings.some((w) => w.includes('스캔')), '빈 텍스트 페이지 경고')
})

test('PDF 추출 결과 0페이지 → 오류(스캔/미지원)', async () => {
  const r = await ingestFile({ name: 'scan.pdf', bytes: pdfBytes() }, { extractPdfPages: async () => [] })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('사람 확인')))
})

test('내용 우선 판별: .json 이름이어도 %PDF 내용이면 PDF 로 취급', async () => {
  assert.equal(detectKind({ name: 'spoof.json', declaredType: 'application/json', bytes: pdfBytes() }), 'coverage_pdf')
  const r = await ingestFile({ name: 'spoof.json', declaredType: 'application/json', bytes: pdfBytes() })
  assert.equal(r.kind, 'coverage_pdf') // 선언 MIME 만 믿지 않음
})

test('지원하지 않는 형식 → 오류', async () => {
  const r = await ingestFile({ name: 'x.bin', bytes: enc('\x00\x01random binary data here padding padding') })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('지원하지 않는')))
})

test('크기 제한: 과대 → 오류', async () => {
  const big = new Uint8Array(INGEST_LIMITS.maxBytes + 1)
  big.set(enc('{'), 0)
  const r = await ingestFile({ name: 'big.json', bytes: big }, { limits: { maxBytes: INGEST_LIMITS.maxBytes } })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('너무 큽니다')))
})

test('빈/극소 파일 → 오류', async () => {
  const r0 = await ingestFile({ name: 'e.json', bytes: new Uint8Array(0) })
  assert.equal(r0.ok, false)
  const r1 = await ingestFile({ name: 't.json', bytes: enc('{') })
  assert.equal(r1.ok, false)
  assert.ok(r1.errors.some((e) => e.includes('너무 작')))
})

test('해시 함수 주입 가능(테스트 결정론)', async () => {
  const r = await ingestFile(
    { name: 'h.json', bytes: enc('{"resList":[{"resTreatStartDate":"20250101","resHospitalName":"A"}]}') },
    { sha256: async () => 'deadbeef' }
  )
  assert.equal(r.fileHash, 'deadbeef')
  assert.equal(r.ok, true)
})
