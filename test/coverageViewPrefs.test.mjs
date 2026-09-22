/**
 * 담보 정리 화면 — 보는 방식 저장 테스트.
 *
 * FC가 고객 앞에서 쓰는 방식(대결/견적서)은 기기에 남아야 다음에도 그대로 열린다.
 * 저장이 막힌 환경에서도 앱이 멈추면 안 된다.
 *
 * 실행: node --test test/coverageViewPrefs.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

async function load() {
  const out = await build({
    entryPoints: ['src/renderer/src/services/commercial/coverageViewPrefs.ts'],
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'node'
  })
  const dir = await mkdtemp(join(tmpdir(), 'sj-view-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, out.outputFiles[0].text, 'utf8')
  return import(file)
}

/** 브라우저 저장소 흉내 */
function useStorage(store) {
  globalThis.window = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = v
      }
    }
  }
}

const { loadViewPrefs, saveViewPrefs, setMode, setCustomerStyle, DEFAULT_VIEW } = await load()

test('처음에는 설계사용 · 대결 방식', () => {
  useStorage({})
  assert.deepEqual(loadViewPrefs(), DEFAULT_VIEW)
  assert.equal(DEFAULT_VIEW.mode, 'fc')
})

test('고른 방식을 저장하고 다시 읽는다', () => {
  const store = {}
  useStorage(store)
  saveViewPrefs({ mode: 'customer', customerStyle: 'receipt' })
  assert.deepEqual(loadViewPrefs(), { mode: 'customer', customerStyle: 'receipt' })
})

test('고객용 방식을 고르면 고객 화면으로 함께 넘어간다', () => {
  useStorage({})
  const next = setCustomerStyle({ mode: 'fc', customerStyle: 'versus' }, 'receipt')
  assert.deepEqual(next, { mode: 'customer', customerStyle: 'receipt' })
})

test('설계사용으로 돌아가도 고객용 방식은 기억한다', () => {
  useStorage({})
  const next = setMode({ mode: 'customer', customerStyle: 'receipt' }, 'fc')
  assert.deepEqual(next, { mode: 'fc', customerStyle: 'receipt' })
})

test('저장값이 깨져 있으면 기본값으로 연다', () => {
  useStorage({ 'sj-coverage-view-v1': '{"mode":"보여주기","customerStyle":42}' })
  assert.deepEqual(loadViewPrefs(), DEFAULT_VIEW)
  useStorage({ 'sj-coverage-view-v1': '깨진 값' })
  assert.deepEqual(loadViewPrefs(), DEFAULT_VIEW)
})

test('저장이 막혀 있어도 멈추지 않는다', () => {
  globalThis.window = {
    localStorage: {
      getItem: () => {
        throw new Error('막힘')
      },
      setItem: () => {
        throw new Error('막힘')
      }
    }
  }
  assert.deepEqual(loadViewPrefs(), DEFAULT_VIEW)
  assert.deepEqual(saveViewPrefs({ mode: 'customer', customerStyle: 'versus' }), {
    mode: 'customer',
    customerStyle: 'versus'
  })
})
