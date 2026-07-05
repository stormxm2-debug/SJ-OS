import { NavigationProvider } from './navigation/NavigationContext'
import { AppModeProvider } from './navigation/AppModeContext'
import { SessionProvider, useSession } from './navigation/SessionContext'
import AppShell from './components/layout/AppShell'
import LoginScreen from './components/layout/LoginScreen'

/**
 * Gates the shell behind login. local-demo: owner is pre-logged-in. supabase-auth:
 * requires a valid Supabase session + active profile (authState 'logged-in').
 */
function AppGate(): JSX.Element {
  const { authState } = useSession()
  return authState === 'logged-in' ? <AppShell /> : <LoginScreen />
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
