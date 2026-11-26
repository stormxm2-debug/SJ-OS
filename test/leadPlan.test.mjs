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
