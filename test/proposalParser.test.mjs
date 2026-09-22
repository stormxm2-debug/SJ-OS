/**
 * 담보표 읽기 테스트.
 *
 * 실제 제안서에서 표를 통째로 놓쳤던 경우를 고정한다.
 *
 * DB손해보험 '가입담보요약' 의 머리글은 이렇게 생겼다.
 *   No. | 가입담보 | 가입금액 | 보험료(원) | 납기/만기(갱신종료시기)
 * 마지막 칸이 14글자라 '머리글은 10글자까지' 규칙에 걸려 만기 열을 못 찾았고,
 * 그 결과 만기 글자('20년/20년(100세종료)')가 보험료 칸으로 밀려 들어가
 * "보험료 칸에 금액이 아닌 글자" 로 판정돼 표 전체가 버려졌다. 담보 0개가 됐다.
 *
 * 실행: node --test test/proposalParser.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

/** PDF 로더는 이 테스트에서 쓰지 않는다. */
const stubPdfLoader = {
  name: 'stub-pdf-loader',
  setup(b) {
    b.onResolve({ filter: /files\/pdfFill$/ }, () => ({ path: 'stub-pdffill', namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export const loadPdfjs = async () => { throw new Error("이 테스트에서는 쓰지 않습니다") }',
      loader: 'js'
    }))
  }
}

async function load() {
  const out = await build({
    entryPoints: ['src/renderer/src/services/commercial/proposalParser.ts'],
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'node',
    alias: { '@renderer': resolve('src/renderer/src'), '@shared': resolve('src/shared') },
    plugins: [stubPdfLoader]
  })
  const dir = await mkdtemp(join(tmpdir(), 'sj-parse-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, out.outputFiles[0].text, 'utf8')
  return import(file)
}

const { parseCoverageTable } = await load()

/**
 * 한 쪽을 만든다. cells 는 [글자, x, 너비] — 실제 PDF 좌표를 흉내 낸다.
 * y 는 줄마다 20씩 내려간다.
 */
const pageOf = (rows) => ({
  pageNum: 1,
  items: rows.flatMap((cells, line) =>
    cells.map(([str, x, width]) => ({ str, x, y: 100 + line * 20, width, height: 9 }))
  )
})

/** DB손해보험 가입담보요약과 같은 열 배치 */
const DB_HEADER = [
  ['No.', 18, 13],
  ['가입담보', 168, 32],
  ['가입금액', 358, 32],
  ['보험료(원)', 417, 38],
  ['납기/만기(갱신종료시기)', 461, 89]
]

test('머리글 한 칸에 두 열 이름과 설명이 같이 있어도 표를 읽는다', () => {
  const { rows } = parseCoverageTable([
    pageOf([
      DB_HEADER,
      [['1. (건강고지)상해수술비(동일사고당1회지급)(갱신형)', 27, 189], ['50만원', 389, 25], ['1,815', 436, 19], ['20년/20년(100세종료)', 466, 79]],
      [['2. (건강고지)암진단비Ⅱ(유사암제외)(갱신형)', 27, 170], ['5천만원', 386, 28], ['66,050', 433, 22], ['20년/20년(100세종료)', 466, 79]]
    ])
  ])

  assert.equal(rows.length, 2)
  assert.equal(rows[0].amount, '50만원')
  assert.equal(rows[0].premium, '1,815')
  assert.equal(rows[1].amount, '5천만원')
  assert.equal(rows[1].premium, '66,050')
})

test('담보명 앞에 붙은 순번은 뗀다', () => {
  const { rows } = parseCoverageTable([
    pageOf([
      DB_HEADER,
      [['1. (건강고지)상해수술비(갱신형)', 27, 150], ['50만원', 389, 25], ['1,815', 436, 19], ['20년/20년(100세종료)', 466, 79]],
      [['12) 5대골절진단비(갱신형)', 27, 140], ['50만원', 389, 25], ['410', 442, 13], ['20년/20년(100세종료)', 466, 79]]
    ])
  ])

  assert.equal(rows[0].coverageName, '(건강고지)상해수술비(갱신형)')
  // 담보명 자체가 숫자로 시작하는 경우는 그대로 둔다 — 순번은 점이나 괄호가 따라온다.
  assert.equal(rows[1].coverageName, '5대골절진단비(갱신형)')
})

test('만기 글자가 보험료 칸으로 새지 않는다', () => {
  const { rows } = parseCoverageTable([
    pageOf([
      DB_HEADER,
      [['(건강고지)뇌졸중진단비(갱신형)', 27, 150], ['1천만원', 386, 28], ['7,800', 436, 19], ['20년/20년(100세종료)', 466, 79]]
    ])
  ])

  assert.equal(rows.length, 1)
  assert.equal(rows[0].premium, '7,800')
  assert.match(rows[0].term, /20년/)
})

test('설명 문장에 들어 있는 \'보험료\' 는 머리글로 보지 않는다', () => {
  const { rows, warnings } = parseCoverageTable([
    pageOf([
      [['해약환급금은 납입한 보험료보다 적거나 없을 수도 있습니다', 20, 300]],
      [['가입 후 90일간 보장 제외', 20, 140]]
    ])
  ])

  assert.equal(rows.length, 0)
  assert.equal(warnings.length, 1)
})
