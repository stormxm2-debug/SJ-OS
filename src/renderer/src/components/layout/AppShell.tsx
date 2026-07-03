import { useEffect } from 'react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import Router from '../Router'
import JarvisPanel from '@renderer/components/jarvis/JarvisPanel'
import JarvisLauncher from '@renderer/components/jarvis/JarvisLauncher'

/**
 * The CEO command center frame: persistent sidebar + topbar wrapping the
 * active view, which is chosen by the in-renderer Router.
 */
export default function AppShell(): JSX.Element {
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
        <main className="flex-1 overflow-y-auto p-6">
          <Router />
        </main>
      </div>
      <JarvisPanel />
      <JarvisLauncher />
      {/* Interaction-health indicator. pointer-events-none so it can never block
          clicks; confirms the stabilization build is running. */}
      <div className="pointer-events-none fixed bottom-2 left-2 z-30 inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-white/90 px-2 py-0.5 text-[10px] font-medium text-emerald-600 shadow-sm">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        안정화 모드 · UI 클릭 가능
      </div>
    </div>
  )
}
