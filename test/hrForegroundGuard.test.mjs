// 진행 중 start/confirm/invite 의 늦은 응답이 바뀐 고객·상품·입력방식·저장결과 화면을 덮지 않는지(표시용 가드).
// 실제 서비스는 호출하지 않는다 — deferred mock 으로 HealthRecordPage 핸들러 흐름을 그대로 재현.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

async function load(src) {
  const output = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: 'tsconfig.web.json', logLevel: 'silent' })
  const dir = await mkdtemp(join(tmpdir(), 'sj-hr-fg-')), file = join(dir, 'module.mjs')
  await writeFile(file, output.outputFiles[0].text)
  return import(pathToFileURL(file).href)
}
const v = await load('src/renderer/src/services/health-record/healthStatusView.ts')
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}

// HealthRecordPage 의 상태·핸들러를 축약한 화면 모델(같은 helper, 같은 순서).
function screen() {
  const fg = v.createForegroundGuard()
  const s = { customer: 'A', product: 'p1', mode: 'staff', busy: null, inviteBusy: false, result: null, requestId: undefined, twoWay: undefined, invite: null, notice: null, error: null, configNote: null, refreshes: 0 }
  const calls = []
  const svc = (kind) => (args) => { const d = deferred(); calls.push({ kind, args, d }); return d.promise }
  const drop = () => { const was = fg.invalidate(); s.busy = null; s.inviteBusy = false; return was }
  const begin = () => { drop(); return fg.begin() }
  const switchTo = (patch) => {
    const had = drop()
    Object.assign(s, patch, { result: null, requestId: undefined, twoWay: undefined, invite: null, error: null, configNote: null, notice: had ? v.PREV_REQUEST_NOTE : null })
  }
  const start = svc('start'), confirm = svc('confirm'), invite = svc('invite')
  return {
    s, calls, fg,
    selectCustomer: (id) => switchTo({ customer: id }),
    changeProduct: (k) => switchTo({ product: k }),
    toggleMode: () => {
      const had = drop()
      s.mode = s.mode === 'staff' ? 'customer' : 'staff'; s.invite = null; s.error = null
      if (had) s.notice = v.PREV_REQUEST_NOTE
    },
    viewSaved: (h) => { drop(); Object.assign(s, { error: null, configNote: null, twoWay: undefined, invite: null, requestId: h.id, result: h.result, notice: '저장된 결과' }) },
    onStart: async () => {
      const t = begin()
      Object.assign(s, { error: null, notice: null, configNote: null, result: null, twoWay: undefined, requestId: undefined })
      s.busy = 'start'
      const ctx = { customer: s.customer, product: s.product }
      return v.runForeground(fg, t, {
        work: () => start(ctx),
        apply: (r) => { s.requestId = r.requestId; s.twoWay = r.twoWay; if (r.status === 'completed') s.result = r.result; s.notice = '승인해 주세요'; s.refreshes++ },
        fail: () => { s.error = '요청 중 오류가 발생했습니다.' },
        settle: () => { s.busy = null },
        stale: () => { s.refreshes++ }
      })
    },
    onConfirm: async () => {
      const t = begin()
      s.error = null; s.busy = 'confirm'
      return v.runForeground(fg, t, {
        work: () => confirm({ requestId: s.requestId }),
        apply: (r) => { s.result = r.result; s.requestId = r.requestId; s.twoWay = undefined; s.notice = '건강기록을 받아왔습니다.' },
        fail: () => { s.error = '조회 중 오류가 발생했습니다.' },
        settle: () => { s.busy = null },
        stale: () => { s.refreshes++ }
      })
    },
    onInvite: async () => {
      const t = begin()
      Object.assign(s, { error: null, notice: null, configNote: null, invite: null, result: null, requestId: undefined })
      s.inviteBusy = true
      return v.runForeground(fg, t, {
        work: () => invite({ customer: s.customer }),
        apply: (r) => { s.invite = { url: r.url } },
        fail: () => { s.error = '링크 생성 중 오류가 발생했습니다.' },
        settle: () => { s.inviteBusy = false },
        stale: () => { s.refreshes++ }
      })
    }
  }
}

