import { ShieldAlert, Home } from 'lucide-react'
import { useNavigation } from '@renderer/navigation/NavigationContext'

/**
 * Shown (instead of the page) when a non-admin role reaches an admin-only route.
 * Never crashes, never blanks the screen — just a friendly card with a way home.
 */
export default function AccessDenied(): JSX.Element {
  const { navigate } = useNavigation()
  return (
    <div className="mx-auto mt-10 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100">
        <ShieldAlert className="h-7 w-7 text-amber-600" />
      </div>
      <h2 className="text-lg font-bold text-slate-800">접근 권한이 없습니다</h2>
      <p className="mt-2 text-sm text-slate-500">이 메뉴는 대표/관리자 권한에서만 사용할 수 있습니다.</p>
      <button
        type="button"
        onClick={() => navigate({ name: 'staff-home' })}
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
      >
        <Home className="h-4 w-4" /> 홈으로 이동
      </button>
    </div>
  )
}
