/**
 * SJ CLAIM FINDER — 브라우저 E2E(합성 어댑터, 운영 인증 우회 없음).
 * 실제 ClaimFinderPage 를 실제 컴파일 CSS 와 함께 렌더해 다음을 검증:
 *  - 고객 A→B 전환 시 늦은 진료기록 응답이 반영되지 않음(경쟁 상태)
 *  - 동의 철회 시 결과 제거, DEMO 전환/고객 변경 시 결과 제거
 *  - 업로드→확인→분석(업로드는 저장 불가 안내), 저장→검토 저장(저장 호출 기록)
 *  - 저장 미구성 상태 안내
 *  - 화면 대비(bg-white + text-slate-100)가 WCAG AA(4.5:1) 이상
 * Postgres 불필요. Playwright/Chromium 미설치면 스킵.
 * 실행: node --test test/e2e/claimFinder.e2e.mjs
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { buildHarness } from './build-harness.mjs'

const require = createRequire(import.meta.url)
let chromium = null
try { ({ chromium } = require('playwright')) } catch { /* 스킵 */ }

const CHROME = '/opt/pw-browsers/chromium'
let browser = null
let harnessUrl = null

before(async () => {
  if (!chromium) return
  const file = await buildHarness()
  harnessUrl = pathToFileURL(file).href
  const opts = { headless: true, args: ['--no-sandbox'] }
  try { browser = await chromium.launch(opts) } catch { browser = await chromium.launch({ ...opts, executablePath: CHROME }) }
})
after(async () => { if (browser) await browser.close() })

const skip = !chromium && 'Playwright 미설치 — E2E 스킵'

async function newPage(fix) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.addInitScript((f) => { globalThis.__FIX = f; globalThis.__CALLS = [] }, fix)
  await page.goto(harnessUrl)
  await page.waitForFunction(() => globalThis.__READY === true, { timeout: 10000 })
  return page
}

const recResult = { resDetailTreatList: [{ resTreatStartDate: '20250601', resHospitalName: 'C', resTreatType: '입원', resAdmissionDays: '5' }] }
const customers = [{ id: 'A', name: '가고객' }, { id: 'B', name: '나고객' }]
const records = [
  { id: 'rA', customerId: 'A', product: 'A진료', status: 'completed', result: recResult, createdAt: '2026-10-01' },
  { id: 'rB', customerId: 'B', product: 'B진료', status: 'completed', result: recResult, createdAt: '2026-10-02' }
]

test('고객 A→B 전환: 늦은 A 진료기록 응답이 B 화면에 반영되지 않음', { skip }, async () => {
  const page = await newPage({ customers, records, recordDelay: { A: 400, B: 0 } })
  await page.selectOption('[data-testid=customer-select]', 'A')
  await page.selectOption('[data-testid=customer-select]', 'B') // A 응답(400ms) 도착 전 전환
  await page.waitForTimeout(600) // A 의 늦은 응답까지 지난 뒤
  const opts = await page.$$eval('[data-testid=record-select] option', (os) => os.map((o) => o.textContent))
  const joined = opts.join('|')
  assert.ok(joined.includes('B진료'), 'B 진료기록이 보여야 함')
  assert.ok(!joined.includes('A진료'), '스테일 A 진료기록이 남으면 안 됨')
  await page.context().close()
})

test('동의 철회 시 결과 제거', { skip }, async () => {
  const page = await newPage({ customers, records })
  await page.selectOption('[data-testid=customer-select]', 'A')
  await page.check('[data-testid=consent]')
  await page.click('[data-testid=demo]')
  await page.waitForSelector('[data-testid=result]')
  await page.uncheck('[data-testid=consent]')
  assert.equal(await page.$('[data-testid=result]'), null, '동의 철회 후 결과 패널이 사라져야 함')
  await page.context().close()
})

test('DEMO 결과 후 고객 변경 시 결과 제거', { skip }, async () => {
  const page = await newPage({ customers, records })
  await page.click('[data-testid=demo]')
  await page.waitForSelector('[data-testid=result]')
  await page.selectOption('[data-testid=customer-select]', 'A')
  await page.waitForTimeout(100)
  assert.equal(await page.$('[data-testid=result]'), null, '고객 변경 후 DEMO 결과가 사라져야 함')
  await page.context().close()
})

