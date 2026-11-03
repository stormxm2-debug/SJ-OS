/**
 * 건강기록 요약(연/월 그룹 + 상병별 추정 묶음 + AI 비식별 요약) 테스트.
 * 실행: node --test test/hrSummarize.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

async function load(src) {
  const r = await build({ entryPoints: [src], bundle: true, format: 'esm', write: false, platform: 'node' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-hr-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, r.outputFiles[0].text, 'utf8')
  return import(file)
}

const m = await load('src/renderer/src/services/health-record/summarize.ts')
const { collectHrSections, summarizeByDisease, groupByDate, groupKeyOf, normalizeDisease, buildHrAiSummary, buildHighlights, diseaseFlags, FREQUENT_VISIT_THRESHOLD, classifySurgery } = m

const result = {
  resBasicTreatList: [
    { resTreatStartDate: '20260701', resHospitalName: '빛가람종합병원', resDepartment: '정형외과', resTreatType: '입원', resDiseaseName: '요추 염좌(S33)', resDeductibleAmt: '294000' },
    { resTreatStartDate: '20260616', resHospitalName: '빛가람종합병원', resDepartment: '정형외과', resTreatType: '입원', resDiseaseName: '요추 염좌', resDeductibleAmt: '96000' },
    { resTreatStartDate: '20250923', resHospitalName: '맘편한내과의원', resDepartment: '내과', resTreatType: '요양', resDiseaseName: '위염', resDeductibleAmt: '5400' },
    { resTreatStartDate: '20240101', resHospitalName: '옛날병원', resDepartment: '내과', resTreatType: '요양', resDiseaseName: '위염', resDeductibleAmt: '3000' }
  ],
  resDetailTreatList: [
    { resTreatStartDate: '20260701', resHospitalName: '빛가람종합병원', resTreatType: '수술', resCodeName: '요추 후방고정술' },
    { resTreatStartDate: '20260616', resHospitalName: '빛가람종합병원', resTreatType: '처치', resCodeName: '물리치료' }
  ],
  resPrescribeDrugList: [
    { resTreatStartDate: '20250923', resHospitalName: '맘편한내과의원', resDrugName: '란스톤캡슐', resIngredients: '란소프라졸', resTotalDosingdays: '14' },
    { resTreatStartDate: '20260701', resHospitalName: '빛가람종합병원', resDrugName: '트라마돌', resTotalDosingdays: '5' }
  ]
}

test('섹션 분류: 기본/세부/처방', () => {
  const sec = collectHrSections(result)
  assert.equal(sec.basic.length, 4)
  assert.equal(sec.detail.length, 2)
  assert.equal(sec.prescribe.length, 1 + 1)
})

test('병명 정규화: 괄호 코드 제거 → 같은 병명 묶임', () => {
  assert.equal(normalizeDisease('요추 염좌(S33)'), '요추 염좌')
  assert.equal(normalizeDisease('요추  염좌'), '요추 염좌')
})

test('상병별 추정 묶음: 방문수·수술·투약·기간', () => {
  const sec = collectHrSections(result)
  const d = summarizeByDisease(sec)
  const back = d.find((x) => x.disease === '요추 염좌')
  assert.ok(back, '요추 염좌 그룹 존재')
  assert.equal(back.visitCount, 2, '서로 다른 (날짜·기관) 2회')
  assert.equal(back.firstDate, '20260616')
  assert.equal(back.lastDate, '20260701')
  // 수술(날짜·기관 매칭): 후방고정술 1건 isSurgery, 물리치료는 처치
  const surg = back.surgeries.filter((x) => x.isSurgery).map((x) => x.name)
  assert.ok(surg.includes('요추 후방고정술'))
  assert.ok(!surg.includes('물리치료'))
  // 투약(날짜·기관 매칭): 트라마돌(20260701 빛가람) 연결
  assert.ok(back.medications.some((x) => x.name === '트라마돌'))
  assert.equal(back.selfPayTotal, 294000 + 96000)

  assert.equal(back.inpatientVisits, 2, '요추 염좌는 입원 2회')
  assert.equal(back.outpatientVisits, 0)

  const gastritis = d.find((x) => x.disease === '위염')
  assert.equal(gastritis.visitCount, 2) // 서로 다른 병원 2회
  assert.equal(gastritis.outpatientVisits, 2, '위염은 통원 2회')
  assert.equal(gastritis.inpatientVisits, 0)
  assert.ok(gastritis.medications.some((x) => x.name === '란스톤캡슐' && x.days === 14))
})

test('하이라이트: 입원/수술/통원 7회↑/고액', () => {
  // 위염을 통원 7회로 늘려 '잦은 통원' 하이라이트 검증.
  const many = { resBasicTreatList: [] }
  for (let i = 0; i < 7; i++) many.resBasicTreatList.push({ resTreatStartDate: `2025010${(i % 9) + 1}`, resHospitalName: `의원${i}`, resTreatType: '외래', resDiseaseName: '위염', resDeductibleAmt: '5000' })
  const merged = {
    resBasicTreatList: [...result.resBasicTreatList, ...many.resBasicTreatList],
    resDetailTreatList: result.resDetailTreatList,
    resPrescribeDrugList: result.resPrescribeDrugList
  }
  const h = buildHighlights(collectHrSections(merged))
  assert.ok(h.inpatientVisits >= 2, '입원 방문 집계')
  assert.ok(h.surgeryCount >= 1, '수술 집계')
  assert.ok(h.frequentOutpatient.some((d) => d.disease === '위염'), '통원 7회 이상 상병에 위염')
  assert.ok(h.bigSelfPay.some((d) => d.disease === '요추 염좌'), '고액 본인부담에 요추 염좌(39만)')
  assert.equal(h.hasAny, true)

  const back = summarizeByDisease(collectHrSections(merged)).find((x) => x.disease === '요추 염좌')
  const flags = diseaseFlags(back)
  assert.ok(flags.some((f) => f.startsWith('입원')))
  assert.ok(flags.some((f) => f.startsWith('수술')))
  assert.equal(FREQUENT_VISIT_THRESHOLD, 7)
})

test('수술 부위 추정(classifySurgery) + SurgeryItem 부위 필드', () => {
  assert.equal(classifySurgery('요추 후방고정술').group, 'spine')
  assert.equal(classifySurgery('요추 후방고정술').part, '척추(요추)')
  assert.equal(classifySurgery('슬관절 반월상연골 절제술').group, 'knee')
  assert.equal(classifySurgery('담낭 절제술').group, 'abdomen')
  assert.equal(classifySurgery('백내장 수정체 수술').group, 'eye')
  assert.equal(classifySurgery('알수없는처치').group, 'other')
  const d = summarizeByDisease(collectHrSections(result)).find((x) => x.disease === '요추 염좌')
  const surg = d.surgeries.find((x) => x.name === '요추 후방고정술')
  assert.equal(surg.bodyPart, '척추(요추)')
  assert.equal(surg.partGroup, 'spine')
})

test('정렬: 방문 많은 순', () => {
  const d = summarizeByDisease(collectHrSections(result))
  assert.ok(d[0].visitCount >= d[d.length - 1].visitCount)
})

test('연/월 그룹', () => {
  assert.equal(groupKeyOf('20260701', 'year'), '2026')
  assert.equal(groupKeyOf('20260701', 'month'), '2026.07')
  const rows = collectHrSections(result).basic
  const byYear = groupByDate(rows, (r) => String(r.resTreatStartDate).replace(/[^\d]/g, ''), 'year')
  assert.equal(byYear[0].key, '2026') // 내림차순
  assert.ok(byYear.some((g) => g.key === '2024'))
})

test('AI 비식별 요약: 이름/주민번호 없음 + 구조화', () => {
  const sec = collectHrSections(result)
  const ai = buildHrAiSummary(sec)
  const text = JSON.stringify(ai)
  assert.ok(!text.includes('resUserNm') && !/\d{6}-\d{7}/.test(text), '직접 식별자 없음')
  assert.equal(ai.totalVisits, 4)
  assert.ok(ai.diseases.some((x) => x.name === '요추 염좌' && x.surgeries.some((sgry) => sgry.includes('요추 후방고정술') && sgry.includes('척추'))))
  assert.ok(ai.periodFrom <= ai.periodTo)
  assert.match(ai.note, /추정/)
})
