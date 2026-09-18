/**
 * 운영 주소 일원화 (2026-09-18) — 옛 주소 sj-invest-web.pages.dev 로 들어오면
 * 운영 주소 sj-invest.pages.dev 로 같은 경로 그대로 옮긴다. 옛 링크·그 주소로 설치한
 * 폰 앱도 계속 동작한다. 작업 가지 미리보기(<id>.sj-invest-web.pages.dev)는 그대로 둔다.
 *
 * CSP(script-src 'self') 때문에 인라인이 아닌 별도 파일. 번들보다 먼저 실행된다.
 */
;(function () {
  'use strict'
  if (location.hostname === 'sj-invest-web.pages.dev') {
    location.replace('https://sj-invest.pages.dev' + location.pathname + location.search + location.hash)
  }
})()
