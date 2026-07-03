import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'

/**
 * Persistent floating "자비스 열기" launcher.
 *
 * The CEO should always have a visible way to open Jarvis without relying on the
 * hidden Ctrl+Space shortcut. This button lives at the app root (a sibling of
 * <JarvisPanel />) and opens the panel via the shared jarvisService singleton,
 * which the panel auto-focuses (`#jarvis-command-input`) on open.
 *
 * Click-lock safety:
 * - The button is a small, self-contained fixed element — never a full-screen
 *   overlay — so it can never trap clicks across the app.
 * - z-40 keeps it above normal content but below the panel's z-50 modal, so the
 *   panel's backdrop sits on top while Jarvis is open.
 * - We hide the button while Jarvis is open to avoid a stray element peeking
 *   through the backdrop; it returns the moment Jarvis closes, so it stays
 *   reliably clickable after any command runs.
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
      title="자비스 열기"
      aria-label="자비스 열기"
      className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-black/40 transition hover:bg-indigo-500"
    >
      <Bot className="h-5 w-5" />
      자비스
    </button>
  )
}
