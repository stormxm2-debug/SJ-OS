import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-tc-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const tc = await load('src/renderer/src/services/schedule/typeColors.ts')
test('만남 계열(1·2·3차, 만남, 소개만남)은 같은 파랑', () => {
  const m = tc.typeStyle('meeting').bg
  for (const t of ['meeting-1', 'meeting-2', 'meeting-3', 'intro-meeting']) assert.equal(tc.typeStyle(t).bg, m)
  assert.notEqual(m, tc.typeStyle('closing').bg)
})
test('만남 유형은 중립 회색이 아니다', () => {
  assert.notEqual(tc.typeStyle('meeting').bg, '#f8fafc')
  assert.notEqual(tc.typeStyle('meeting').bg, '#f1f5f9')
})
test('유형별 색이 서로 다르다(만남/클로징/AP/증전)', () => {
  const bgs = ['meeting', 'closing', 'ap', 'delivery'].map((t) => tc.typeStyle(t).bg)
  assert.equal(new Set(bgs).size, 4)
})
test('알 수 없는/구버전 유형은 중립색', () => {
  assert.equal(tc.typeStyle('consultation').bg, '#f8fafc')
  assert.equal(tc.typeStyle(undefined).bg, '#f8fafc')
})
