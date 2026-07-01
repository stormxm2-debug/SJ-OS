import { NavigationProvider } from './navigation/NavigationContext'
import AppShell from './components/layout/AppShell'

export default function App(): JSX.Element {
  return (
    <NavigationProvider>
      <AppShell />
    </NavigationProvider>
  )
}
