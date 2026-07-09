import { useEffect } from 'react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import Router from '../Router'
import JarvisPanel from '@renderer/components/jarvis/JarvisPanel'
import NotificationCenter from '@renderer/components/notifications/NotificationCenter'
import ResolutionLockGate from '@renderer/components/attendance/ResolutionLockGate'
import { useWakeKey } from '@renderer/services/commercial/wakeResync'

/**
 * The CEO command center frame: persistent sidebar + topbar wrapping the
 * active view, which is chosen by the in-renderer Router.
 */
export default function AppShell(): JSX.Element {
  // 모바일/절전 복귀 시 전체 화면 재조회 — key 리마운트로 모든 화면이 최신 데이터를 다시 불러온다.
  const { wakeKey } = useWakeKey()

  // Interaction watchdog (long-session stability). A single 5s interval that
  // guarantees the app can never be left unclickable: if anything ever leaves
  // global pointer-events disabled on <body>/<html>, it is cleared. Registered
  // once, cleaned up on unmount — no accumulation, negligible overhead.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (typeof document === 'undefined') return
      if (document.body.style.pointerEvents === 'none') document.body.style.pointerEvents = ''
      if (document.documentElement.style.pointerEvents === 'none') {
        document.documentElement.style.pointerEvents = ''
      }
    }, 5000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gradient-to-br from-[#eef3fb] via-[#f5f8fd] to-[#e9eff9] text-slate-100">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main key={wakeKey} className="flex-1 overflow-y-auto p-6">
          <Router />
        </main>
      </div>
      {/* 자비스 플로팅 버튼은 대표 지시로 제거 (2026-07) — 자비스는 대시보드
          빠른 실행/단축키로 열 수 있고, 패널 자체는 유지된다. */}
      <JarvisPanel />
      {/* 우하단 알림 (고객등록 요청/처리) + 출근 후 다짐 잠금 — wakeKey로 함께
          리마운트해 realtime 구독도 복귀 시 새로 맺는다. */}
      <NotificationCenter key={`nc-${wakeKey}`} />
      <ResolutionLockGate key={`rg-${wakeKey}`} />
    </div>
  )
}
