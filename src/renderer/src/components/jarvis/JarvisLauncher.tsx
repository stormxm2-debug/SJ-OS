import { useEffect, useState } from 'react'
import { Bot, Sparkles } from 'lucide-react'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'

/**
 * Persistent floating "자비스" launcher — 홀로그램 코어의 미니어처.
 *
 * The CEO should always have a visible way to open Jarvis without relying on the
 * hidden Ctrl+Space shortcut. This button lives at the app root (a sibling of
 * <JarvisPanel />) and opens the panel via the shared jarvisService singleton,
 * which the panel auto-focuses (`#jarvis-command-input`) on open.
 *
 * Click-lock safety:
 * - The button is a small, self-contained fixed element — never a full-screen
 *   overlay — so it can never trap clicks across the app.
 * - z-40 keeps it above normal content but below the panel's z-50 overlay.
 * - Hidden while Jarvis is open; returns the moment it closes.
 *
 * 색은 앱 토큰 리매핑과 무관하게 보이도록 명시적 hex로만 지정한다.
 */
export default function JarvisLauncher(): JSX.Element | null {
  const [isOpen, setIsOpen] = useState<boolean>(() => jarvisService.getState().isOpen)

  useEffect(() => {
    const sync = (): void => setIsOpen(jarvisService.getState().isOpen)
    sync()
    return jarvisService.subscribe(sync)
  }, [])

  if (isOpen) {
    return null
  }

  return (
    <button
      type="button"
      // open() is idempotent — if Jarvis is somehow already open this simply
      // keeps it open and re-focuses the input, bringing it back to front.
      onClick={() => jarvisService.open()}
      title="자비스 열기 (Ctrl+Space)"
      aria-label="자비스 열기"
      className="group fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold transition hover:brightness-110"
      style={{
        background: 'linear-gradient(135deg, #0d2547 0%, #0b3f74 55%, #155e8f 100%)',
        border: '1px solid rgba(103,232,249,0.45)',
        color: '#eaf6ff',
        boxShadow: '0 0 26px -4px rgba(56,189,248,0.75), 0 8px 24px -10px rgba(0,0,0,0.6)'
      }}
    >
      <style>{`
        @keyframes jarvis-launcher-ping { 0% { transform: scale(1); opacity: .5; } 100% { transform: scale(1.55); opacity: 0; } }
      `}</style>
      {/* 호흡 글로우 링 */}
      <span
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{ border: '1px solid rgba(103,232,249,0.5)', animation: 'jarvis-launcher-ping 2.4s ease-out infinite' }}
        aria-hidden
      />
      <span
        className="relative flex h-6 w-6 items-center justify-center rounded-full"
        style={{ background: 'radial-gradient(circle at 32% 28%, #9be8ff, #38bdf8 45%, #0b3f74)', boxShadow: '0 0 12px rgba(56,189,248,0.8)' }}
      >
        <Bot className="h-3.5 w-3.5 text-white" />
      </span>
      <span className="relative bg-gradient-to-r from-[#9be8ff] via-[#eaf6ff] to-[#e6c877] bg-clip-text tracking-wide text-transparent">
        자비스
      </span>
      <Sparkles className="relative h-3.5 w-3.5" style={{ color: '#e6c877' }} />
    </button>
  )
}
