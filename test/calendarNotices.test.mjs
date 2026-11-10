import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-notice-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const n = await load('src/renderer/src/services/schedule/calendarNotices.ts')

const base = { pinned: false, priority: 'normal' }

test('날짜 없는 공지는 달력에 올리지 않음', () => {
  const a = { id: 'a', title: '날짜없음', ...base }
  assert.equal(n.noticeCoversDay(a, '2026-11-10'), false)
})

test('단일 날짜 공지는 그 날만 표시', () => {
  const a = { id: 'a', title: '회의', ...base, startDate: '2026-11-10' }
  assert.equal(n.noticeCoversDay(a, '2026-11-10'), true)
  assert.equal(n.noticeCoversDay(a, '2026-11-11'), false)
})

test('기간 공지는 시작~종료 모두 표시, 밖은 제외', () => {
  const a = { id: 'a', title: '행사', ...base, startDate: '2026-11-10', endDate: '2026-11-12' }
  assert.equal(n.noticeCoversDay(a, '2026-11-09'), false)
  assert.equal(n.noticeCoversDay(a, '2026-11-10'), true)
  assert.equal(n.noticeCoversDay(a, '2026-11-12'), true)
  assert.equal(n.noticeCoversDay(a, '2026-11-13'), false)
})

test('종료일이 시작일보다 앞이면 시작일 하루로 취급(역전 방어)', () => {
  const a = { id: 'a', title: '역전', ...base, startDate: '2026-11-10', endDate: '2026-11-01' }
  assert.equal(n.noticeCoversDay(a, '2026-11-10'), true)
  assert.equal(n.noticeCoversDay(a, '2026-11-01'), false)
})

test('같은 날 정렬: 긴급>중요>일반, 같으면 고정 우선, 그다음 최근 게시', () => {
  const list = [
    { id: 'normal-new', title: '', priority: 'normal', pinned: false, publishedAt: '2026-11-09T10:00:00Z' },
    { id: 'urgent', title: '', priority: 'urgent', pinned: false, publishedAt: '2026-11-01T10:00:00Z' },
    { id: 'important-pinned', title: '', priority: 'important', pinned: true, publishedAt: '2026-11-01T10:00:00Z' },
    { id: 'important-plain', title: '', priority: 'important', pinned: false, publishedAt: '2026-11-08T10:00:00Z' }
  ]
  assert.deepEqual(n.sortNoticesForDay(list).map((x) => x.id), ['urgent', 'important-pinned', 'important-plain', 'normal-new'])
})

test('noticesByDayKey: 보이는 날짜 칸에만 계산, 날짜 없는 공지 제외', () => {
  const list = [
    { id: 'a', title: '단일', ...base, startDate: '2026-11-10' },
    { id: 'b', title: '기간', ...base, startDate: '2026-11-09', endDate: '2026-11-11' },
    { id: 'c', title: '날짜없음', ...base }
  ]
  const m = n.noticesByDayKey(list, ['2026-11-09', '2026-11-10', '2026-11-11'])
  assert.deepEqual(m.get('2026-11-09').map((x) => x.id), ['b'])
  assert.deepEqual(m.get('2026-11-10').map((x) => x.id).sort(), ['a', 'b'])
  assert.equal(m.has('2026-11-12'), false)
  assert.equal(Array.from(m.values()).flat().some((x) => x.id === 'c'), false)
})

test('truncateTitle: 길면 말줄임, 짧으면 그대로', () => {
  assert.equal(n.truncateTitle('짧은 공지'), '짧은 공지')
  assert.equal(n.truncateTitle('가'.repeat(20), 14), '가'.repeat(14) + '…')
})
