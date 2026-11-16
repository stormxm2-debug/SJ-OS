import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-memo-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const m = await load('src/renderer/src/services/memo/memoModel.ts')
test('고정 메모가 먼저, 그다음 최근 수정 순', () => {
  const list = [
    { id: 'a', title: 'a', body: '', pinned: false, updatedAt: '2026-11-10T00:00:00Z' },
    { id: 'b', title: 'b', body: '', pinned: true, updatedAt: '2026-11-01T00:00:00Z' },
    { id: 'c', title: 'c', body: '', pinned: false, updatedAt: '2026-11-15T00:00:00Z' }
  ]
  assert.deepEqual(m.sortMemos(list).map((x) => x.id), ['b', 'c', 'a'])
  assert.equal(list[0].id, 'a', '원본 배열은 바뀌지 않음')
})
test('표시 제목: 제목 > 본문 첫 줄 > 빈 메모', () => {
  assert.equal(m.memoDisplayTitle({ title: ' 회의 ', body: '' }), '회의')
  assert.equal(m.memoDisplayTitle({ title: '', body: '\n\n첫 줄\n둘째' }), '첫 줄')
  assert.equal(m.memoDisplayTitle({ title: '', body: '  ' }), '빈 메모')
})
test('검색은 제목·본문을 대소문자 무시로 거른다', () => {
  const list = [
    { id: 'a', title: 'Hello', body: '', pinned: false, updatedAt: '' },
    { id: 'b', title: '', body: '장보기 우유', pinned: false, updatedAt: '' }
  ]
  assert.deepEqual(m.filterMemos(list, 'hello').map((x) => x.id), ['a'])
  assert.deepEqual(m.filterMemos(list, '우유').map((x) => x.id), ['b'])
  assert.equal(m.filterMemos(list, '   ').length, 2)
})
test('길이 검증', () => {
  assert.equal(m.validateMemo('a'.repeat(101), '').ok, false)
  assert.equal(m.validateMemo('', 'x'.repeat(10001)).ok, false)
  assert.equal(m.validateMemo('제목', '내용').ok, true)
})
