import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-evlist-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const st = await load('src/renderer/src/services/schedule/eventListState.ts')

test('저장 직후 일정이 목록에 바로 포함된다 (재조회 전)', () => {
  const before = [{ id: 'a', startsAt: '2026-11-09T01:00:00Z' }]
  const saved = { id: 'new', startsAt: '2026-11-10T01:00:00Z' }
  const after = st.upsertScheduleEvent(before, saved)
  assert.equal(st.containsEvent(after, 'new'), true)
  assert.equal(after.length, 2)
})

test('같은 id 는 중복되지 않고 교체된다 (수정 저장)', () => {
  const list = [{ id: 'a', startsAt: '2026-11-10T01:00:00Z', title: '이전' }]
  const after = st.upsertScheduleEvent(list, { id: 'a', startsAt: '2026-11-10T02:00:00Z', title: '새 제목' })
  assert.equal(after.length, 1)
  assert.equal(after[0].title, '새 제목')
})

test('목록은 시작 시각 순으로 정렬된다', () => {
  const list = [
    { id: 'late', startsAt: '2026-11-10T05:00:00Z' },
    { id: 'early', startsAt: '2026-11-10T01:00:00Z' }
  ]
  const after = st.upsertScheduleEvent(list, { id: 'mid', startsAt: '2026-11-10T03:00:00Z' })
  assert.deepEqual(after.map((x) => x.id), ['early', 'mid', 'late'])
})

test('upsert 는 입력 배열을 바꾸지 않는다(불변)', () => {
  const list = [{ id: 'a', startsAt: '2026-11-10T01:00:00Z' }]
  const copy = JSON.stringify(list)
  st.upsertScheduleEvent(list, { id: 'b', startsAt: '2026-11-10T02:00:00Z' })
  assert.equal(JSON.stringify(list), copy)
})
