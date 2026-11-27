import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-lead-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const lp = await load('src/renderer/src/services/commercial/leadPlan.ts')
const rows = (n) => Array.from({ length: n }, (_, i) => ({ name: `고객${i + 1}`, phone: `010-1000-${String(1000 + i)}` }))

test('시·도를 줄임말로 맞춘다', () => {
  assert.equal(lp.normalizeRegion('광주 광산구 ○○동'), '광주')
  assert.equal(lp.normalizeRegion('전라남도 화순군'), '전남')
  assert.equal(lp.normalizeRegion('경기도 수원시'), '경기')
  assert.equal(lp.normalizeRegion(''), '')
})

test('메모에서 지역 열을 찾는다', () => {
  assert.equal(lp.regionOfLead({ name: 'a', memo: '나이: 52 / 지역: 광주 서구' }), '광주')
  assert.equal(lp.regionOfLead({ name: 'a', memo: '주소: 서울특별시 강남구' }), '서울')
  assert.equal(lp.regionOfLead({ name: 'a', memo: '나이: 52' }), '')
  assert.equal(lp.regionOfLead({ name: 'a' }), '')
})

test('분석 요약: 건수·전화 형식·지역 분포', () => {
  const a = lp.analyzeLeads([
    { name: 'a', phone: '010-1111-2222', memo: '지역: 광주' },
    { name: 'b', phone: '010-1111-3333', memo: '지역: 광주 북구' },
    { name: 'c', phone: '02-123-4567', memo: '지역: 서울' },
    { name: 'd', memo: '나이: 40' }
  ])
  assert.equal(a.total, 4)
  assert.equal(a.withPhone, 3)
  assert.equal(a.invalidPhone, 2)
  assert.deepEqual(a.regions, [{ region: '광주', count: 2 }, { region: '서울', count: 1 }])
  assert.equal(a.noRegion, 1)
})

test('균등 분할은 나머지를 앞사람부터 나눈다', () => {
  assert.deepEqual(lp.equalCounts(10, ['a', 'b', 'c']), { a: 4, b: 3, c: 3 })
  assert.deepEqual(lp.equalCounts(2, ['a', 'b', 'c']), { a: 1, b: 1, c: 0 })
  assert.deepEqual(lp.equalCounts(5, []), {})
})

test('입력칸 값은 0 이상 정수로만 읽는다', () => {
  assert.equal(lp.toCount('12'), 12)
  assert.equal(lp.toCount(' 3.9 '), 3)
  assert.equal(lp.toCount('-5'), 0)
  assert.equal(lp.toCount('abc'), 0)
  assert.equal(lp.toCount(''), 0)
  assert.equal(lp.toCount(undefined), 0)
})

test('개수 지정: 파일 순서대로 잘라 주고 남는 건은 미배정', () => {
  const r = rows(10)
  const p = lp.planByCounts(r, ['a', 'b', 'c'], { a: '3', b: '4', c: '' })
  assert.equal(p.ok, true)
  assert.deepEqual(p.groups.map((g) => [g.fcId, g.rows.length]), [['a', 3], ['b', 4]])
  assert.equal(p.groups[0].rows[0].name, '고객1')
  assert.equal(p.groups[1].rows[0].name, '고객4')
  assert.equal(p.leftover.length, 3)
  assert.equal(p.leftover[0].name, '고객8')
})

test('개수 지정: 합계 초과·빈 입력·빈 DB는 막는다', () => {
  assert.equal(lp.planByCounts(rows(5), ['a', 'b'], { a: 3, b: 3 }).ok, false)
  assert.equal(lp.planByCounts(rows(5), ['a', 'b'], {}).ok, false)
  assert.equal(lp.planByCounts([], ['a'], { a: 1 }).ok, false)
})

test('개수 지정: 전부 배정하면 남는 건이 없다', () => {
  const p = lp.planByCounts(rows(6), ['a', 'b'], { a: 2, b: 4 })
  assert.equal(p.ok, true)
  assert.equal(p.leftover.length, 0)
})

const reg = (name, region) => ({ name, phone: '010-0000-0000', memo: region ? `지역: ${region}` : '나이: 40' })

test('지역별 배정: 담당 FC에게 번갈아 주고, 담당 없는 지역·지역 없는 행은 미배정', () => {
  const r = [reg('a', '광주'), reg('b', '광주'), reg('c', '광주'), reg('d', '광주'), reg('e', '서울'), reg('f', ''), reg('g', '부산')]
  const p = lp.planByRegion(r, { 광주: ['x', 'y'], 서울: ['z'] })
  assert.equal(p.ok, true)
  const by = Object.fromEntries(p.groups.map((g) => [g.fcId, g.rows.map((x) => x.name)]))
  assert.deepEqual(by.x, ['a', 'c'])
  assert.deepEqual(by.y, ['b', 'd'])
  assert.deepEqual(by.z, ['e'])
  assert.deepEqual(p.leftover.map((x) => x.name), ['f', 'g'])
})

