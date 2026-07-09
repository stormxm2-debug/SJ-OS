import { useState } from 'react'
import { LogIn, Loader2, AlertTriangle, KeyRound, Smartphone } from 'lucide-react'
import BrandLogo from '@renderer/components/brand/BrandLogo'
import { useSession } from '@renderer/navigation/SessionContext'
import { DEMO_USERS, ROLE_LABEL } from '@renderer/navigation/roleAccess'
import { validatePassword } from '@renderer/services/commercial/phoneAuthService'

/**
 * SJ OS login — simple, admin-managed phone + password.
 *
 * EVERYONE (staff AND admin/owner) logs in with 휴대폰 번호 / 비밀번호 — there is no
 * email login. First-password setup appears inline only for a registered phone whose
 * password is not set. The local-demo picker shows ONLY when Supabase is not
 * configured (dev machines). Never shows or logs phone/password/tokens.
 */
export default function LoginScreen(): JSX.Element {
  const { phoneSignIn, claimPhonePassword, requestPhoneReset, login, supabaseConfigured } = useSession()

  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  // first-password setup
  const [setupPhone, setSetupPhone] = useState<string | null>(null)
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [setupMsg, setSetupMsg] = useState<string | undefined>()

  // forgot password
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotPhone, setForgotPhone] = useState('')
  const [forgotMsg, setForgotMsg] = useState<string | undefined>()

  const onLogin = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(undefined); setSetupMsg(undefined); setSetupPhone(null)
    setBusy(true)
    const r = await phoneSignIn(phone, password)
    setBusy(false)
    if (r.kind === 'needs-setup') { setSetupPhone(r.normalizedPhone); return }
    if (r.kind === 'error') setError(r.message)
    // 'ok' → AppGate switches to the app.
  }

  const onSetup = async (): Promise<void> => {
    if (!setupPhone) return
    const v = validatePassword(pw1, pw2)
    if (!v.ok) { setSetupMsg(v.errors[0]); return }
    setBusy(true)
    const res = await claimPhonePassword(setupPhone, pw1)
    setBusy(false)
    setSetupMsg(res.message)
    if (res.ok) { setPw1(''); setPw2(''); setSetupPhone(null); setPassword('') }
  }

  const onForgot = (): void => {
    const res = requestPhoneReset(forgotPhone)
    setForgotMsg(res.message)
  }

  return (
    <div className="flex min-h-screen w-screen items-center justify-center overflow-y-auto bg-gradient-to-br from-[#eef3fb] via-[#f5f8fd] to-[#e9eff9] p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 shadow-lg">
        <div className="mb-6 flex flex-col items-center gap-1.5">
          <BrandLogo markClassName="h-12" showTagline wordmarkClassName="text-2xl" />
          <div className="mt-1 text-xs font-medium text-slate-500">보험 업무 플랫폼 · 로그인</div>
        </div>

        {/* Primary: phone + password */}
        <form onSubmit={onLogin} className="space-y-2">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3">
            <Smartphone className="h-4 w-4 text-slate-400" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="휴대폰 번호" autoComplete="username"
              className="w-full py-2.5 text-sm text-slate-100 focus:outline-none" />
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3">
            <KeyRound className="h-4 w-4 text-slate-400" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호" autoComplete="current-password"
              className="w-full py-2.5 text-sm text-slate-100 focus:outline-none" />
          </div>
          <button type="submit" disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} 로그인
          </button>
        </form>

        {error ? <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600"><AlertTriangle className="mr-1 inline h-3 w-3" />{error}</div> : null}

        {/* First-password setup (only when phone is registered & not set) */}
        {setupPhone ? (
          <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
            <div className="text-[12px] font-semibold text-slate-300">최초 비밀번호 설정이 필요합니다.</div>
            <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="새 비밀번호 (8자 이상, 영문+숫자)" className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="새 비밀번호 확인" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
            <button type="button" onClick={() => void onSetup()} disabled={busy} className="mt-2 w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white disabled:opacity-60">비밀번호 설정</button>
            {setupMsg ? <p className="mt-2 text-[11px] text-slate-600">{setupMsg}</p> : null}
          </div>
        ) : null}

        {/* Forgot password */}
        <div className="mt-3 text-center">
          <button type="button" onClick={() => { setForgotOpen((v) => !v); setForgotMsg(undefined) }} className="text-[12px] font-medium text-indigo-600">비밀번호 찾기</button>
        </div>
        {forgotOpen ? (
          <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <input value={forgotPhone} onChange={(e) => setForgotPhone(e.target.value)} inputMode="tel" placeholder="휴대폰 번호" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
            <button type="button" onClick={onForgot} className="mt-2 w-full rounded-lg border border-indigo-300 bg-white py-2 text-sm font-semibold text-indigo-600">재설정 요청</button>
            {forgotMsg ? <p className="mt-2 text-[11px] text-slate-600">{forgotMsg}</p> : null}
          </div>
        ) : null}

        <p className="mt-4 text-center text-[11px] text-slate-400">등록된 직원만 이용할 수 있습니다.</p>

        {/* Local dev ONLY (Supabase not configured): demo-user picker. Production has no email login. */}
        {!supabaseConfigured ? (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="mb-1 text-[10px] font-semibold text-slate-500">로컬 MVP 로그인 (개발/테스트)</div>
              <div className="flex flex-wrap gap-1">
                {DEMO_USERS.map((u) => (
                  <button key={u.id} type="button" onClick={() => login(u)} className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50">
                    {u.name}·{ROLE_LABEL[u.role]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
