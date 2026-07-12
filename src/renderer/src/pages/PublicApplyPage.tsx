import { useMemo, useState } from 'react'
import { ShieldCheck, Check, PhoneCall, Sparkles } from 'lucide-react'
import { getFunctionsBaseUrl, getSupabaseAnonKey } from '@renderer/services/commercial/supabaseClient'

/**
 * 셀프 유입 퍼널 공개 랜딩 — 로그인 없이 접근하는 "무료 보험 보장분석 신청" 페이지.
 *
 * FC 개인 QR/링크(?apply=1&fc=<프로필id>&fcn=<이름>)로 진입한다. 신청은
 * public-lead-submit 엣지 함수가 접수해 leads로 들어가고(FC 귀속 또는 자동배정),
 * 기존 DB 배정 화면·알림 흐름을 그대로 탄다.
 *
 * 이 화면은 SessionProvider 밖에서 렌더된다(App 게이트에서 분기) — 앱 상태·로그인에
 * 의존하지 않는다. 스팸 방어용 허니팟(website) 필드를 숨겨 둔다.
 */

const INTERESTS = ['보험 점검·보장분석', '보험료 절감', '신규 가입 상담', '기타'] as const

export default function PublicApplyPage(): JSX.Element {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const fcCode = params.get('fc') ?? ''
  const fcName = (params.get('fcn') ?? '').slice(0, 20)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [interest, setInterest] = useState<string>(INTERESTS[0])
  const [memo, setMemo] = useState('')
  const [consent, setConsent] = useState(false)
  const [website, setWebsite] = useState('') // 허니팟 — 사람은 볼 수 없음
  const [state, setState] = useState<'idle' | 'submitting' | 'done'>('idle')
  const [doneMessage, setDoneMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  const phoneOk = /^010[-\s]?\d{3,4}[-\s]?\d{4}$/.test(phone.trim())
  const canSubmit = name.trim().length >= 2 && phoneOk && consent && state !== 'submitting'

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    const base = getFunctionsBaseUrl()
    const anon = getSupabaseAnonKey()
    if (!base || !anon) {
      setError('일시적으로 접수가 어렵습니다. 잠시 후 다시 시도해 주세요.')
      return
    }
    setState('submitting')
    setError(null)
    try {
      const res = await fetch(`${base}/public-lead-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), interest, memo, consent, fcCode, website })
      })
      const data = (await res.json().catch(() => null)) as { success?: boolean; message?: string; error?: string } | null
      if (!res.ok || !data?.success) {
        setError(data?.error ?? '접수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.')
        setState('idle')
        return
      }
      setDoneMessage(data.message ?? '신청이 접수되었습니다. 담당 설계사가 곧 연락드립니다.')
      setState('done')
    } catch {
      setError('접수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.')
      setState('idle')
    }
  }

  const input =
    'w-full rounded-xl border border-slate-800 bg-white px-3.5 py-3 text-[15px] text-slate-100 placeholder:text-slate-500 focus:border-[#c6982f] focus:outline-none'

  return (
    <div className="min-h-screen w-full" style={{ background: 'linear-gradient(160deg, #0e1e3a 0%, #16294b 55%, #1d2f57 100%)' }}>
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-8">
        {/* 브랜드 헤더 */}
        <div className="text-center text-white">
          <p className="text-[11px] font-bold tracking-[0.3em] text-[#e6c877]">SJ INVEST</p>
          <h1 className="mt-2 text-2xl font-black leading-snug">
            무료 보험 보장분석
            <br />
            신청하기
          </h1>
          <p className="mt-2 text-[13px] text-white/60">
            가입 권유 없이, 지금 보험이 잘 되어 있는지
            <br />
            전문가가 무료로 꼼꼼히 점검해 드립니다.
          </p>
          {fcName ? (
            <span className="mt-3 inline-block rounded-full bg-[#c6982f] px-3 py-1 text-[12px] font-bold text-[#201603]">
              담당 설계사 · {fcName}
            </span>
          ) : null}
        </div>

        {/* 카드 */}
        <div className="mt-6 rounded-2xl bg-white p-5 shadow-2xl">
          {state === 'done' ? (
            <div className="py-8 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-200">
                <Check className="h-7 w-7 text-emerald-600" />
              </div>
              <p className="text-base font-bold text-slate-100">신청 완료!</p>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-500">{doneMessage}</p>
              <p className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-slate-500">
                <PhoneCall className="h-3.5 w-3.5" /> 영업일 기준 1일 내 연락드립니다.
              </p>
            </div>
          ) : (
            <div className="space-y-3.5">
              <div>
                <label className="mb-1 block text-[12px] font-bold text-slate-300">성함 *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" className={input} />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-bold text-slate-300">휴대폰 번호 *</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="010-0000-0000"
                  inputMode="tel"
                  className={input}
                />
                {phone.trim() && !phoneOk ? <p className="mt-1 text-[11px] text-rose-500">010으로 시작하는 휴대폰 번호를 입력해 주세요.</p> : null}
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-bold text-slate-300">무엇이 궁금하세요?</label>
                <div className="flex flex-wrap gap-1.5">
                  {INTERESTS.map((it) => (
                    <button
                      key={it}
                      type="button"
                      onClick={() => setInterest(it)}
                      className={[
                        'rounded-full px-3 py-1.5 text-[12px] font-bold transition',
                        interest === it ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-slate-950 text-slate-400 ring-1 ring-slate-800'
                      ].join(' ')}
                    >
                      {it}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-bold text-slate-300">남기실 말씀 (선택)</label>
                <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 저녁에 연락 부탁드려요" className={input} />
              </div>

              {/* 허니팟 — 화면에 보이지 않음. 봇만 채운다. */}
              <div className="hidden" aria-hidden="true">
                <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="website" />
              </div>

              <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-slate-950 px-3 py-2.5">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#c6982f]" />
                <span className="text-[11px] leading-relaxed text-slate-400">
                  <b className="text-slate-200">개인정보 수집·이용 동의 (필수)</b> — 성함·연락처는 보장분석 상담 목적으로만 사용하며, 상담
                  종료 후 파기 요청하실 수 있습니다.
                </span>
              </label>

              {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-center text-[12px] font-bold text-rose-600">{error}</p> : null}

              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit}
                className="w-full rounded-xl bg-[#c6982f] px-4 py-3.5 text-[15px] font-black text-[#201603] transition hover:brightness-105 disabled:opacity-40"
              >
                {state === 'submitting' ? '접수 중…' : '무료 보장분석 신청하기'}
              </button>

              <p className="flex items-center justify-center gap-1 text-center text-[11px] text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5" /> 신청 즉시 담당 설계사에게만 전달됩니다.
              </p>
            </div>
          )}
        </div>

        <p className="mt-6 flex items-center justify-center gap-1 text-center text-[11px] text-white/40">
          <Sparkles className="h-3 w-3" /> SJ INVEST — 고객의 보장을 먼저 생각합니다.
        </p>
      </div>
    </div>
  )
}
