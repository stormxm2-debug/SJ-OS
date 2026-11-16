import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-guide-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const g = await load('src/renderer/src/services/aiTeamGuide/guideContent.ts')
test('단계 id 와 명령 id 가 모두 고유하다', () => {
  const stepIds = g.GUIDE_STEPS.map((s) => s.id)
  assert.equal(new Set(stepIds).size, stepIds.length)
  const cmdIds = [...g.GUIDE_STEPS.flatMap((s) => s.commands), ...g.GUIDE_PROMPTS].map((c) => c.id)
  assert.equal(new Set(cmdIds).size, cmdIds.length, '명령 id 중복')
})
test('복사할 텍스트는 비어 있지 않다', () => {
  for (const c of [...g.GUIDE_STEPS.flatMap((s) => s.commands), ...g.GUIDE_PROMPTS]) assert.ok(c.text.trim().length > 0, c.id)
})
test('지시문 10개가 있다', () => {
  assert.equal(g.GUIDE_PROMPTS.length, 10)
})
test('안내 단계는 0~4번 순서', () => {
  assert.deepEqual(g.GUIDE_STEPS.map((s) => s.title.split('.')[0]), ['0', '1', '2', '3', '4'])
})
test('비밀번호·키를 넣으라는 안내가 없다', () => {
  const all = [...g.GUIDE_STEPS.flatMap((s) => s.commands), ...g.GUIDE_PROMPTS].map((c) => c.text).join('\n')
  assert.ok(!/password\s*[:=]|api[_ -]?key\s*[:=]/i.test(all))
})

const ra = await load('src/renderer/src/navigation/roleAccess.ts')
test('AI 드림팀 가이드는 대표만 열 수 있다 (관리자 포함 차단)', () => {
  assert.equal(ra.canAccessRoute('owner', 'ai-team-guide'), true)
  for (const role of ['admin', 'team-leader', 'fc', 'back-office']) {
    assert.equal(ra.canAccessRoute(role, 'ai-team-guide'), false, role)
  }
})
test('다른 화면의 권한은 그대로 (관리자는 기존처럼 전부 열림)', () => {
  assert.equal(ra.canAccessRoute('admin', 'memo'), true)
  assert.equal(ra.canAccessRoute('fc', 'memo'), true)
})
