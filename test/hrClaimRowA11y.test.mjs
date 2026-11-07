import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

// 실제 ClaimRow 두 개를 한 트리에서 정적 렌더해 상세 영역 DOM id/aria-controls 고유성을 검증한다(합성 데이터).
const entry = `
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ClaimRow } from './src/renderer/src/components/health-record/ClaimRecordList'
export function renderRows(records) {
  const noop = () => {}
  return renderToStaticMarkup(h('ul', null, records.map((r) => h(ClaimRow, {
    key: r.key, r, status: 'unclaimed', ready: true, selected: false, selectDisabled: false, open: true, onSelect: noop, onToggle: noop,
  }))))
}
`
async function load() {
  const output = await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: resolve('.') },
    bundle: true, format: 'cjs', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const dir = await mkdtemp(join(tmpdir(), 'sj-claim-row-a11y-')), file = join(dir, 'module.cjs')
  await writeFile(file, output.outputFiles[0].text)
  return createRequire(import.meta.url)(file)
}
const { renderRows } = await load()

const row = (hospital) => ({
  key: JSON.stringify(['20261101', hospital, '감기', 'J00', '외래', null]),
  date: '20261101', hospital, disease: '감기', code: 'J00', side: '미확인', kind: '통원', surgery: false,
  admissionDays: null, medications: [], procedures: [], selfPay: 0,
})

test('비ASCII만 다른 두 key의 행을 동시에 펼쳐도 상세 id가 겹치지 않고 각 버튼이 자기 영역을 가리킨다', () => {
  const a = row('가나병원'), b = row('다라병원')
  assert.notEqual(a.key, b.key)
  // 이전 방식(비ASCII 치환)은 두 key를 같은 문자열로 만들었다 — 재현 조건 확인.
  const legacy = (k) => k.replace(/[^a-zA-Z0-9_-]/g, '_')
  assert.equal(legacy(a.key), legacy(b.key))

  const html = renderRows([a, b])
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
  const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1])
  assert.equal(ids.length, 2, '펼친 상세 영역 2개')
  assert.equal(new Set(ids).size, ids.length, '중복 DOM id 없음')
  assert.deepEqual(controls, ids, '각 상세 버튼 aria-controls가 같은 행의 상세 영역을 가리킴')
  // 각 상세 영역이 자기 병원 행 뒤에 위치하는지(버튼→영역 순서) 확인.
  const [first, second] = html.split('</li>')
  assert.ok(first.includes('가나병원') && first.includes(`aria-controls="${ids[0]}"`) && first.includes(`id="${ids[0]}"`))
  assert.ok(second.includes('다라병원') && second.includes(`aria-controls="${ids[1]}"`) && second.includes(`id="${ids[1]}"`))
})
