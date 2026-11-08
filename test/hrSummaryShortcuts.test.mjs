import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

// 실제 RecentCareTable·ClaimRow·HealthRecordWorkspace(summary)를 정적 렌더해 숫자 카드 필터·입원 배지를 확인한다(합성 데이터, 네트워크 없음).
const entry = `
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import RecentCareTable from './src/renderer/src/components/health-record/RecentCareTable'
import HealthRecordWorkspace from './src/renderer/src/components/health-record/HealthRecordWorkspace'
import { ClaimRow } from './src/renderer/src/components/health-record/ClaimRecordList'
const noop = () => {}
export const renderList = (result, period, filter) => renderToStaticMarkup(h(RecentCareTable, { result, period, filter, onShowAll: noop, onClearFilter: noop }))
export const renderKpis = (result, period, summaryFilter) => renderToStaticMarkup(h(HealthRecordWorkspace, { result, period, mode: 'summary', onContextChange: noop, summaryFilter, onSummaryFilterChange: noop }))
export const renderClaim = (r) => renderToStaticMarkup(h('ul', null, h(ClaimRow, { r, status: 'unclaimed', ready: true, selected: false, selectDisabled: false, open: false, onSelect: noop, onToggle: noop })))
`
async function load() {
  const output = await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: resolve('.') },
    bundle: true, format: 'cjs', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  })
  const dir = await mkdtemp(join(tmpdir(), 'sj-hr-summary-')), file = join(dir, 'module.cjs')
  await writeFile(file, output.outputFiles[0].text)
  return createRequire(import.meta.url)(file)
}
const { renderList, renderKpis, renderClaim } = await load()

const base = { resHospitalName: '가상병원', resTreatType: '입원', resDiseaseName: '무릎 통증', resDiseaseCode: 'M25.56', resVisitDays: '3' }
const list = []
for (let i = 1; i <= 6; i++) list.push({ ...base, resTreatType: '외래', resTreatStartDate: `2026110${i}`, resHospitalName: `통원${i}병원` })
list.push({ ...base, resTreatStartDate: '20261020', resHospitalName: '입원미확인병원', resVisitDays: '' })
list.push({ ...base, resTreatStartDate: '20261019', resHospitalName: '입원수술병원', resVisitDays: '5' })
list.push({ ...base, resTreatType: '외래', resTreatStartDate: '20261018', resHospitalName: '외래수술병원' })
const result = {
  resBasicTreatList: list,
  resDetailTreatList: [
    { resTreatStartDate: '20261019', resHospitalName: '입원수술병원', resOperationName: '관절경 수술' },
    { resTreatStartDate: '20261018', resHospitalName: '외래수술병원', resOperationName: '봉합 수술' }],
  resPrescribeDrugList: [{ resTreatStartDate: '20261019', resHospitalName: '입원수술병원', resDrugName: '가상진통정', resTotalDosingdays: '3' }],
}
const rows = (html) => html.split('data-care-row').length - 1

test('입원 카드 필터: 7번째 이후 입원(일수 미확인 포함)이 목록에 보이고 제목·전체 진료 보기 표시', () => {
  const all = renderList(result, 'all', 'all')
  assert.equal(rows(all), 6) // 기본 6건 자르기
  assert.ok(!all.includes('입원미확인병원'))
  assert.ok(!all.includes('전체 진료 보기'))
  const inp = renderList(result, 'all', 'inpatient')
  assert.equal(rows(inp), 2)
  assert.ok(inp.includes('입원 기록') && inp.includes('전체 진료 보기'))
  assert.ok(inp.includes('입원미확인병원') && inp.includes('입원 · 일수 확인 필요'))
  assert.ok(inp.includes('입원 5일') && inp.includes('수술 추정')) // 입원+수술 두 배지
  assert.ok(!inp.includes('입원 0일'))
  assert.ok(!inp.includes('가상진통정')) // 약 이름은 기본 행에 없음
})
test('수술 카드 필터와 0건 안내: 조회 자료 범위 문구, 실제 없음 단정 없음', () => {
  const surg = renderList(result, 'all', 'surgery')
  assert.equal(rows(surg), 2)
  assert.ok(surg.includes('수술 추정 기록') && surg.includes('외래수술병원'))
  const outpatientOnly = { resBasicTreatList: list.slice(0, 6) }
  const empty = renderList(outpatientOnly, 'all', 'surgery')
  assert.equal(rows(empty), 0)
  assert.ok(empty.includes('선택한 기간에 조회된 수술 추정 기록이 없습니다.'))
  assert.ok(empty.includes('전체 진료 보기'))
  assert.ok(renderList(outpatientOnly, 'all', 'inpatient').includes('선택한 기간에 조회된 입원 기록이 없습니다.'))
})
test('숫자 카드: button+aria-pressed, 필터와 무관하게 기간 전체 집계 유지, 0건은 -', () => {
  const k = (html, label) => html.match(new RegExp(`<button[^>]*data-kpi="${label}"[^>]*>`))?.[0] ?? ''
  for (const f of ['all', 'inpatient', 'surgery']) {
    const html = renderKpis(result, 'all', f)
    assert.ok(html.includes('9건') && html.includes('약 5일') && html.includes('일수 미확인 1건') && html.includes('2회'), f)
    assert.match(k(html, '진료기록'), new RegExp(`aria-pressed="${f === 'all'}"`))
    assert.match(k(html, '입원일수'), new RegExp(`aria-pressed="${f === 'inpatient'}"`))
    assert.match(k(html, '수술 추정'), new RegExp(`aria-pressed="${f === 'surgery'}"`))
    assert.ok(!k(html, '입원일수').includes('disabled'))
  }
  const none = renderKpis({}, 'all', 'all')
  assert.ok(none.includes('0건') && none.includes('>-<') && !none.includes('0회'))
  // 입원일수 미확인만 있어도 카드는 누를 수 있다.
  const unknownOnly = renderKpis({ resBasicTreatList: [list[6]] }, 'all', 'all')
  assert.ok(unknownOnly.includes('확인 필요') && !k(unknownOnly, '입원일수').includes('disabled'))
})
test('청구 행: 입원 배지(일수/미확인)와 수술 배지 동시, 통원 행은 입원 배지 없음', () => {
  const r = (kind, admissionDays, surgery) => ({ key: JSON.stringify([kind, admissionDays]), date: '20261101', hospital: '가상병원', disease: '아주 긴 가상 병명 표기 예시 무릎 관절 연골 손상', code: 'M23', side: '왼쪽', kind, surgery, admissionDays, medications: [{ name: '가상약', ingredient: '', days: 3, flu: false }], procedures: [], selfPay: 0 })
  const both = renderClaim(r('입원', 4, true))
  assert.ok(both.includes('입원 4일') && both.includes('수술 추정') && both.includes('왼쪽') && both.includes('미청구'))
  assert.ok(!both.includes('가상약'))
  assert.ok(renderClaim(r('입원', null, false)).includes('입원 · 일수 확인 필요'))
  const out = renderClaim(r('통원', null, false))
  assert.ok(!out.includes('입원 ') && !out.includes('일수 확인 필요'))
  assert.ok(!renderClaim(r('확인 필요', null, false)).includes('입원 '))
})
