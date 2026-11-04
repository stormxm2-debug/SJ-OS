import { useEffect, useRef, useState } from 'react'
import { ShieldCheck, Loader2, Eye, EyeOff, CheckCircle2, AlertTriangle, Smartphone } from 'lucide-react'
import { publicHrInfo, publicHrStart, publicHrConfirm } from '@renderer/services/commercial/healthRecordService'

/**
 * 고객 '링크 입력' 공개 페이지 (?hr=1&r=<id>&t=<token>) — 로그인·세션 없이 렌더.
 * 고객이 본인 주민번호(또는 생년월일)를 입력하고 간편인증을 승인하면, 결과는 담당 설계사
 * 화면으로 전달된다. 고객 화면에는 완료 안내만 보인다. 주민번호는 이 페이지 메모리에만 두고
 * 전송 후 보관하지 않으며, 서버·설계사 화면에 저장되지 않는다.
 */

const AUTH_PROVIDERS: { v: string; label: string }[] = [
  { v: '1', label: '카카오톡' },
  { v: '6', label: '네이버' },
  { v: '8', label: '토스' },
  { v: '5', label: '통신사(PASS)' },
  { v: '4', label: 'KB모바일' },
  { v: '7', label: '신한인증서' },
  { v: '3', label: '삼성패스' },
  { v: '10', label: 'NH인증서' }
]
const TELECOMS: { v: string; label: string }[] = [
  { v: '0', label: 'SKT (알뜰폰 포함)' },
  { v: '1', label: 'KT (알뜰폰 포함)' },
  { v: '2', label: 'LG U+ (알뜰폰 포함)' }
]

type Phase = 'loading' | 'invalid' | 'form' | 'awaiting' | 'done' | 'failed'