test('지역별 배정: FC당 상한을 넘으면 미배정으로 남긴다', () => {
  const r = [reg('a', '광주'), reg('b', '광주'), reg('c', '광주'), reg('d', '광주')]
  const p = lp.planByRegion(r, { 광주: ['x', 'y'] }, 1)
  assert.equal(p.ok, true)
  assert.equal(p.groups.reduce((n, g) => n + g.rows.length, 0), 2)
  assert.equal(p.leftover.length, 2)
})

test('지역별 배정: 같은 FC가 여러 지역을 맡아도 상한은 합산', () => {
  const r = [reg('a', '광주'), reg('b', '서울'), reg('c', '서울')]
  const p = lp.planByRegion(r, { 광주: ['x'], 서울: ['x'] }, 2)
  assert.equal(p.groups[0].rows.length, 2)
  assert.equal(p.leftover.length, 1)
})

test('지역별 배정: 담당 FC를 하나도 안 정했거나 해당 DB가 없으면 막는다', () => {
  assert.equal(lp.planByRegion([reg('a', '광주')], {}).ok, false)
  assert.equal(lp.planByRegion([reg('a', '광주')], { 광주: [] }).ok, false)
  assert.equal(lp.planByRegion([reg('a', '부산')], { 광주: ['x'] }).ok, false)
  assert.equal(lp.planByRegion([], { 광주: ['x'] }).ok, false)
})

const sm = await load('src/renderer/src/services/commercial/leadSummary.ts')

test('요약: 직원별 건수 내림차순·비율, 합계에 미배정 포함', () => {
  const s = sm.buildSummary({
    dbType: '실버DB',
    mode: 'region',
    groups: [{ name: '김FC', count: 20 }, { name: '이FC', count: 30 }, { name: '박FC', count: 0 }],
    unassigned: 10,
    regions: [{ region: '광주', count: 40 }, { region: '서울', count: 20 }],
    at: new Date(2026, 10, 26, 9, 5)
  })
  assert.equal(s.total, 60)
  assert.equal(s.assigned, 50)
  assert.equal(s.unassigned, 10)
  assert.deepEqual(s.groups.map((g) => [g.name, g.count, g.pct]), [['이FC', 30, 60], ['김FC', 20, 40]])
  assert.equal(s.subtitle, '2026.11.26 09:05 · [실버DB] · 지역별 FC 배정')
  assert.equal(s.regionsRest, 0)
})

test('요약: 지역이 9개 넘으면 나머지는 합계로', () => {
  const regions = Array.from({ length: 10 }, (_, i) => ({ region: `지역${i}`, count: 10 - i }))
  const s = sm.buildSummary({ mode: 'auto', groups: [{ name: 'a', count: 1 }], unassigned: 0, regions })
  assert.equal(s.regions.length, 8)
  assert.equal(s.regionsRest, 2 + 1)
})

test('요약: 이미지 높이는 항목 수에 따라 늘어난다', () => {
  const a = sm.buildSummary({ mode: 'auto', groups: [{ name: 'a', count: 1 }], unassigned: 0, regions: [] })
  const b = sm.buildSummary({ mode: 'auto', groups: [{ name: 'a', count: 1 }, { name: 'b', count: 1 }], unassigned: 0, regions: [{ region: '광주', count: 2 }] })
  assert.ok(sm.summaryHeight(b) > sm.summaryHeight(a))
})

test('시·군·구 단위: 전남 화순군 / 광주 광산구', () => {
  assert.equal(lp.regionFromText('전라남도 화순군 화순읍 ○○로 1', 'sigungu'), '전남 화순군')
  assert.equal(lp.regionFromText('전남 나주시 빛가람동', 'sigungu'), '전남 나주시')
  assert.equal(lp.regionFromText('광주광역시 광산구 ○○동', 'sigungu'), '광주 광산구')
  assert.equal(lp.regionFromText('광주 서구', 'sigungu'), '광주 서구')
  assert.equal(lp.regionFromText('전라남도 화순군', 'sido'), '전남')
})

test('시·군·구를 못 찾으면 시·도만 돌려준다', () => {
  assert.equal(lp.regionFromText('전남', 'sigungu'), '전남')
  assert.equal(lp.regionFromText('', 'sigungu'), '')
})