test('업로드→확인→분석: 업로드 원본은 저장 불가 안내', { skip }, async () => {
  const page = await newPage({ customers, records })
  await page.selectOption('[data-testid=customer-select]', 'A')
  await page.check('[data-testid=consent]')
  await page.click('text=업로드 원본(검토용)')
  const json = JSON.stringify(recResult)
  await page.setInputFiles('[data-testid=ingest-file]', { name: 'hira.json', mimeType: 'application/json', buffer: Buffer.from(json) })
  await page.waitForSelector('[data-testid=ingest-result]')
  await page.check('[data-testid=ingest-confirm]')
  await page.click('[data-testid=analyze]')
  await page.waitForSelector('[data-testid=result]')
  const body = await page.textContent('[data-testid=result]')
  assert.ok(body.includes('저장할 수 없습니다') || body.includes('저장 불가'), '업로드 저장 불가 안내가 있어야 함')
  assert.equal(await page.$('[data-testid=save]'), null, '업로드 분석엔 저장 버튼이 없어야 함')
  await page.context().close()
})

test('분석 전 업로드 미확인 → 오류 안내', { skip }, async () => {
  const page = await newPage({ customers, records })
  await page.selectOption('[data-testid=customer-select]', 'A')
  await page.check('[data-testid=consent]')
  await page.click('text=업로드 원본(검토용)')
  await page.setInputFiles('[data-testid=ingest-file]', { name: 'hira.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recResult)) })
  await page.waitForSelector('[data-testid=ingest-result]')
  await page.click('[data-testid=analyze]') // 확인 체크 안 함
  await page.waitForSelector('[data-testid=error]')
  const err = await page.textContent('[data-testid=error]')
  assert.ok(err.includes('수동으로 확인'), '업로드 수동 확인 요구 오류가 떠야 함')
  await page.context().close()
})

test('저장(record)→검토 저장: store 호출 기록', { skip }, async () => {
  const page = await newPage({ customers, records })
  await page.selectOption('[data-testid=customer-select]', 'A')
  await page.check('[data-testid=consent]')
  await page.selectOption('[data-testid=record-select]', 'rA')
  await page.click('[data-testid=analyze]')
  await page.waitForSelector('[data-testid=result]')
  await page.click('[data-testid=save]')
  await page.waitForTimeout(100)
  const calls = await page.evaluate(() => globalThis.__CALLS)
  assert.ok(calls.some((c) => c[0] === 'saveRun'), 'saveRun 이 호출돼야 함')
  const saveRow = calls.find((c) => c[0] === 'saveRun')[1]
  assert.equal(saveRow.healthRecordRequestId, 'rA', '건강기록 연결이 payload 에 있어야 함')
  assert.equal(saveRow.isDemo, false)
  await page.context().close()
})

test('저장 미구성 → 비활성 안내', { skip }, async () => {
  const page = await newPage({ customers, records, persistence: false })
  await page.selectOption('[data-testid=customer-select]', 'A')
  await page.check('[data-testid=consent]')
  await page.selectOption('[data-testid=record-select]', 'rA')
  await page.click('[data-testid=analyze]')
  await page.waitForSelector('[data-testid=result]')
  const body = await page.textContent('[data-testid=result]')
  assert.ok(body.includes('저장 비활성'), '미구성 시 저장 비활성 안내가 있어야 함')
  await page.context().close()
})

test('화면 대비: bg-white + text-slate-100 ≥ WCAG AA(4.5:1)', { skip }, async () => {
  const page = await newPage({ customers, records })
  const ratio = await page.evaluate(() => {
    // "② 자료 연결" 헤딩(text-slate-100) 과 그 카드 배경(bg-white) 대비.
    const nodes = Array.from(document.querySelectorAll('h2'))
    const h = nodes.find((n) => n.textContent && n.textContent.includes('자료 연결'))
    if (!h) return null
    const parse = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number)
    const fg = parse(getComputedStyle(h).color)
    let el = h, bg = [255, 255, 255]
    while (el) {
      const c = getComputedStyle(el).backgroundColor
      const p = parse(c)
      if (p.length === 3 && !/rgba\(.*,\s*0\)/.test(c)) { bg = p; break }
      el = el.parentElement
    }
    const lum = (rgb) => { const a = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2] }
    const L1 = lum(fg), L2 = lum(bg)
    const hi = Math.max(L1, L2), lo = Math.min(L1, L2)
    return { ratio: (hi + 0.05) / (lo + 0.05), fg, bg }
  })
  assert.ok(ratio, '헤딩을 찾아야 함')
  assert.ok(ratio.ratio >= 4.5, `대비 부족: ${ratio.ratio?.toFixed(2)}:1 (fg=${ratio.fg} bg=${ratio.bg})`)
  await page.context().close()
})
