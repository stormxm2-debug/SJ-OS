import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-page-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const pf = await load('src/renderer/src/services/commercial/pagedFetch.ts')

// 서버 시뮬레이터: 전체 rows 를 PostgREST 처럼 range(from,to) 로 잘라준다(기본 1000행 상한 포함)
function makeServer(total) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `r${i}` }))
  const calls = []
  const fetchPage = async (from, to) => {
    calls.push([from, to])
    const capped = Math.min(to, from + 999) // 서버 1,000행 제한
    return { rows: rows.slice(from, capped + 1) }
  }
  return { fetchPage, calls, rows }
}

test('1,188행이면 전부 가져온다 (기존 1,000행 제한 버그 재현 방지)', async () => {
  const srv = makeServer(1188)
  const { rows, error } = await pf.fetchAllPages(srv.fetchPage, 1000)
  assert.equal(error, undefined)
  assert.equal(rows.length, 1188)
  assert.equal(rows[1187].id, 'r1187') // 가장 최근 행까지 포함
})

test('행 수가 페이지 크기의 배수여도 빈 페이지에서 멈춘다', async () => {
  const srv = makeServer(2000)
  const { rows } = await pf.fetchAllPages(srv.fetchPage, 1000)
  assert.equal(rows.length, 2000)
})

test('데이터가 없으면 빈 배열', async () => {
  const srv = makeServer(0)
  const { rows } = await pf.fetchAllPages(srv.fetchPage, 1000)
  assert.deepEqual(rows, [])
})

test('중간 페이지 오류는 오류를 돌려주고 지금까지 받은 행을 함께 준다', async () => {
  let n = 0
  const fetchPage = async () => {
    n++
    if (n === 2) return { rows: [], error: new Error('timeout') }
    return { rows: Array.from({ length: 1000 }, (_, i) => ({ id: i })) }
  }
  const res = await pf.fetchAllPages(fetchPage, 1000)
  assert.ok(res.error)
  assert.equal(res.rows.length, 1000)
})

test('안전 상한(maxRows)에서 무한 루프 없이 멈춘다', async () => {
  const fetchPage = async () => ({ rows: Array.from({ length: 1000 }, (_, i) => ({ id: i })) })
  const { rows } = await pf.fetchAllPages(fetchPage, 1000, 3000)
  assert.ok(rows.length >= 3000 && rows.length <= 4000)
})
