import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as XLSX from 'xlsx'

async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, external: ['xlsx'], tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  // xlsx 를 프로젝트 node_modules 에서 찾을 수 있도록 프로젝트 안에 임시 파일을 둔다.
  const dir = join(process.cwd(), 'node_modules', '.cache', `sj-lead-import-${process.pid}`)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const li = await load('src/renderer/src/services/commercial/leadImport.ts')

function makeFile(name, sheets) {
  const wb = XLSX.utils.book_new()
  for (const [sheetName, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new File([buf], name)
}

test('시트가 여러 장이면 모든 시트를 읽는다 (이름·전화 없는 시트는 건너뜀)', async () => {
  const f = makeFile('a.xlsx', {
    '1월': [['이름', '전화', '지역'], ['가', '010-1111-0001', '광주'], ['나', '01011110002', '전남']],
    '2월': [['성명', '연락처', '지역'], ['다', '010-1111-0003', '서울']],
    '메모': [['설명'], ['이 시트는 설명입니다']]
  })
  const r = await li.parseLeadFile(f)
  assert.equal(r.ok, true)
  assert.equal(r.rows.length, 3)
  assert.deepEqual(r.rows.map((x) => x.name), ['가', '나', '다'])
  assert.equal(r.rows[1].phone, '010-1111-0002')
  assert.ok(r.rows[2].origin.includes('2월'))
  assert.equal(r.rows[0].source, 'a.xlsx')
})

test('파일 여러 개를 한꺼번에 읽고 파일 사이 중복은 한 건만 남긴다', async () => {
  const a = makeFile('a.xlsx', { S: [['이름', '전화'], ['가', '010-1111-0001'], ['나', '010-1111-0002']] })
  const b = makeFile('b.xlsx', { S: [['이름', '전화', '주소'], ['나', '010-1111-0002', '광주'], ['다', '010-1111-0003', '전남 화순군']] })
  const c = makeFile('c.xlsx', { S: [[]] })
  const r = await li.parseLeadFiles([a, b, c])
  assert.equal(r.ok, true)
  assert.deepEqual(r.rows.map((x) => x.name), ['가', '나', '다'])
  assert.equal(r.files.length, 3)
  assert.equal(r.files[0].count, 2)
  assert.ok(r.files[2].error) // 읽을 수 없는 파일은 실패로 표시
  assert.ok(r.summary.includes('중복 1건'))
})

test('전부 읽을 수 없으면 실패로 돌려준다', async () => {
  const r = await li.parseLeadFiles([makeFile('x.xlsx', { S: [[]] })])
  assert.equal(r.ok, false)
  assert.ok(r.error)
})