test('정상 현재 응답은 기존처럼 적용되고 busy 해제', async () => {
  const h = screen()
  const p = h.onStart()
  assert.equal(h.s.busy, 'start'); assert.equal(h.fg.pending(), true)
  h.calls[0].d.resolve({ requestId: 'rA', twoWay: { jti: 1 }, status: 'awaiting_auth' })
  assert.equal(await p, 'applied')
  assert.equal(h.s.requestId, 'rA'); assert.deepEqual(h.s.twoWay, { jti: 1 }); assert.equal(h.s.busy, null); assert.equal(h.fg.pending(), false)
  const c = h.onConfirm()
  h.calls[1].d.resolve({ result: { a: 1 }, requestId: 'rA' })
  assert.equal(await c, 'applied'); assert.deepEqual(h.s.result, { a: 1 }); assert.equal(h.s.twoWay, undefined)
  h.selectCustomer('B') // 완료 후 전환은 "이전 요청" 안내 없음
  assert.equal(h.s.notice, null)
})

test('재현1: A start 보류 → B 선택 → A completed 반환 = B 화면 그대로', async () => {
  const h = screen()
  const p = h.onStart()
  h.selectCustomer('B')
  assert.equal(h.s.busy, null, '전환 즉시 이전 busy 정리'); assert.equal(h.s.notice, v.PREV_REQUEST_NOTE)
  h.calls[0].d.resolve({ requestId: 'rA', twoWay: undefined, status: 'completed', result: { who: 'A' } })
  assert.equal(await p, 'stale')
  assert.equal(h.s.customer, 'B'); assert.equal(h.s.result, null); assert.equal(h.s.requestId, undefined); assert.equal(h.s.notice, v.PREV_REQUEST_NOTE)
  assert.equal(h.s.refreshes, 1, '최근 요청 목록만 수동 갱신')
  assert.equal(h.calls.length, 1, '서버 재호출/취소 없음')
  const p2 = h.onStart() // B 는 새로 요청 가능
  assert.deepEqual(h.calls[1].args, { customer: 'B', product: 'p1' })
  h.calls[1].d.resolve({ requestId: 'rB', twoWay: { jti: 2 }, status: 'awaiting_auth' })
  assert.equal(await p2, 'applied'); assert.equal(h.s.requestId, 'rB')
})

test('재현2: A invite 보류 → B 선택 → A 링크 반환 = B 폼에 A URL 없음', async () => {
  const h = screen()
  h.s.mode = 'customer'
  const p = h.onInvite()
  assert.equal(h.s.inviteBusy, true)
  h.selectCustomer('B')
  assert.equal(h.s.inviteBusy, false)
  h.calls[0].d.resolve({ url: 'https://x/A' })
  assert.equal(await p, 'stale'); assert.equal(h.s.invite, null); assert.equal(h.s.inviteBusy, false)
  const p2 = h.onInvite()
  h.calls[1].d.resolve({ url: 'https://x/B' }); await p2
  assert.deepEqual(h.s.invite, { url: 'https://x/B' })
})

test('재현3: 상품 start 보류 → 상품 변경 → 옛 상품 completed = 새 상품 폼에 결과/성공 없음', async () => {
  const h = screen()
  const p = h.onStart()
  h.changeProduct('my-medicine')
  h.calls[0].d.resolve({ requestId: 'r1', status: 'completed', result: { old: true } })
  assert.equal(await p, 'stale')
  assert.equal(h.s.product, 'my-medicine'); assert.equal(h.s.result, null); assert.notEqual(h.s.notice, '승인해 주세요')
})

test('늦은 confirm/start 가 저장 결과 열람·입력방식 전환을 덮지 않음', async () => {
  const h = screen()
  h.s.twoWay = { jti: 1 }; h.s.requestId = 'rA'
  const p = h.onConfirm()
  h.viewSaved({ id: 'saved', result: { saved: 1 } })
  assert.equal(h.s.busy, null)
  h.calls[0].d.resolve({ result: { late: 1 }, requestId: 'rA' })
  assert.equal(await p, 'stale')
  assert.deepEqual(h.s.result, { saved: 1 }); assert.equal(h.s.requestId, 'saved')
  const h2 = screen()
  const p2 = h2.onStart()
  h2.toggleMode()
  h2.calls[0].d.resolve({ requestId: 'r', twoWay: { jti: 9 }, status: 'awaiting_auth' }); await p2
  assert.equal(h2.s.mode, 'customer'); assert.equal(h2.s.twoWay, undefined); assert.equal(h2.s.notice, v.PREV_REQUEST_NOTE)
})

