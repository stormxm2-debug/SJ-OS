import { NavigationProvider } from './navigation/NavigationContext'
import { AppModeProvider } from './navigation/AppModeContext'
import { SessionProvider, useSession } from './navigation/SessionContext'
import { useIsMobile } from './navigation/appTarget'
import AppShell from './components/layout/AppShell'
import MobileShell from './components/layout/MobileShell'
import LoginScreen from './components/layout/LoginScreen'

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

export default function App(): JSX.Element {
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
