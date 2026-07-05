import { useState } from 'react'
import { Bot, LogIn, Loader2, AlertTriangle, LogOut } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { DEMO_USERS, ROLE_LABEL } from '@renderer/navigation/roleAccess'

/**
 * Login shell for both auth modes.
 *
 * - local-demo: demo account picker (no real auth). Label "로컬 MVP 로그인".
 * - supabase-auth: real Supabase email/password login; role comes from the profile.
 *
 * Renders as a full page (not a modal backdrop) so it never blocks clicks. Never
 * shows tokens/passwords/keys.
 */
export default function LoginScreen(): JSX.Element {
  const { authMode, authState, authError, supabaseSignIn, logout, login } = useSession()

  if (authMode === 'supabase-auth') {
    return <SupabaseLogin authState={authState} authError={authError} onSignIn={supabaseSignIn} onLogout={logout} />
  }

  // local-demo
  return (
    <Frame subtitle="보험 업무 플랫폼 · 로컬 MVP 로그인">
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
      <p className="mt-5 text-center text-[11px] text-slate-400">이 로그인은 로컬 데모용입니다. 실제 인증은 Supabase 설정 후 활성화됩니다.</p>
    </Frame>
  )
}

function SupabaseLogin({
  authState,
  authError,
  onSignIn,
  onLogout
}: {
  authState: string
  authError?: string
  onSignIn: (email: string, password: string) => Promise<void>
  onLogout: () => void
}): JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const busy = authState === 'loading'
  const blockedMsg = authState === 'profile-missing' || authState === 'blocked'

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!busy) void onSignIn(email, password)
  }

  return (
    <Frame subtitle="보험 업무 플랫폼 · Supabase Auth" badge="Supabase Auth">
      {authState === 'loading' && !authError ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 세션 확인 중…
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일"
            autoComplete="username"
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            autoComplete="current-password"
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} 로그인
          </button>
        </form>
      )}

      {authError ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600">
          <AlertTriangle className="mr-1 inline h-3 w-3" />
          {authError}
        </div>
      ) : null}

      {blockedMsg ? (
        <button type="button" onClick={onLogout} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50">
          <LogOut className="h-3 w-3" /> 로그아웃 후 다시 시도
        </button>
      ) : null}

      <p className="mt-5 text-center text-[11px] text-slate-400">Supabase Auth · 공용 anon key만 사용합니다. 토큰/비밀번호는 저장·표시되지 않습니다.</p>
    </Frame>
  )
}

function Frame({ children, subtitle, badge }: { children: ReactNodeLike; subtitle: string; badge?: string }): JSX.Element {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gradient-to-br from-[#eef3fb] via-[#f5f8fd] to-[#e9eff9] p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-md">
            <Bot className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-lg font-bold text-slate-800">
              SJ OS 로그인
              {badge ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">{badge}</span> : null}
            </div>
            <div className="text-xs text-slate-500">{subtitle}</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

type ReactNodeLike = React.ReactNode
