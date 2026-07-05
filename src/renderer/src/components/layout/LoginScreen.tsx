import { Bot, LogIn } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { DEMO_USERS, ROLE_LABEL } from '@renderer/navigation/roleAccess'

/**
 * Local MVP login shell — pick a demo account to sign in. This is NOT production
 * authentication; it is a local role switcher so staff UI can be tested. It renders
 * as a full page (not a modal backdrop) so it never blocks clicks elsewhere.
 *
 * Future: replace with a real login form + server session.
 */
export default function LoginScreen(): JSX.Element {
  const { login } = useSession()
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gradient-to-br from-[#eef3fb] via-[#f5f8fd] to-[#e9eff9] p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-md">
            <Bot className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-800">SJ OS 로그인</div>
            <div className="text-xs text-slate-500">보험 업무 플랫폼 · 상용 MVP 로컬 로그인</div>
          </div>
        </div>
        <div className="space-y-2">
          {DEMO_USERS.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => login(u)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50"
            >
              <div>
                <div className="text-sm font-semibold text-slate-800">{u.name} <span className="text-slate-400">· {u.position ?? ROLE_LABEL[u.role]}</span></div>
                <div className="text-[11px] text-slate-500">{ROLE_LABEL[u.role]}{u.teamName ? ` · ${u.teamName}` : ''}</div>
              </div>
              <LogIn className="h-4 w-4 text-indigo-500" />
            </button>
          ))}
        </div>
        <p className="mt-5 text-center text-[11px] text-slate-400">이 로그인은 로컬 데모용입니다. 실제 인증/서버 연동은 다음 단계에서 진행됩니다.</p>
      </div>
    </div>
  )
}
