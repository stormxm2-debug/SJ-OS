import Sidebar from './Sidebar'
import Topbar from './Topbar'
import Router from '../Router'

/**
 * The CEO command center frame: persistent sidebar + topbar wrapping the
 * active view, which is chosen by the in-renderer Router.
 */
export default function AppShell(): JSX.Element {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">
          <Router />
        </main>
      </div>
    </div>
  )
}
