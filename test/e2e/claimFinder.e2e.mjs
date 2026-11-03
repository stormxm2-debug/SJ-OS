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

// 진단명 포함 → 진단비 담보와 매칭되어 후보 1건 이상 생성(후보 카드/검토 테스트용).
const recResult = { resDetailTreatList: [{ resTreatStartDate: '20250601', resHospitalName: 'C', resTreatType: '외래', resDiseaseName: '대장암' }] }
const customers = [{ id: 'A', name: '가고객' }, { id: 'B', name: '나고객' }]
const records = [
  { id: 'rA', customerId: 'A', product: 'A진료', status: 'completed', result: recResult, createdAt: '2026-10-01' },
  { id: 'rB', customerId: 'B', product: 'B진료', status: 'completed', result: recResult, createdAt: '2026-10-02' }
]
// 현재 고객 상관없이 보이도록 customerName 공란. 암진단비(현재금액>0) → 진단비 담보 1건.
const analyses = [{ id: 'ca1', customerName: '', updatedAt: '2026-10-01', policies: [{ insurer: '가상화재' }], coverages: [{ label: '암진단비', current: 20000000 }] }]

// 실데이터 경로로 결과 생성(DEMO 제거됨): 고객 선택 → 동의 → 진료기록 → 보장분석+확인 → 분석.
async function analyzeRecord(page, cust = 'A', rec = 'rA') {
  await page.selectOption('[data-testid=customer-select]', cust)
  await page.check('[data-testid=consent]')
  await page.selectOption('[data-testid=record-select]', rec)
  await page.selectOption('[data-testid=analysis-select]', 'ca1')
  await page.check('[data-testid=analysis-confirm]')
  await page.click('[data-testid=analyze]')
  await page.waitForSelector('[data-testid=result]')
}

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

test('DEMO 미노출: 운영 화면에 DEMO 버튼/탭 없음', { skip }, async () => {
  const page = await newPage({ customers, records, analyses })
  assert.equal(await page.$('[data-testid=demo]'), null, 'DEMO 데이터로 보기 버튼이 없어야 함')
  const bodyText = await page.textContent('body')
  assert.ok(!bodyText.includes('DEMO 데이터로 보기'), 'DEMO 진입 문구 없음')
  assert.equal(await page.$('[data-testid=history-demo-list]'), null, 'DEMO 이력 탭/목록 없음')
  assert.ok(!bodyText.includes('0.2.0-demo'), '표시용 0.2.0-demo 문자열 없음')
  await page.context().close()
})

test('동의 철회 시 결과 제거', { skip }, async () => {
  const page = await newPage({ customers, records, analyses })
  await analyzeRecord(page)
  await page.uncheck('[data-testid=consent]')
  assert.equal(await page.$('[data-testid=result]'), null, '동의 철회 후 결과 패널이 사라져야 함')
  await page.context().close()
})

