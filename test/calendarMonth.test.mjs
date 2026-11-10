import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-cal-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const cal = await load('src/renderer/src/services/schedule/calendarMonth.ts')

test('kstDayKey: UTC→KST(+9) 날짜 키, 자정 경계 하루 밀림 없음', () => {
  // 2026-11-06 15:30Z = KST 2026-11-07 00:30 → 7일
  assert.equal(cal.kstDayKey('2026-11-06T15:30:00Z'), '2026-11-07')
  // 2026-11-06 14:59Z = KST 2026-11-06 23:59 → 여전히 6일
  assert.equal(cal.kstDayKey('2026-11-06T14:59:00Z'), '2026-11-06')
  // 자정 정각 KST
  assert.equal(cal.kstDayKey('2026-11-06T15:00:00Z'), '2026-11-07')
})

test('kstHm: KST 시:분', () => {
  assert.equal(cal.kstHm('2026-11-06T01:05:00Z'), '10:05') // +9h
  assert.equal(cal.kstHm('2026-11-06T15:00:00Z'), '00:00')
})

test('kstDayKey: 잘못된 입력은 빈 문자열', () => {
  assert.equal(cal.kstDayKey('not-a-date'), '')
  assert.equal(cal.kstDayKey(''), '')
})

test('monthMatrix: 42칸, 일요일 시작, 그 달 일수만 inMonth', () => {
  const m = cal.monthMatrix(2026, 10) // 2026년 11월(0-based 10), 30일
  assert.equal(m.length, 42)
  assert.equal(m[0].dow, 0, '첫 칸은 일요일')
  assert.equal(m[6].dow, 6, '7번째 칸은 토요일')
  assert.equal(m.filter((c) => c.inMonth).length, 30, '11월은 30일')
  const inMonth = m.filter((c) => c.inMonth)
  assert.equal(inMonth[0].d, 1)
  assert.equal(inMonth[inMonth.length - 1].d, 30)
  // 키 형식
  assert.match(m[0].key, /^\d{4}-\d{2}-\d{2}$/)
})

test('monthMatrix: 2월 윤년/평년', () => {
  assert.equal(cal.monthMatrix(2024, 1).filter((c) => c.inMonth).length, 29) // 2024 윤년
  assert.equal(cal.monthMatrix(2026, 1).filter((c) => c.inMonth).length, 28) // 2026 평년
})

test('shiftMonth: 연·월 경계 래핑', () => {
  assert.deepEqual(cal.shiftMonth(2026, 11, 1), { year: 2027, monthIndex0: 0 }) // 12월→다음해 1월
  assert.deepEqual(cal.shiftMonth(2026, 0, -1), { year: 2025, monthIndex0: 11 }) // 1월→전해 12월
  assert.deepEqual(cal.shiftMonth(2026, 5, 0), { year: 2026, monthIndex0: 5 })
})

test('groupByDay: KST 날짜 키로 묶음', () => {
  const items = [
    { id: 'a', at: '2026-11-06T15:30:00Z' }, // KST 11-07
    { id: 'b', at: '2026-11-06T14:00:00Z' }, // KST 11-06
    { id: 'c', at: '2026-11-06T23:00:00Z' }, // KST 11-07
    { id: 'd', at: 'bad' }
  ]
  const g = cal.groupByDay(items, (x) => x.at)
  assert.deepEqual(g.get('2026-11-07').map((x) => x.id).sort(), ['a', 'c'])
  assert.deepEqual(g.get('2026-11-06').map((x) => x.id), ['b'])
  assert.equal(g.has(''), false) // 잘못된 날짜는 제외
})
