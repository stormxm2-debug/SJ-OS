import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-lbl-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const l = await load('src/renderer/src/services/schedule/eventLabel.ts')
test('유형 · 장소 · 고객명', () => {
  assert.equal(l.buildEventChipLabel({ typeLabel: '2차만남', location: '화순', customerName: '정현숙' }), '2차만남 · 화순 · 정현숙')
})
test('장소가 없으면 생략', () => {
  assert.equal(l.buildEventChipLabel({ typeLabel: '2차만남', location: '', customerName: '정현숙' }), '2차만남 · 정현숙')
  assert.equal(l.buildEventChipLabel({ typeLabel: '2차만남', location: undefined, customerName: null }), '2차만남')
})
test('공백만 있는 값은 생략', () => {
  assert.equal(l.buildEventChipLabel({ typeLabel: 'AP', location: '   ', customerName: '  ' }), 'AP')
})