export default function HealthInputPage(): JSX.Element {
  const params = new URLSearchParams(window.location.search)
  const r = params.get('r') ?? ''
  const t = params.get('t') ?? ''

  const [phase, setPhase] = useState<Phase>('loading')
  const [customerName, setCustomerName] = useState('')
  const [idField, setIdField] = useState<'birth' | 'rrn'>('rrn')
  const [idLen, setIdLen] = useState(13)

  const [rrn, setRrn] = useState('')
  const [showRrn, setShowRrn] = useState(false)
  const [provider, setProvider] = useState('1')
  const [telecom, setTelecom] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)
  const triesRef = useRef(0)

  const needTelecom = provider === '5'
  const digits = (s: string): string => s.replace(/\D/g, '')

  useEffect(() => {
    void (async () => {
      if (!r || !t) {
        setPhase('invalid')
        return
      }
      const info = await publicHrInfo(r, t)
      if (!info.ok) {
        setPhase('invalid')
        setError(info.error ?? '링크가 유효하지 않습니다.')
        return
      }
      setCustomerName(info.customerName ?? '')
      setIdField(info.idField ?? 'rrn')
      setIdLen(info.idLen ?? 13)
      setPhase(info.status === 'completed' ? 'done' : info.status === 'awaiting_auth' ? 'awaiting' : 'form')
    })()
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const poll = (): void => {
    triesRef.current += 1
    pollRef.current = window.setTimeout(async () => {
      const res = await publicHrConfirm({ r, t, rrn: digits(rrn), loginTypeLevel: provider, telecom: needTelecom ? telecom : undefined })
      if (res.status === 'completed' && res.ok) {
        setRrn('')
        setPhase('done')
        return
      }
      if (res.status === 'failed') {
        setError(res.error ?? '조회에 실패했습니다.')
        setPhase('failed')
        return
      }
      if (triesRef.current >= 40) {
        setError('승인 대기 시간이 초과되었습니다. 처음부터 다시 시도해 주세요.')
        setPhase('failed')
        return
      }
      poll()
    }, 4000)
  }

  const start = async (): Promise<void> => {
    setError(null)
    if (digits(rrn).length !== idLen) {
      setError(idField === 'birth' ? '생년월일 8자리를 입력해 주세요.' : '주민등록번호 13자리를 입력해 주세요.')
      return
    }
    setBusy(true)
    const res = await publicHrStart({ r, t, rrn: digits(rrn), loginTypeLevel: provider, telecom: needTelecom ? telecom : undefined })
    setBusy(false)
    if (res.status === 'awaiting_auth') {
      setPhase('awaiting')
      triesRef.current = 0
      poll()
      return
    }
    if (res.status === 'completed' && res.ok) {
      setRrn('')
      setPhase('done')
      return
    }
    setError(res.error ?? '요청에 실패했습니다. 입력을 확인해 주세요.')
  }

  return (
    <div className="min-h-screen bg-[#f1f5f9] px-4 py-8" style={{ colorScheme: 'light' }}>
      <div className="mx-auto max-w-md">
        {/* 헤더 */}
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0e1e3a] text-white"><ShieldCheck className="h-5 w-5 text-[#e6c877]" /></span>
          <div>
            <div className="text-[15px] font-extrabold text-[#0e1e3a]">건강보험 조회 본인확인</div>
            <div className="text-[11px] text-[#64748b]">SJ INVEST · 담당 설계사 요청</div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#e6eaf2] bg-white p-5 shadow-sm">
          {phase === 'loading' ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[#64748b]"><Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…</div>
          ) : phase === 'invalid' ? (
            <div className="py-8 text-center">
              <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-amber-500" />
              <div className="text-[14px] font-bold text-[#0f172a]">링크가 유효하지 않거나 만료되었습니다</div>
              <div className="mt-1 text-[12px] text-[#64748b]">{error ?? '담당 설계사에게 새 링크를 요청해 주세요. (링크는 30분 1회용)'}</div>
            </div>
          ) : phase === 'done' ? (
            <div className="py-8 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-500" />
              <div className="text-[15px] font-bold text-[#0f172a]">조회가 완료되었습니다</div>
              <div className="mt-1 text-[12px] leading-relaxed text-[#64748b]">결과는 담당 설계사에게 안전하게 전달되었습니다. 이 창은 닫으셔도 됩니다.</div>
            </div>
          ) : phase === 'awaiting' ? (
            <div className="py-8 text-center">
              <Smartphone className="mx-auto mb-2 h-9 w-9 animate-pulse text-[#0e1e3a]" />
              <div className="text-[14px] font-bold text-[#0f172a]">휴대폰에서 간편인증을 승인해 주세요</div>
              <div className="mt-1 text-[12px] leading-relaxed text-[#64748b]">{AUTH_PROVIDERS.find((p) => p.v === provider)?.label} 앱에서 인증을 완료하면 자동으로 진행됩니다.</div>
              <div className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0e1e3a]"><Loader2 className="h-4 w-4 animate-spin" /> 승인 대기 중…</div>
            </div>
          ) : phase === 'failed' ? (
            <div className="py-8 text-center">
              <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-rose-500" />
              <div className="text-[14px] font-bold text-[#0f172a]">조회에 실패했습니다</div>
              <div className="mt-1 text-[12px] text-[#64748b]">{error}</div>
              <button type="button" onClick={() => { setPhase('form'); setError(null) }} className="mt-3 rounded-lg bg-[#0e1e3a] px-4 py-2 text-[12px] font-bold text-white">다시 시도</button>
            </div>
          ) : (
            <>
              <div className="text-[13px] font-bold text-[#0f172a]">{customerName ? `${customerName}님, ` : ''}본인확인을 진행해 주세요</div>
              <p className="mt-1 text-[11px] leading-relaxed text-[#64748b]">
                아래 {idField === 'birth' ? '생년월일' : '주민등록번호'}을(를) 입력하고 간편인증을 승인하면, 건강보험 진료내역이 담당 설계사에게 전달됩니다.
              </p>

              <div className="mt-3">
                <label className="text-[11px] font-semibold text-[#334155]">{idField === 'birth' ? '생년월일 (YYYYMMDD · 8자리)' : '주민등록번호 (13자리)'}</label>
                <div className="relative mt-1">
                  <input
                    value={rrn}
                    onChange={(e) => setRrn(e.target.value)}
                    type={showRrn ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={idField === 'birth' ? 8 : 14}
                    placeholder={idField === 'birth' ? '19900101' : '앞 6자리 + 뒤 7자리'}
                    autoComplete="off"
                    className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 pr-10 text-[14px] tracking-wider text-[#0f172a] placeholder:text-[#94a3b8] focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button type="button" onClick={() => setShowRrn((v) => !v)} tabIndex={-1} className="absolute inset-y-0 right-0 flex items-center px-3 text-[#94a3b8]">
                    {showRrn ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <label className="text-[11px] font-semibold text-[#334155]">간편인증 수단</label>
                <select value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1 w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 text-[13px] font-semibold text-[#0f172a] focus:border-indigo-400 focus:outline-none">
                  {AUTH_PROVIDERS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
                </select>
              </div>
              {needTelecom ? (
                <div className="mt-3">
                  <label className="text-[11px] font-semibold text-[#334155]">통신사</label>
                  <select value={telecom} onChange={(e) => setTelecom(e.target.value)} className="mt-1 w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 text-[13px] font-semibold text-[#0f172a] focus:border-indigo-400 focus:outline-none">
                    {TELECOMS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
                  </select>
                </div>
              ) : null}

              {error ? <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700">{error}</div> : null}

              <button type="button" onClick={() => void start()} disabled={busy} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0e1e3a] to-[#1d2f57] px-4 py-3 text-[14px] font-bold text-white disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4 text-[#e6c877]" />} 본인확인 · 조회 시작
              </button>

              <p className="mt-3 text-[10px] leading-relaxed text-[#94a3b8]">
                입력하신 번호는 본인확인(간편인증)에만 보안 연결로 사용되며, 서버·설계사 화면에 저장되지 않습니다. 본 조회는 본인 동의 하에 진행됩니다.
              </p>
            </>
          )}
        </div>

        <div className="mt-3 text-center text-[10px] text-[#94a3b8]">문의: 담당 설계사 · SJ INVEST</div>
      </div>
    </div>
  )
}
