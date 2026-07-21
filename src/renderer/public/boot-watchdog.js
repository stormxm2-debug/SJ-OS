/**
 * 부팅 워치독 — 배포 직후 CDN 엣지 미전파 등으로 번들 하위 청크 로드가 소리 없이
 * 멈추면(콘솔 무에러·#root 빈 채 영원히 백화면) 1회 자동 새로고침으로 자가 복구한다.
 * 두 번째도 실패하면 안내 문구+다시 시도 버튼을 띄운다. (2026-07-21 백화면 사건 —
 * 같은 번들이 재로드에선 정상 렌더됨을 두 차례 확인)
 *
 * CSP(script-src 'self') 때문에 인라인이 아닌 별도 파일이며, 번들과 독립적으로
 * 로드된다. 데스크톱(Electron)은 로컬 파일이라 항상 즉시 렌더 → 사실상 무동작.
 */
;(function () {
  'use strict'
  var KEY = 'sj-boot-retry'
  var TIMEOUT_MS = 8000

  function rootEmpty() {
    var root = document.getElementById('root')
    return !root || root.children.length === 0
  }

  function showRetryUi() {
    var root = document.getElementById('root')
    if (!root) return
    root.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0e1e3a;font-family:sans-serif;padding:24px;text-align:center">' +
      '<div><div style="color:#e6c877;font-size:20px;font-weight:800;letter-spacing:.08em">SJ INVEST</div>' +
      '<p style="color:rgba(255,255,255,.75);font-size:13px;line-height:1.6;margin:14px 0 18px">연결이 원활하지 않습니다.<br>잠시 후 다시 시도해 주세요.</p>' +
      '<button id="sj-boot-retry-btn" style="background:#e6c877;color:#0e1e3a;border:0;border-radius:10px;padding:10px 22px;font-size:14px;font-weight:800;cursor:pointer">다시 시도</button>' +
      '</div></div>'
    var btn = document.getElementById('sj-boot-retry-btn')
    if (btn)
      btn.addEventListener('click', function () {
        try {
          sessionStorage.removeItem(KEY)
        } catch (e) {
          /* ignore */
        }
        location.reload()
      })
  }

  function arm() {
    setTimeout(function () {
      if (!rootEmpty()) {
        try {
          sessionStorage.removeItem(KEY)
        } catch (e) {
          /* ignore */
        }
        return
      }
      var tried = null
      try {
        tried = sessionStorage.getItem(KEY)
      } catch (e) {
        /* ignore */
      }
      if (!tried) {
        try {
          sessionStorage.setItem(KEY, '1')
        } catch (e) {
          /* ignore */
        }
        location.reload()
      } else {
        showRetryUi()
      }
    }, TIMEOUT_MS)
  }

  if (document.readyState === 'complete') arm()
  else window.addEventListener('load', arm)
})()
