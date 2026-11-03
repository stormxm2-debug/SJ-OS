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
const { collectHrSections, summarizeByDisease, summarizeEpisodes, EPISODE_GAP_DAYS, groupByDate, groupKeyOf, normalizeDisease, buildHrAiSummary, buildHighlights, diseaseFlags, FREQUENT_VISIT_THRESHOLD, classifySurgery, isTrivialProcedure, sequelaeFor, looksSurgery, groupSurgeryOccasions, sequelaeForSurgery } = m

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

test('에피소드 묶음: 같은 병명+근접 날짜는 하나로, 멀면 분리', () => {
  assert.equal(EPISODE_GAP_DAYS, 30)
  const eps = summarizeEpisodes(collectHrSections(result))
  // 요추 염좌: 20260616·20260701(15일) → 1 에피소드(입원 2회, 후방고정술 포함)
  const back = eps.filter((e) => e.disease === '요추 염좌')
  assert.equal(back.length, 1, '근접(15일) 방문은 한 에피소드')
  assert.equal(back[0].visitCount, 2)
  assert.equal(back[0].inpatient, true)
  assert.equal(back[0].firstDate, '20260616')
  assert.equal(back[0].lastDate, '20260701')
  assert.ok(back[0].surgeries.some((x) => x.name === '요추 후방고정술' && x.isSurgery))
  assert.ok(back[0].visits.length === 2 && back[0].visits[0].date <= back[0].visits[1].date, '방문은 날짜 오름차순')
  // 위염: 20250923·20240101(1년 이상) → 2 에피소드로 분리
  const gastritis = eps.filter((e) => e.disease === '위염')
  assert.equal(gastritis.length, 2, '멀리 떨어진 방문은 별도 에피소드')
  // 최근 에피소드가 먼저(내림차순)
  assert.ok(Number(eps[0].lastDate) >= Number(eps[eps.length - 1].lastDate))

  // 임계 30일 경계: 31일 간격이면 분리
  const gapTest = summarizeEpisodes(collectHrSections({
    resBasicTreatList: [
      { resTreatStartDate: '20250101', resHospitalName: 'A', resTreatType: '외래', resDiseaseName: '감기' },
      { resTreatStartDate: '20250201', resHospitalName: 'A', resTreatType: '외래', resDiseaseName: '감기' }
    ]
  }))
  assert.equal(gapTest.filter((e) => e.disease === '감기').length, 2, '31일 간격은 분리')
})

test('단순 처치 판별 + 부위별 후유장해 참고표', () => {
  // 단순 처치(수술 아님)
  assert.equal(isTrivialProcedure('물리치료'), true)
  assert.equal(isTrivialProcedure('도수치료'), true)
  assert.equal(isTrivialProcedure('근육내 주사'), true)
  assert.equal(isTrivialProcedure('혈액 검사'), true)
  // 수술은 단순 처치가 아님(수술 우선)
  assert.equal(isTrivialProcedure('요추 후방고정술'), false)
  assert.equal(isTrivialProcedure('담낭 절제술'), false)
  // 후유장해 참고표: 부위별로 위험·보험 포인트 존재, other 폴백
  const spine = sequelaeFor('spine')
  assert.ok(Array.isArray(spine.risks) && spine.risks.length > 0)
  assert.match(spine.insurancePoint, /척추/)
  assert.ok(sequelaeFor('other').risks.length > 0)
})

test('수술 판별 강화: 석고고정·도수정복은 수술 아님', () => {
  assert.equal(looksSurgery('석고 고정', '처치'), false)
  assert.equal(looksSurgery('도수 정복', '처치'), false)
  assert.equal(looksSurgery('드레싱', '처치'), false)
  assert.equal(looksSurgery('마취', '수술'), false, '마취는 수술 수가여도 수술 아님')
  assert.equal(looksSurgery('족관절 골절 관혈적 정복술 및 내고정술', '수술'), true)
  assert.equal(looksSurgery('복강경 담낭 절제술', '수술'), true)
})

test('수술 occasion 묶음: 같은 날·기관 여러 줄 → 1회(발목 수술 과다집계 방지)', () => {
  const res = {
    resBasicTreatList: [{ resTreatStartDate: '20250310', resHospitalName: '튼튼정형외과', resTreatType: '입원', resDiseaseName: '발목 골절' }],
    resDetailTreatList: [
      { resTreatStartDate: '20250310', resHospitalName: '튼튼정형외과', resTreatType: '수술', resCodeName: '족관절 골절 관혈적 정복술 및 내고정술' },
      { resTreatStartDate: '20250310', resHospitalName: '튼튼정형외과', resTreatType: '수술', resCodeName: '금속판 고정' },
      { resTreatStartDate: '20250310', resHospitalName: '튼튼정형외과', resTreatType: '처치', resCodeName: '석고 고정' },
      { resTreatStartDate: '20250310', resHospitalName: '튼튼정형외과', resTreatType: '처치', resCodeName: '마취' },
      { resTreatStartDate: '20250310', resHospitalName: '튼튼정형외과', resTreatType: '처치', resCodeName: '드레싱' }
    ]
  }
  const d = summarizeByDisease(collectHrSections(res)).find((x) => x.disease === '발목 골절')
  const occ = groupSurgeryOccasions(d.surgeries)
  assert.equal(occ.length, 1, '같은 날 수술은 1회로 묶임')
  assert.ok(!d.surgeries.some((x) => x.isSurgery && /석고|마취|드레싱/.test(x.name)), '단순 처치는 수술 아님')
  assert.equal(occ[0].partGroup, 'foot')
  assert.ok(/정복술|고정술/.test(occ[0].primaryName))
  // 하이라이트 수술 건수도 1(occasion 기준)
  assert.equal(buildHighlights(collectHrSections(res)).surgeryCount, 1)
})

test('수술명별 세부 후유장해 + 부위 폴백', () => {
  const a = sequelaeForSurgery('요추 후방고정술', 'spine')
  assert.match(a.label, /척추/)
  assert.ok(a.seq.risks.length > 0 && /척추/.test(a.seq.insurancePoint))
  const b = sequelaeForSurgery('복강경 담낭 절제술', 'abdomen')
  assert.match(b.label, /담낭/)
  const c = sequelaeForSurgery('기타 특수 수술', 'knee') // 특정 규칙 없음 → 부위 폴백
  assert.equal(c.label, undefined)
  assert.ok(c.seq.risks.length > 0)
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
