import { NavigationProvider } from './navigation/NavigationContext'
import { AppModeProvider } from './navigation/AppModeContext'
import { SessionProvider, useSession } from './navigation/SessionContext'
import AppShell from './components/layout/AppShell'
import LoginScreen from './components/layout/LoginScreen'

/** Gates the shell behind the local MVP login (default owner is pre-logged-in). */
function AppGate(): JSX.Element {
  const { session } = useSession()
  return session.isLoggedIn ? <AppShell /> : <LoginScreen />
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
