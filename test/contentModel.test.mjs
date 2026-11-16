import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-content-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const m = await load('src/renderer/src/services/content/contentModel.ts')
test('검증: 제목 필수, 상태·플랫폼·시각 형식', () => {
  assert.equal(m.validateContent({ title: ' ', body: '', platforms: [], status: 'idea' }).ok, false)
  assert.equal(m.validateContent({ title: '제목', body: '', platforms: ['bogus'], status: 'idea' }).ok, false)
  assert.equal(m.validateContent({ title: '제목', body: '', platforms: [], status: 'nope' }).ok, false)
  assert.equal(m.validateContent({ title: '제목', body: '', platforms: [], status: 'idea', scheduledAt: 'x' }).ok, false)
  assert.equal(m.validateContent({ title: '제목', body: '본문', platforms: ['instagram_reels', 'youtube_shorts'], status: 'scheduled', scheduledAt: '2026-11-20T10:00:00Z' }).ok, true)
})
test('정렬: 예약 시각 빠른 순, 날짜 미정은 뒤', () => {
  const list = [
    { id: 'none', title: '', body: '', platforms: [], status: 'idea', updatedAt: '2026-11-01T00:00:00Z' },
    { id: 'late', title: '', body: '', platforms: [], status: 'scheduled', scheduledAt: '2026-11-25T00:00:00Z', updatedAt: '' },
    { id: 'early', title: '', body: '', platforms: [], status: 'scheduled', scheduledAt: '2026-11-20T00:00:00Z', updatedAt: '' }
  ]
  assert.deepEqual(m.sortByScheduled(list).map((x) => x.id), ['early', 'late', 'none'])
  assert.equal(list[0].id, 'none', '원본 유지')
})
test('상태별 개수', () => {
  const list = [{ status: 'idea' }, { status: 'idea' }, { status: 'published' }].map((x) => ({ id: '', title: '', body: '', platforms: [], updatedAt: '', ...x }))
  assert.deepEqual(m.countByStatus(list), { idea: 2, drafting: 0, scheduled: 0, published: 1 })
})
test('플랫폼에 인스타 릴스·유튜브 쇼츠 포함', () => {
  assert.ok(m.PLATFORMS.includes('instagram_reels'))
  assert.ok(m.PLATFORMS.includes('youtube_shorts'))
})