test('오래된 catch/finally 가 새 작업 busy·오류를 덮지 않음', async () => {
  const h = screen()
  const pA = h.onStart()
  h.selectCustomer('B')
  const pB = h.onStart()
  assert.equal(h.s.busy, 'start')
  h.calls[0].d.reject(new Error('A 네트워크'))
  assert.equal(await pA, 'stale')
  assert.equal(h.s.busy, 'start', 'A finally 가 B busy 를 해제하지 않음'); assert.equal(h.s.error, null, 'A 오류가 B 화면에 안 뜸')
  h.calls[1].d.resolve({ requestId: 'rB', twoWay: { jti: 2 }, status: 'awaiting_auth' })
  assert.equal(await pB, 'applied'); assert.equal(h.s.busy, null); assert.equal(h.s.requestId, 'rB')
  const pC = h.onInvite() // 현재 작업의 실패는 그대로 표시
  h.calls[2].d.reject(new Error('x'))
  assert.equal(await pC, 'failed')
  assert.equal(h.s.error, '링크 생성 중 오류가 발생했습니다.'); assert.equal(h.s.inviteBusy, false)
})

test('새 작업 시작은 다른 종류의 진행 중 작업(busy/inviteBusy)도 정리', async () => {
  const h = screen()
  const pI = h.onInvite()
  const pS = h.onStart()
  assert.equal(h.s.inviteBusy, false); assert.equal(h.s.busy, 'start')
  h.calls[0].d.resolve({ url: 'https://x/old' })
  assert.equal(await pI, 'stale'); assert.equal(h.s.invite, null); assert.equal(h.s.busy, 'start')
  h.calls[1].d.resolve({ requestId: 'r', status: 'awaiting_auth' })
  assert.equal(await pS, 'applied')
})

test('guard: invalidate 는 진행 중일 때만 true, 완료된 작업 뒤에는 false', async () => {
  const g = v.createForegroundGuard()
  assert.equal(g.invalidate(), false)
  const t1 = g.begin(); assert.equal(t1.isCurrent(), true)
  const t2 = g.begin(); assert.equal(t1.isCurrent(), false); assert.equal(t2.isCurrent(), true)
  assert.equal(g.invalidate(), true); assert.equal(t2.isCurrent(), false); assert.equal(g.pending(), false)
  const t3 = g.begin()
  let settled = 0
  await v.runForeground(g, t3, { work: async () => 1, apply: () => {}, fail: () => {}, settle: () => { settled++ } })
  assert.equal(settled, 1); assert.equal(g.pending(), false); assert.equal(g.invalidate(), false)
})

test('HealthRecordPage 배선: 전환 4곳 무효화, 3개 핸들러 가드, 진행 중 요청변수 잠금', async () => {
  const src = (await readFile('src/renderer/src/pages/HealthRecordPage.tsx', 'utf8')).replace(/\r\n/g, '\n')
  const body = (name) => {
    const i = src.indexOf(`const ${name} =`)
    assert.ok(i > 0, name)
    return src.slice(i, src.indexOf('\n  }\n', i))
  }
  for (const n of ['onSelectCustomer', 'onProductChange', 'viewSaved']) assert.match(body(n), /dropForeground\(\)/, n)
  assert.match(src, /const hadPending = dropForeground\(\) \/\/ 입력방식 전환/)
  for (const n of ['onStart', 'onConfirm', 'onInvite']) {
    const b = body(n)
    assert.match(b, /const task = beginForeground\(\)/, n)
    assert.match(b, /runForeground\(fg, task,/, n)
    assert.doesNotMatch(b, /finally/, `${n}: 가드 밖 finally 없음`)
  }
  const lines = src.split('\n')
  for (const id of ['hr-name', 'hr-phone', 'hr-start', 'hr-end', 'hr-provider', 'hr-telecom']) {
    const line = lines.find((l) => l.includes(`id="${id}"`) && /<(input|select)/.test(l))
    assert.match(line, /disabled=\{lockParams\}/, id)
  }
  assert.equal((src.match(/setIdValue\(e\.target\.value\)\} disabled=\{lockParams\}/g) || []).length, 2)
  for (const id of ['hr-customer', 'hr-product']) {
    const line = lines.find((l) => l.includes(`id="${id}"`) && /<select/.test(l))
    assert.doesNotMatch(line, /disabled=/, `${id}: 진행 중에도 전환 가능`)
  }
})
