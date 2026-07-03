import { NavigationProvider } from './navigation/NavigationContext'
import { AppModeProvider } from './navigation/AppModeContext'
import AppShell from './components/layout/AppShell'

export default function App(): JSX.Element {
  return (
    <AppModeProvider>
      <NavigationProvider>
        <AppShell />
      </NavigationProvider>
    </AppModeProvider>
  )
}