test('분석·배정이 시·군·구 단위로 나뉜다', () => {
  const r = [reg('a', '전라남도 화순군'), reg('b', '전남 화순군 한천면'), reg('c', '전라남도 나주시'), reg('d', '전라남도')]
  const a = lp.analyzeLeads(r, 'sigungu')
  assert.deepEqual(a.regions, [{ region: '전남 화순군', count: 2 }, { region: '전남 나주시', count: 1 }, { region: '전남', count: 1 }])
  const p = lp.planByRegion(r, { '전남 화순군': ['x'], '전남 나주시': ['y'] }, undefined, 'sigungu')
  assert.equal(p.ok, true)
  const by = Object.fromEntries(p.groups.map((g) => [g.fcId, g.rows.map((x) => x.name)]))
  assert.deepEqual(by.x, ['a', 'b'])
  assert.deepEqual(by.y, ['c'])
  assert.deepEqual(p.leftover.map((x) => x.name), ['d'])
  // 시·도 단위로 보면 전부 전남 한 지역
  assert.deepEqual(lp.analyzeLeads(r, 'sido').regions, [{ region: '전남', count: 4 }])
})

test('시도·시군구가 따로 있는 파일도 읽는다', () => {
  const l = { name: 'a', memo: '시도: 전남 / 시군구: 나주시 / 나이: 50' }
  assert.equal(lp.regionOfLead(l, 'sigungu'), '전남 나주시')
  assert.equal(lp.regionOfLead(l, 'sido'), '전남')
  const l2 = { name: 'b', memo: '시도: 전라남도 / 시군구: 화순군 / 주소: 전라남도 화순군 화순읍 ○○로 1' }
  assert.equal(lp.regionOfLead(l2, 'sigungu'), '전남 화순군')
})

test('주소 앞 우편번호는 무시한다', () => {
  assert.equal(lp.regionFromText('(58100) 전라남도 화순군 화순읍', 'sigungu'), '전남 화순군')
  assert.equal(lp.regionFromText('58100 광주 광산구', 'sigungu'), '광주 광산구')
})

test('전남의 여러 시·군이 각각 따로 나뉜다', () => {
  const rows = ['화순군', '나주시', '목포시', '여수시', '순천시', '담양군', '곡성군', '화순군'].map((g, i) => reg(`고객${i}`, `전라남도 ${g} ○○`))
  const a = lp.analyzeLeads(rows, 'sigungu')
  assert.equal(a.regions.length, 7)
  assert.deepEqual(a.regions[0], { region: '전남 화순군', count: 2 })
})

test('기존 고객 위치: 지역마다 고객이 많은 FC 순서', () => {
  const rows = [
    { fcId: 'x', address: '전라남도 화순군 화순읍 1' },
    { fcId: 'x', address: '전남 화순군 한천면' },
    { fcId: 'y', address: '전라남도 화순군 능주면' },
    { fcId: 'y', address: '전라남도 나주시 빛가람동' },
    { fcId: 'y', address: '(58100) 전라남도 나주시 ○○' },
    { fcId: 'z', address: '' },
    { fcId: '', address: '전남 담양군' }
  ]
  const aff = lp.customerAffinity(rows, 'sigungu')
  assert.deepEqual(aff['전남 화순군'], [{ fcId: 'x', count: 2 }, { fcId: 'y', count: 1 }])
  assert.deepEqual(aff['전남 나주시'], [{ fcId: 'y', count: 2 }])
  assert.equal(aff['전남 담양군'], undefined)
})

test('기존 고객 기준 상위 n명은 허용된 FC만, 없으면 빈 배열', () => {
  const aff = { '전남 화순군': [{ fcId: 'x', count: 3 }, { fcId: 'q', count: 2 }, { fcId: 'y', count: 1 }] }
  assert.deepEqual(lp.affinityTop(aff, ['전남 화순군', '전남 곡성군'], ['x', 'y'], 1), { '전남 화순군': ['x'], '전남 곡성군': [] })
  assert.deepEqual(lp.affinityTop(aff, ['전남 화순군'], ['x', 'y'], 3)['전남 화순군'], ['x', 'y'])
})

const sh = await load('src/renderer/src/services/commercial/leadSheets.ts')
const lead = (o) => ({ id: o.id ?? Math.random().toString(36).slice(2), name: 'n', phone: null, source: null, memo: null, status: 'new', dbType: null, vendor: null, assignedFcId: null, assignedFcName: null, assignedAt: null, firstCallAt: null, createdAt: '2026-11-26T00:00:00Z', ...o })

