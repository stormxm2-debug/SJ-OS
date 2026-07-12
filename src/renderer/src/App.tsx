import { NavigationProvider } from './navigation/NavigationContext'
import { AppModeProvider } from './navigation/AppModeContext'
import { SessionProvider, useSession } from './navigation/SessionContext'
import { useIsMobile } from './navigation/appTarget'
import AppShell from './components/layout/AppShell'
import MobileShell from './components/layout/MobileShell'
import LoginScreen from './components/layout/LoginScreen'
import PublicApplyPage from './pages/PublicApplyPage'

/**
 * Gates login, then picks the shell by viewport: mobile-width → MobileShell
 * (staff-only), otherwise the full desktop AppShell (Electron desktop unchanged).
 */
function AppGate(): JSX.Element {
  const { authState } = useSession()
  const isMobile = useIsMobile()
  if (authState !== 'logged-in') return <LoginScreen />
  return isMobile ? <MobileShell /> : <AppShell />
}

/** 셀프 유입 퍼널 공개 랜딩(?apply=1) — 로그인·세션 없이 렌더 (외부 방문자용). */
function isPublicApply(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('apply') === '1'
  } catch {
    return false
  }
}

export default function App(): JSX.Element {
  if (isPublicApply()) return <PublicApplyPage />
  return (
    <SessionProvider>
      <AppModeProvider>
        <NavigationProvider>
          <AppGate />
        </NavigationProvider>
      </AppModeProvider>
    </SessionProvider>
  )
}
