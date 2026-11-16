import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-desk-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const d = await load('src/renderer/src/services/content/opsDesk.ts')
const mk = (status, scheduledAt) => ({ id: Math.random().toString(), title: 't', body: '', platforms: [], status, scheduledAt, updatedAt: '' })
test('역할 7명이 고정 순서로 나온다', () => {
  const s = d.buildDeskStages([], new Date('2026-11-16T03:00:00Z'))
  assert.deepEqual(s.map((x) => x.label), ['리서처', '훅 라이터', '대본 라이터', '디자이너', '분석가', '매니저', '퍼블리셔'])
})
test('콘텐츠가 없으면 모두 대기(깜빡임 없음)', () => {
  const s = d.buildDeskStages([], new Date('2026-11-16T03:00:00Z'))
  assert.ok(s.every((x) => x.count === 0 && !x.active))
})
test('상태에 따라 담당 역할이 움직인다', () => {
  const items = [mk('idea'), mk('drafting'), mk('published'), mk('scheduled', '2026-11-16T05:00:00Z')]
  const s = d.buildDeskStages(items, new Date('2026-11-16T03:00:00Z'))
  const by = Object.fromEntries(s.map((x) => [x.key, x]))
  assert.equal(by.researcher.count, 1)
  assert.equal(by.script.count, 1)
  assert.equal(by.analyst.count, 1)
  assert.equal(by.publisher.count, 1)
  assert.match(by.publisher.hint, /오늘 게시 1건/)
})
test('날짜 미정 예약은 매니저 할 일로 표시', () => {
  const s = d.buildDeskStages([mk('scheduled')], new Date('2026-11-16T03:00:00Z'))
  assert.match(s.find((x) => x.key === 'manager').hint, /날짜 미정 1건/)
})
test('파이프라인 단계별 개수', () => {
  const c = d.pipelineCounts([mk('idea'), mk('idea'), mk('published')])
  assert.deepEqual(c, { idea: 2, drafting: 0, scheduled: 0, published: 1 })
})
