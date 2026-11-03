// E2E 하네스 엔트리: 실제 ClaimFinderPage 를 합성 어댑터로 렌더(운영 인증 우회 없음).
import React from 'react'
import { createRoot } from 'react-dom/client'
import ClaimFinderPage from '@renderer/pages/ClaimFinderPage'

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(React.createElement(ClaimFinderPage))
  ;(globalThis as unknown as { __READY?: boolean }).__READY = true
}
