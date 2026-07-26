import { useEffect, useState } from 'react'
import { KeyRound, X, Loader2, ShieldCheck } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import {
  changeMyPassword,
  getRotationState,
  passwordError,
  subscribePasswordGate
} from '@renderer/services/commercial/passwordService'

/**
 * 비밀번호 변경 창.
 *
 * 초기 지급 비밀번호(sjos+번호 뒤 4자리)를 아직 쓰는 계정은 로그인할 때마다 한 번씩
 * 안내가 뜬다. 업무 중 잠기면 곤란하므로 '나중에'로 이번 세션은 넘길 수 있지만,
 * 바꾸기 전까지는 다음 접속에서 다시 뜬다. 메뉴에서 언제든 직접 열 수도 있다.
 */

const SKIP_KEY = 'sj-pw-rotate-skip-v1'

export default function PasswordChangeGate(): JSX.Element | null {
  const { session } = useSession()
  const [open, setOpen] = useState(false)
  const [required, setRequired] = useState(false)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(false)
  const [myPhone, setMyPhone] = useState<string | undefined>(undefined)

  // 로그인 후 1회 안내 — 아직 한 번도 안 바꾼 계정만.
  useEffect(() => {
    if (!session.isLoggedIn) return
    let alive = true
    void getRotationState().then((r) => {
      if (!alive || !r.configured) return
      setMyPhone(r.phone)
      if (!r.needsRotation) return
      setRequired(true)
      const skipped = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SKIP_KEY) === '1'
      if (!skipped) setOpen(true)
    })
    return () => {
      alive = false
    }
  }, [session.isLoggedIn])

  // 메뉴에서 수동으로 열기
  useEffect(
    () =>
      subscribePasswordGate(() => {
        setDone(false)
        setPw('')
        setPw2('')
        setMsg('')
        setOpen(true)
      }),
    []
  )

  const later = (): void => {
    try {
      sessionStorage.setItem(SKIP_KEY, '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }

  const submit = async (): Promise<void> => {
    setMsg('')
    if (pw !== pw2) {
      setMsg('두 번 입력한 비밀번호가 다릅니다.')
      return
    }
    const invalid = passwordError(pw, myPhone)
    if (invalid) {
      setMsg(invalid)
      return
    }
    setBusy(true)
    const r = await changeMyPassword(pw, myPhone)
    setBusy(false)
    if (!r.ok) {
      setMsg(r.error ?? '변경에 실패했습니다.')
      return
    }
    setDone(true)
    setRequired(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-800 bg-white p-4 shadow-xl sm:rounded-2xl sm:p-5">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-100">
            <KeyRound className="h-4 w-4 text-[#b0821f]" /> 비밀번호 변경
          </h3>
          <button type="button" onClick={later} aria-label="닫기" className="rounded-lg p-1 text-slate-400 hover:text-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="py-6 text-center">
            <ShieldCheck className="mx-auto mb-2 h-10 w-10 text-emerald-600" />
            <p className="text-[13px] font-bold text-slate-100">비밀번호가 변경되었습니다.</p>
            <p className="mt-1 text-[12px] leading-5 text-slate-500">
              다음 로그인부터 새 비밀번호를 사용해주세요. 이 기기의 자동 로그인 정보는 지워졌습니다.
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-4 rounded-lg bg-[#0e1e3a] px-5 py-2 text-[12px] font-extrabold text-[#e6c877] hover:brightness-125"
            >
              확인
            </button>
          </div>
        ) : (
          <>
            {required ? (
              <p className="mb-3 rounded-lg border border-[#c6982f]/40 bg-[#fdf7ea] p-2.5 text-[12px] leading-5 text-slate-600">
                처음 받으신 비밀번호를 그대로 쓰고 계십니다. 이 비밀번호는 <b className="text-slate-800">휴대폰 번호로 추측이 가능</b>해
                다른 사람이 로그인할 수 있습니다. 지금 바꿔주세요.
              </p>
            ) : (
              <p className="mb-3 text-[12px] leading-5 text-slate-500">새 비밀번호를 입력해주세요. (영문+숫자 8자 이상)</p>
            )}

            <label className="block">
              <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">새 비밀번호</span>
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="new-password"
                placeholder="영문+숫자 8자 이상"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-[13px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
              />
            </label>
            <label className="mt-2 block">
              <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">새 비밀번호 확인</span>
              <input
                type="password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                autoComplete="new-password"
                placeholder="한 번 더 입력"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-[13px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
              />
            </label>

            {msg ? <div className="mt-2 text-[11px] font-medium text-rose-600">{msg}</div> : null}

            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !pw || !pw2}
              className={[
                'mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-[13px] font-extrabold',
                busy || !pw || !pw2
                  ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                  : 'bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] text-[#e6c877]'
              ].join(' ')}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} 비밀번호 바꾸기
            </button>

            <div className="mt-3 text-center">
              <button type="button" onClick={later} className="text-[12px] font-semibold text-slate-500 hover:text-slate-100">
                나중에 하기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
