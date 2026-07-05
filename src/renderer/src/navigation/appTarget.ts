import { useEffect, useState } from 'react'

/**
 * App-target detection for the desktop/mobile split.
 *
 * - desktop-electron: running inside the Electron desktop app at a normal width.
 * - mobile-pwa: a mobile-width viewport (phone browser / installed PWA).
 * - web-staff: a desktop-width browser (not Electron).
 *
 * The active SHELL is chosen by viewport width so mobile can be tested in devtools
 * too; the target label is derived from runtime + viewport. No secrets/env used.
 */

export type AppTarget = 'desktop-electron' | 'mobile-pwa' | 'web-staff'

const MOBILE_MAX = 767

export function isElectronRuntime(): boolean {
  if (typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)) return true
  // Preload bridge is present only inside Electron.
  return typeof window !== 'undefined' && !!(window as unknown as { sj?: unknown }).sj
}

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth <= MOBILE_MAX
}

export function detectAppTarget(): AppTarget {
  if (isMobileViewport()) return 'mobile-pwa'
  return isElectronRuntime() ? 'desktop-electron' : 'web-staff'
}

/** React hook: true when the viewport is mobile-width (live-updates on resize). */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState<boolean>(() => isMobileViewport())
  useEffect(() => {
    const onResize = (): void => setMobile(isMobileViewport())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return mobile
}