test('시트: 상태를 미콜·진행·계약·종료로 묶는다', () => {
  assert.equal(sh.bucketOf('new'), 'new')
  assert.equal(sh.bucketOf('called'), 'working')
  assert.equal(sh.bucketOf('appointment'), 'working')
  assert.equal(sh.bucketOf('contracted'), 'won')
  assert.equal(sh.bucketOf('rejected'), 'closed')
  assert.equal(sh.bucketOf('invalid'), 'closed')
})

test('시트: 요약과 FC별 개수(많은 순, 미배정은 마지막)', () => {
  const ls = [
    lead({ assignedFcId: 'a', assignedFcName: '김FC', status: 'new' }),
    lead({ assignedFcId: 'a', assignedFcName: '김FC', status: 'contracted' }),
    lead({ assignedFcId: 'b', assignedFcName: '이FC', status: 'called' }),
    lead({ assignedFcId: 'b', assignedFcName: '이FC', status: 'new' }),
    lead({ assignedFcId: 'b', assignedFcName: '이FC', status: 'rejected' }),
    lead({})
  ]
  const s = sh.summarize(ls)
  assert.equal(s.total, 6)
  assert.equal(s.assigned, 5)
  assert.equal(s.unassigned, 1)
  assert.equal(s.uncalled, 3)
  assert.equal(s.won, 1)
  const rows = sh.fcRows(ls)
  assert.deepEqual(rows.map((r) => [r.name, r.total]), [['이FC', 3], ['김FC', 2], ['(미배정)', 1]])
  assert.equal(rows[0].uncalled, 1)
  assert.equal(rows[0].closed, 1)
})

test('시트: 업체 탭은 등록 업체(0건 포함) → 데이터에만 있는 업체 → 미지정', () => {
  const ls = [lead({ vendor: 'B사' }), lead({ vendor: 'B사' }), lead({ vendor: 'C사' }), lead({ vendor: null })]
  const tabs = sh.vendorTabs(ls, ['A사', 'B사'])
  assert.deepEqual(tabs, [
    { name: 'A사', count: 0 },
    { name: 'B사', count: 2 },
    { name: 'C사', count: 1 },
    { name: '(업체 미지정)', count: 1 }
  ])
})

test('시트: 엑셀 시트 이름은 금지 문자를 빼고 31자·중복을 피한다', () => {
  const used = new Set()
  assert.equal(sh.sheetName('A/B:C?', used), 'A B C')
  assert.equal(sh.sheetName('a b c', used), 'a b c (2)')
  const long = sh.sheetName('가'.repeat(40), used)
  assert.equal(long.length, 31)
})

test('지역별 개수: 입력한 개수만큼만 파일 순서대로 배정하고 나머지는 남는다', () => {
  const r = [reg('a', '광주'), reg('b', '광주'), reg('c', '광주'), reg('d', '서울'), reg('e', '서울')]
  const p = lp.planByRegion(r, { 광주: ['x'], 서울: ['y'] }, undefined, 'sido', { 광주: 2 })
  assert.equal(p.ok, true)
  const by = Object.fromEntries(p.groups.map((g) => [g.fcId, g.rows.map((x) => x.name)]))
  assert.deepEqual(by.x, ['a', 'b'])
  assert.deepEqual(by.y, ['d', 'e'])
  assert.deepEqual(p.leftover.map((x) => x.name), ['c'])
  assert.deepEqual(p.byRegion.find((x) => x.region === '광주'), { region: '광주', total: 3, assigned: 2 })
  assert.deepEqual(p.byRegion.find((x) => x.region === '서울'), { region: '서울', total: 2, assigned: 2 })
})

test('지역별 개수: 0을 넣으면 그 지역은 이번에 배정하지 않는다', () => {
  const r = [reg('a', '광주'), reg('b', '서울')]
  const p = lp.planByRegion(r, { 광주: ['x'], 서울: ['y'] }, undefined, 'sido', { 광주: 0 })
  assert.equal(p.ok, true)
  assert.deepEqual(p.groups.map((g) => g.fcId), ['y'])
  assert.deepEqual(p.leftover.map((x) => x.name), ['a'])
})

test('지역별 개수: 전부 0이면 막고, 지역 없는 행은 (지역 없음)으로 센다', () => {
  const r = [reg('a', '광주'), reg('b', '')]
  assert.equal(lp.planByRegion(r, { 광주: ['x'] }, undefined, 'sido', { 광주: 0 }).ok, false)
  const p = lp.planByRegion(r, { 광주: ['x'] })
  assert.deepEqual(p.byRegion.find((x) => x.region === '(지역 없음)'), { region: '(지역 없음)', total: 1, assigned: 0 })
})
