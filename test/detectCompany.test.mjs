/**
 * 제안서를 발행한 보험사 찾기 테스트.
 *
 * 실제 제안서 2건에서 확인한 함정을 고정한다.
 *
 * 1) 대리점 이름을 보험사로 읽으면 안 된다.
 *    DB손해보험 제안서에 "삼성화재_더프라임파트너(박지현)",
 *    메리츠화재 제안서에 "(주)삼성화재금융서비스보험대리점(더프라임파트너)" 가 적혀 있었다.
 *    둘 다 같은 GA 소속이라, 거르지 않으면 모든 제안서가 '삼성화재' 가 된다.
 *
 * 2) 회사명 없이 상품 브랜드만 적힌 제안서가 있다.
 *    DB손해보험은 본문에 회사명 없이 '무배당 프로미라이프 …' 로만 나왔다.
 *
 * 3) 목록 순서로 고르면 안 된다. 예전에는 COMPANY_PATTERNS 를 훑어 먼저 맞는 것을 썼고,
 *    그래서 목록에서 앞선 회사가 문서에 한 번만 나와도 이겼다.
 *
 * 실행: node --test test/detectCompany.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

/** proposalParser 가 끌어오는 PDF 로더는 이 테스트에서 쓰지 않으므로 빈 껍데기로 바꿔 낀다. */
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
    entryPoints: ['src/renderer/src/services/commercial/hospitalCoverage.ts'],
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'node',
    alias: { '@renderer': resolve('src/renderer/src'), '@shared': resolve('src/shared') },
    plugins: [stubPdfLoader]
  })
  const dir = await mkdtemp(join(tmpdir(), 'sj-company-'))
  const file = join(dir, 'mod.mjs')
  await writeFile(file, out.outputFiles[0].text, 'utf8')
  return import(file)
}

const { detectCompany } = await load()

/** 글자 한 줄을 documentLines 가 읽을 수 있는 쪽 구조로 만든다. */
const pageOf = (...lines) => ({
  pageNum: 1,
  items: lines.map((str, i) => ({ str, x: 0, y: 800 - i * 20, width: str.length * 6 }))
})

test('대리점 이름을 보험사로 읽지 않는다', () => {
  // 실제 DB손해보험 제안서 1쪽에 있던 문구 (고객 정보는 뺐다)
  const pages = [
    pageOf(
      '가입설계서 표지',
      '무배당 프로미라이프 나에게맞춘간편건강보험2607 고객님의 가입 제안서',
      '부경사업단 삼성화재_더프라임파트너(박지현)'
    )
  ]
  assert.equal(detectCompany(pages, ''), 'DB손해보험')
})

test('회사명 없이 상품 브랜드만 있어도 찾는다', () => {
  const pages = [pageOf('무배당 프로미라이프 나에게맞춘간편건강보험2607')]
  assert.equal(detectCompany(pages, ''), 'DB손해보험')
})

test('본문에 회사명이 있으면 그걸 쓴다 — 같은 대리점이 적혀 있어도', () => {
  // 실제 메리츠화재 제안서 1쪽 문구
  const pages = [
    pageOf(
      '(무) 메리츠 통합간편건강보험(세만기형)2607',
      '메리츠화재 가 고객님의 행복을 지켜드리겠습니다.',
      '소속 부산GA-3지점 컨설턴트 (주)삼성화재금융서비스보험대리점(더프라임파트너)'
    )
  ]
  assert.equal(detectCompany(pages, ''), '메리츠')
})

test('목록 순서가 아니라 많이 나온 회사를 고른다', () => {
  // 메리츠는 COMPANY_PATTERNS 에서 삼성화재보다 앞에 있다.
  // 순서대로 고르던 예전 방식이면 메리츠가 이겼을 상황.
  const pages = [pageOf('삼성화재 종합보험', '삼성화재 가입제안서', '삼성화재', '비교: 메리츠')]
  assert.equal(detectCompany(pages, ''), '삼성화재')
})

test('파일명은 본문보다 믿는다 — FC 가 직접 붙인 이름이라서', () => {
  const pages = [pageOf('본문에는 흥국화재만 한 번 나온다')]
  assert.equal(detectCompany(pages, 'DB손해보험_제안서.pdf'), 'DB손해보험')
})

test('파일명에 있어도 대리점 표기면 쓰지 않는다', () => {
  const pages = [pageOf('메리츠화재 가 고객님의 행복을 지켜드리겠습니다.')]
  assert.equal(detectCompany(pages, '삼성화재금융서비스_제안서.pdf'), '메리츠')
})

test('아무것도 못 찾으면 null', () => {
  assert.equal(detectCompany([pageOf('보험 가입 제안서')], ''), null)
})

test('흥생 파일명은 예전처럼 흥국생명으로 본다', () => {
  assert.equal(detectCompany([pageOf('가입제안서')], '흥생_제안서.pdf'), '흥국생명')
})

test('브랜드만 적힌 흥국화재 제안서를 찾는다', () => {
  // 실제 제안서 표지: 회사명 없이 상품 브랜드만 적혀 있었다.
  const pages = [
    pageOf('고객님을 위한 가입제안서', '무배당 흥Good The건강한 4565 종합보험', '(주)삼성화재금융서비스더프라임파트너')
  ]
  assert.equal(detectCompany(pages, ''), '흥국화재')
})

test('회사명이 뒤쪽 안내 쪽에만 있어도 찾는다', () => {
  // 앞 4쪽만 보던 때는 6쪽의 '보험 회사 …' 칸을 놓쳐 회사 미확인이 됐다.
  const pages = [
    pageOf('가입제안서'),
    pageOf('중요사항 안내'),
    pageOf('보장내용'),
    pageOf('보장내용'),
    pageOf('보장내용'),
    pageOf('보 험 회 사 흥국화재해상보험(주)', '상품설명서')
  ]
  assert.equal(detectCompany(pages, ''), '흥국화재')
})
