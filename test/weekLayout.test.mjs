import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-week-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const w = await load('src/renderer/src/services/schedule/weekLayout.ts')

// KST 날짜 2026-11-10 의 시각을 UTC ISO 로 만든다 (KST = UTC+9)
const kst = (h, m = 0) => new Date(Date.UTC(2026, 10, 10, h - 9, m)).toISOString()

test('kstMinutes: KST 기준 분 계산', () => {
  assert.equal(w.kstMinutes(kst(10, 30)), 630)
  assert.equal(w.kstMinutes(kst(0, 0)), 0)
  assert.ok(Number.isNaN(w.kstMinutes('bad')))
})

test('위치: 시작 시각에 비례한 top, 기본 보기 07시 기준', () => {
  const [b] = w.layoutDay([{ id: 'a', title: '상담', startsAt: kst(10, 0), endsAt: kst(11, 0) }])
  // 10:00 - 07:00 = 180분 * 1.1 = 198px
  assert.equal(b.top, 198)
  // 60분 * 1.1 = 66px
  assert.equal(b.height, 66)
  assert.equal(b.startHm, '10:00')
  assert.equal(b.endHm, '11:00')
})

test('종료시각 없으면 60분 블록', () => {
  const [b] = w.layoutDay([{ id: 'a', title: 'x', startsAt: kst(9, 0), endsAt: null }])
  assert.equal(b.endHm, '10:00')
})

test('짧은 일정도 최소 높이 보장', () => {
  const [b] = w.layoutDay([{ id: 'a', title: 'x', startsAt: kst(9, 0), endsAt: kst(9, 5) }])
  assert.equal(b.height, 22)
})

test('겹치는 일정은 레인을 나눠 나란히 배치', () => {
  const blocks = w.layoutDay([
    { id: 'a', title: 'A', startsAt: kst(10, 0), endsAt: kst(11, 0) },
    { id: 'b', title: 'B', startsAt: kst(10, 30), endsAt: kst(11, 30) }
  ])
  const a = blocks.find((x) => x.id === 'a')
  const b = blocks.find((x) => x.id === 'b')
  assert.equal(a.lanes, 2)
  assert.equal(b.lanes, 2)
  assert.notEqual(a.lane, b.lane)
})

test('겹치지 않는 일정은 같은 레인 1개', () => {
  const blocks = w.layoutDay([
    { id: 'a', title: 'A', startsAt: kst(9, 0), endsAt: kst(10, 0) },
    { id: 'b', title: 'B', startsAt: kst(10, 0), endsAt: kst(11, 0) }
  ])
  assert.ok(blocks.every((x) => x.lanes === 1 && x.lane === 0))
})

test('보기 범위 밖 일정은 제외, 경계는 잘라서 표시', () => {
  const blocks = w.layoutDay(
    [
      { id: 'early', title: 'x', startsAt: kst(5, 0), endsAt: kst(6, 0) }, // 07시 이전 전부 → 제외
      { id: 'cross', title: 'y', startsAt: kst(6, 30), endsAt: kst(8, 0) } // 07시 걸침 → 잘림
    ],
    { startHour: 7, endHour: 22 }
  )
  assert.equal(blocks.find((x) => x.id === 'early'), undefined)
  const cross = blocks.find((x) => x.id === 'cross')
  assert.equal(cross.top, 0) // 07:00 부터 시작으로 잘림
})

test('gridHeight: 보기 범위 전체 높이', () => {
  assert.equal(w.gridHeight({ startHour: 7, endHour: 22 }), Math.round(15 * 60 * 1.1))
})
