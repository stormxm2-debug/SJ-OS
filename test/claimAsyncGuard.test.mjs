/**
 * SJ CLAIM FINDER — 세대 가드 경쟁 상태 테스트(실제 deferred promise 경쟁).
 * 고객 A 요청이 B 전환 후 늦게 도착해도 반영되지 않음을 검증.
 * 실행: node --test test/claimAsyncGuard.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

async function load(src) {
  const r = await build({ entryPoints: [src], bundle: true, format: 'esm', write: false, platform: 'node' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-ag-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, r.outputFiles[0].text, 'utf8')
  return import(file)
}

const { createGenerationGuard } = await load('src/renderer/src/services/claim-finder/asyncGuard.ts')

function deferred() {
  let resolve
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}

test('A 요청이 B 전환 후 늦게 도착 → A 결과는 반영되지 않음(실제 경쟁)', async () => {
  const guard = createGenerationGuard()
  const applied = []

  // 고객 A 로드 시작
  const dA = deferred()
  const genA = guard.next()
  const pA = (async () => {
    const data = await dA.promise
    if (!guard.isCurrent(genA)) return
    applied.push(data)
  })()

  // 아직 A 응답 전에 B 로 전환(새 세대)
  const dB = deferred()
  const genB = guard.next()
  const pB = (async () => {
    const data = await dB.promise
    if (!guard.isCurrent(genB)) return
    applied.push(data)
  })()

  // 늦게: A 가 먼저 resolve(스테일), 그 다음 B
  dA.resolve('A-records')
  await pA
  dB.resolve('B-records')
  await pB

  assert.deepEqual(applied, ['B-records'], '스테일 A 응답은 버려지고 B 만 반영돼야 함')
})

test('invalidate 후 진행 중 응답은 모두 폐기', async () => {
  const guard = createGenerationGuard()
  const applied = []
  const d = deferred()
  const gen = guard.next()
  const p = (async () => {
    const data = await d.promise
    if (!guard.isCurrent(gen)) return
    applied.push(data)
  })()
  guard.invalidate() // 언마운트/스코프 무효화
  d.resolve('late')
  await p
  assert.deepEqual(applied, [], 'invalidate 후 응답은 반영 안 됨')
})

test('동일 세대면 반영', async () => {
  const guard = createGenerationGuard()
  const gen = guard.next()
  assert.equal(guard.isCurrent(gen), true)
  assert.equal(guard.current(), gen)
})
