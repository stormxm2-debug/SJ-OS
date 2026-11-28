import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-nav-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const nav = await load('src/renderer/src/navigation/deepLink.ts')

test('parseInitialView: ?view=schedule → 일정 화면', () => {
  assert.deepEqual(nav.parseInitialView('?view=schedule'), { name: 'schedule' })
})
test('parseInitialView: 안전 목록의 다른 화면도 허용', () => {
  assert.deepEqual(nav.parseInitialView('?view=attendance'), { name: 'attendance' })
  assert.deepEqual(nav.parseInitialView('?view=customer'), { name: 'customer' })
  assert.deepEqual(nav.parseInitialView('?view=shared-schedule'), { name: 'shared-schedule' })
})
test('parseInitialView: 쿼리 없음 → 홈', () => {
  assert.deepEqual(nav.parseInitialView(''), { name: 'staff-home' })
})
test('parseInitialView: 알 수 없는/안전하지 않은 view → 홈', () => {
  assert.deepEqual(nav.parseInitialView('?view=worker'), { name: 'staff-home' }) // 필수 인자 필요 화면은 제외
  assert.deepEqual(nav.parseInitialView('?view=devops'), { name: 'staff-home' }) // 안전 목록 밖
  assert.deepEqual(nav.parseInitialView('?view=../../etc'), { name: 'staff-home' })
})
test('parseInitialView: 다른 파라미터와 함께 와도 동작', () => {
  assert.deepEqual(nav.parseInitialView('?view=schedule&pwa=1'), { name: 'schedule' })
})
test('DEEP_LINK_VIEWS: schedule 포함', () => {
  assert.ok(nav.DEEP_LINK_VIEWS.includes('schedule'))
})