test('분석 결과 후 고객 변경 시 결과 제거', { skip }, async () => {
  const page = await newPage({ customers, records, analyses })
  await analyzeRecord(page, 'A')
  await page.selectOption('[data-testid=customer-select]', 'B')
  await page.waitForTimeout(100)
  assert.equal(await page.$('[data-testid=result]'), null, '고객 변경 후 결과가 사라져야 함')
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

test('스테일 저장 폐기: A 저장 대기 중 B 분석 → A 저장 완료가 B 화면에 반영 안 됨', { skip }, async () => {
  const page = await newPage({ customers, records, saveDelay: 500 })
  // A 분석 후 저장 클릭(500ms 지연)
  await page.selectOption('[data-testid=customer-select]', 'A')
  await page.check('[data-testid=consent]')
  await page.selectOption('[data-testid=record-select]', 'rA')
  await page.click('[data-testid=analyze]')
  await page.waitForSelector('[data-testid=result]')
  await page.click('[data-testid=save]') // A 저장 시작(지연)
  // 저장 완료 전에 B 로 전환 + 재분석(새 결과 scope)
  await page.selectOption('[data-testid=customer-select]', 'B')
  await page.check('[data-testid=consent]')
  await page.selectOption('[data-testid=record-select]', 'rB')
  await page.click('[data-testid=analyze]')
  await page.waitForSelector('[data-testid=result]')
  await page.waitForTimeout(700) // A 저장(500ms) 완료까지 대기
  // B 화면의 저장 버튼은 여전히 "서버에 저장"(A 의 SAVE_DONE 이 폐기됨)
  const saveText = await page.textContent('[data-testid=save]')
  assert.ok(!saveText.includes('저장됨'), 'A 의 스테일 저장이 B 에 savedRunId 를 주입하면 안 됨')
  // A saveRun 은 호출됐지만(payload customerId=A), B 화면 상태엔 영향 없음
  const calls = await page.evaluate(() => globalThis.__CALLS)
  const savedA = calls.find((c) => c[0] === 'saveRun' && c[1].customerId === 'A')
  assert.ok(savedA, 'A 저장은 실제로 호출됨(그러나 완료가 폐기됨)')
  // ★ 새 scope(B)의 저장 버튼이 영구 비활성화되지 않고 실제 다시 동작해야 한다.
  const disabledB = await page.getAttribute('[data-testid=save]', 'disabled')
  assert.equal(disabledB, null, 'B 저장 버튼이 (스테일 A 저장 때문에) 비활성화되면 안 됨')
  await page.click('[data-testid=save]')
  await page.waitForTimeout(700) // B 저장(saveDelay 500ms) 완료
  const saveTextB = await page.textContent('[data-testid=save]')
  assert.ok(saveTextB.includes('저장됨'), 'B 저장이 실제로 완료돼 savedRunId 가 설정돼야 함')
  const calls2 = await page.evaluate(() => globalThis.__CALLS)
  assert.ok(calls2.some((c) => c[0] === 'saveRun' && c[1].customerId === 'B'), 'B saveRun 이 호출돼야 함')
  await page.context().close()
})

test('새 scope 저장→검토 저장 실제 동작: addReview 호출', { skip }, async () => {
  const page = await newPage({ customers, records, analyses })
  await analyzeRecord(page)
  await page.click('[data-testid=save]')
  await page.waitForTimeout(100)
  const saveText = await page.textContent('[data-testid=save]')
  assert.ok(saveText.includes('저장됨'), '저장 완료')
  // 후보 카드 열고 검토 저장
  await page.locator('text=원본 대조·검토 열기').first().click()
  await page.locator('button', { hasText: '검토 저장' }).first().click()
  await page.waitForTimeout(100)
  const calls = await page.evaluate(() => globalThis.__CALLS)
  assert.ok(calls.some((c) => c[0] === 'addReview'), '검토 저장이 실제로 호출돼야 함(버튼 비활성화 아님)')
  await page.context().close()
})

test('동의 철회/고객 변경 시 업로드 원문·확인·진행상태 초기화', { skip }, async () => {
  const page = await newPage({ customers, records, analyses })
  await page.selectOption('[data-testid=customer-select]', 'A')
  await page.check('[data-testid=consent]')
  await page.click('text=업로드 원본(검토용)')
  await page.setInputFiles('[data-testid=ingest-file]', { name: 'hira.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recResult)) })
  await page.waitForSelector('[data-testid=ingest-result]')
  // 동의 철회 → 업로드 결과 사라짐
  await page.uncheck('[data-testid=consent]')
  await page.waitForTimeout(50)
  assert.equal(await page.$('[data-testid=ingest-result]'), null, '동의 철회 시 업로드 원문이 남으면 안 됨')
  // 다시 업로드 후 고객 변경 → 업로드 결과 사라짐
  await page.check('[data-testid=consent]')
  await page.setInputFiles('[data-testid=ingest-file]', { name: 'hira.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recResult)) })
  await page.waitForSelector('[data-testid=ingest-result]')
  await page.selectOption('[data-testid=customer-select]', 'B')
  await page.waitForTimeout(100)
  assert.equal(await page.$('[data-testid=ingest-result]'), null, '고객 변경 시 업로드 원문이 남으면 안 됨')
  await page.context().close()
})

test('저장→이력 목록→불러오기: 결과·검토메모 복원 + 중복 저장 방지(실데이터)', { skip }, async () => {
  const page = await newPage({ customers, records, analyses })
  await analyzeRecord(page, 'A')
  await page.click('[data-testid=save]')
  await page.waitForTimeout(100)
  assert.ok((await page.textContent('[data-testid=save]')).includes('저장됨'), '저장 완료')
  // 첫 후보 카드 열고(한 번만) 검토 메모 입력 → 검토 저장. 이후 같은 key 로 카드는 열린 상태 유지.
  await page.locator('text=원본 대조·검토 열기').first().click()
  await page.locator('[data-testid=review-note]').first().fill('복원테스트메모')
  await page.locator('button', { hasText: '검토 저장' }).first().click()
  await page.waitForTimeout(100)

  // 화면 재진입 시뮬: 재분석 → 새 결과(미저장, 검토 비움). 카드는 열린 상태 유지되므로 바로 값 확인.
  await page.click('[data-testid=analyze]')
  await page.waitForSelector('[data-testid=result]')
  await page.waitForTimeout(100)
  assert.equal(await page.locator('[data-testid=review-note]').first().inputValue(), '', '새 분석은 검토 메모가 비어 있어야 함')

  // 저장 이력 새로고침 → 현재 고객 목록에 항목 존재 → 불러오기
  await page.click('[data-testid=history-refresh]')
  await page.waitForTimeout(100)
  const loadBtns = page.locator('[data-testid=history-customer-list] [data-testid=history-load]')
  assert.ok((await loadBtns.count()) >= 1, '저장된 실데이터 분석이 현재 고객 이력에 보여야 함')
  await loadBtns.first().click()
  await page.waitForTimeout(150)

  // 결과 복원 + 저장 버튼은 '저장됨'(중복 저장 방지)
  await page.waitForSelector('[data-testid=result]')
  assert.ok((await page.textContent('[data-testid=save]')).includes('저장됨'), '불러온 run 은 이미 저장됨 → 재저장 불가')
  // 검토 메모 복원(카드 열린 상태 유지 → 바로 확인)
  await page.waitForTimeout(100)
  assert.equal(await page.locator('[data-testid=review-note]').first().inputValue(), '복원테스트메모', '불러오기 시 검토 메모가 복원돼야 함')

  const calls = await page.evaluate(() => globalThis.__CALLS.map((c) => c[0]))
  assert.ok(calls.includes('getRun') && calls.includes('listReviews'), 'getRun/listReviews 재조회 호출됨')
  await page.context().close()
})

test('저장 이력: 동의 전 현재고객 목록 비표시 + DEMO 저장분석은 목록에서 제외', { skip }, async () => {
  const page = await newPage({ customers, records, analyses })
  // 과거 DEMO 행이 서버에 있어도 운영 목록엔 안 보여야 함 → 메모리에 demo run 심기.
  await page.evaluate(() => { globalThis.__RUNS = [{ id: 'run-demo-x', customerId: null, customerName: null, healthRecordRequestId: null, coverageAnalysisRef: null, rulesVersion: '0.2.0-demo', status: 'completed', isDemo: true, result: [], warnings: [], createdAt: new Date().toISOString() }] })
  await page.selectOption('[data-testid=customer-select]', 'A')
  await page.waitForTimeout(100)
  const body = await page.textContent('[data-testid=history]')
  assert.ok(body.includes('동의'), '동의 전에는 현재고객 저장 목록 비표시 안내')
  await page.click('[data-testid=history-refresh]')
  await page.waitForTimeout(100)
  assert.equal(await page.$('[data-testid=history-demo-list]'), null, 'DEMO 이력 목록 UI 자체가 없음')
  const full = await page.textContent('[data-testid=history]')
  assert.ok(!full.includes('run-demo'), 'DEMO 저장분석은 운영 이력에 노출되지 않음')
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
