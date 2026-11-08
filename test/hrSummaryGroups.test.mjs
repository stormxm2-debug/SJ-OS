import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-hr-groups-')), file = join(dir, 'module.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(pathToFileURL(file).href)
}
const { groupSummaryRecords } = await load('src/renderer/src/services/health-record/summaryGroups.ts')
const care = await load('src/renderer/src/services/health-record/careWorkspace.ts')

// 합성 자료만 사용.
const rec = (key, date, hospital, extra = {}) => ({ key, date, hospital, disease: '가상병명', code: '', side: '미확인', kind: '통원', surgery: false, admissionDays: null, medications: [], procedures: [], selfPay: 0, ...extra })
const rows = [
  rec('a', '20261105', 'A병원'),
  rec('b', '20261105', 'A병원'), // 같은 날·병원, 같은 병명도 그대로 유지
  rec('c', '20261105', 'B병원'),
  rec('d', '20261104', 'A병원'),
  rec('u1', '', 'A병원'),
  rec('u2', '', 'A병원'), // 날짜 미확인끼리 합치지 않음
  rec('h1', '20261103', ''),
  rec('h2', '20261103', ''), // 병원 비어 있음 → 각각 독립
  rec('e', '20261105', 'A병원', { kind: '입원', admissionDays: 3, surgery: true }), // 뒤에 나와도 첫 등장 묶음에 붙음
]

test('같은 날·병원만 묶고, 다른 날/병원·미확인은 각각 독립, 원기록 key·입력 불변', () => {
  const snapshot = JSON.stringify(rows)
  const g = groupSummaryRecords(rows)
  assert.deepEqual(g.map(x => x.records.map(r => r.key)), [['a', 'b', 'e'], ['c'], ['d'], ['u1'], ['u2'], ['h1'], ['h2']])
  assert.deepEqual(g.flatMap(x => x.records.map(r => r.key)).sort(), rows.map(r => r.key).sort())
  assert.equal(new Set(g.map(x => x.key)).size, g.length)
  assert.equal(JSON.stringify(rows), snapshot)
  assert.equal(g[0].records[2], rows[8]) // 같은 객체, 복사·병합 없음
})

test('필터 후 묶음, careKpis 집계는 묶음과 무관', () => {
  const before = care.careKpis(rows)
  const inp = groupSummaryRecords(care.filterSummaryRecords(rows, 'inpatient'))
  assert.deepEqual(inp.map(x => x.records.map(r => r.key)), [['e']])
  groupSummaryRecords(rows)
  assert.deepEqual(care.careKpis(rows), before)
  assert.equal(before.records, rows.length)
})
