import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-menu-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const mv = await load('src/renderer/src/navigation/menuVisibility.ts')

test('요청한 항목만 요청한 순서대로 남긴다', () => {
  const all = [
    { key: 'devprompt' }, { key: 'jarvis' }, { key: 'customer' }, { key: 'staff-home' }, { key: 'memo' }, { key: 'schedule' }
  ]
  assert.deepEqual(mv.pickVisibleMenuItems(all).map((x) => x.key), ['staff-home', 'schedule', 'customer', 'jarvis'])
})
test('목록에 없는 항목(개발 도구·메모장 등)은 빠진다', () => {
  const out = mv.pickVisibleMenuItems([{ key: 'devprompt' }, { key: 'content-board' }, { key: 'memo' }]).map((x) => x.key)
  assert.deepEqual(out, [])
})
test('같은 키가 두 번 있으면 첫 번째만 남는다', () => {
  const out = mv.pickVisibleMenuItems([{ key: 'customer', n: 1 }, { key: 'customer', n: 2 }])
  assert.equal(out.length, 1)
  assert.equal(out[0].n, 1)
})
test('표시 목록에 요청한 10개 항목이 모두 있다', () => {
  for (const k of ['staff-home','attendance','schedule','customer','family-caregiver','bojang114','performance','notice','health-record','jarvis']) {
    assert.ok(mv.VISIBLE_MENU_KEYS.includes(k), k)
  }
  assert.equal(mv.VISIBLE_MENU_KEYS.length, 10)
})

test('전체 메뉴 칸에는 표시 목록 밖의 항목이 모두 들어간다 (중복 없이)', () => {
  const all = [{ key: 'staff-home' }, { key: 'devprompt' }, { key: 'customer' }, { key: 'memo' }, { key: 'memo' }, { key: 'jarvis' }]
  const hidden = mv.pickHiddenMenuItems(all).map((x) => x.key)
  assert.deepEqual(hidden, ['devprompt', 'memo'])
  // 보이는 것 + 숨긴 것 = 전체(중복 제외)
  const shown = mv.pickVisibleMenuItems(all).map((x) => x.key)
  assert.equal(new Set([...shown, ...hidden]).size, 5)
})
