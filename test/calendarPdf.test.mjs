import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-pdf-')), file = join(dir, 'm.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(file)
}
const pdf = await load('src/renderer/src/services/schedule/calendarPdf.ts')
const FONT = await readFile('src/renderer/src/assets/fonts/NanumGothic-Regular.ttf')

// 2026-11-10 KST 10:00 등 (KST = UTC+9)
const kst = (d, h, m = 0) => new Date(Date.UTC(2026, 10, d, h - 9, m)).toISOString()

test('planMonthCells: 날짜 칸에 맞는 일정 배치 (화면과 같은 규칙)', () => {
  const events = [
    { id: '1', startsAt: kst(10, 9), title: 'A' },
    { id: '2', startsAt: kst(10, 11), title: 'B' },
    { id: '3', startsAt: kst(10, 13), title: 'C' },
    { id: '4', startsAt: kst(10, 15), title: 'D' }
  ]
  const plan = pdf.planMonthCells(2026, 10, events, [], false)
  const d10 = plan.find((p) => p.cell.key === '2026-11-10')
  assert.equal(d10.events.length, 3, '칸당 3건까지')
  assert.equal(d10.moreEvents, 1, '초과 1건은 +1')
  assert.deepEqual(d10.events.map((e) => e.id), ['1', '2', '3'], '시간 순')
})

test('planMonthCells: 공지 슬롯이 있으면 일정 자리가 1칸 줄어듦(+N 규칙 동일)', () => {
  const events = [1, 2, 3].map((i) => ({ id: String(i), startsAt: kst(10, 8 + i), title: 'E' + i }))
  const notices = [{ id: 'n', title: '공지', priority: 'normal', pinned: false, startDate: '2026-11-10' }]
  const plan = pdf.planMonthCells(2026, 10, events, notices, true)
  const d10 = plan.find((p) => p.cell.key === '2026-11-10')
  assert.ok(d10.notice)
  assert.equal(d10.events.length, 2)
  assert.equal(d10.moreEvents, 1)
})

test('planMonthCells: 공지 제외 옵션이면 공지 슬롯 없음', () => {
  const notices = [{ id: 'n', title: '공지', priority: 'normal', pinned: false, startDate: '2026-11-10' }]
  const plan = pdf.planMonthCells(2026, 10, [], notices, false)
  assert.equal(plan.find((p) => p.cell.key === '2026-11-10').notice, undefined)
})

test('planMonthCells: 42칸, 일요일 시작', () => {
  const plan = pdf.planMonthCells(2026, 10, [], [], false)
  assert.equal(plan.length, 42)
  assert.equal(plan[0].cell.dow, 0)
})

test('buildMonthPdf: 한글 폰트로 실제 PDF 생성(A4 가로)', async () => {
  const bytes = await pdf.buildMonthPdf(
    {
      year: 2026,
      monthIndex0: 10,
      title: 'SJ 월간 일정',
      scopeLabel: '개인 · 테스트',
      includeNotices: true,
      events: [{ id: '1', startsAt: kst(10, 10), title: '상담 · 김민준' }],
      notices: [{ id: 'n', title: '전사 회의', priority: 'urgent', pinned: true, startDate: '2026-11-10' }]
    },
    new Uint8Array(FONT)
  )
  const head = Buffer.from(bytes.slice(0, 5)).toString('latin1')
  assert.equal(head, '%PDF-')
  assert.ok(bytes.length > 5000, 'PDF 가 비정상적으로 작음')
  // A4 가로 확인: 저장된 PDF 를 다시 열어 실제 페이지 크기를 본다(객체 스트림 압축이라 문자열 검색 불가)
  const { PDFDocument } = await import('pdf-lib')
  const reopened = await PDFDocument.load(bytes)
  const { width, height } = reopened.getPage(0).getSize()
  assert.ok(Math.abs(width - 841.89) < 0.01 && Math.abs(height - 595.28) < 0.01, `A4 가로 아님: ${width}x${height}`)
  assert.equal(reopened.getPageCount(), 1)
})
