import { useEffect, useRef, useState } from 'react'
import { KeyRound, Smartphone, Copy, Check, RefreshCw, Loader2, ShieldCheck, Inbox } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { copyText } from '@renderer/services/share/clipboard'
import {
  getOrCreateMyDevice,
  regenerateMyDevice,
  listRecentCodes,
  subscribeCodes,
  ingestUrl,
  type OtpDevice,
  type OtpCode
} from '@renderer/services/commercial/otpRelayService'

/**
 * 인증번호 전달함 — 보험사 전산 OTP를 폰 앱이 자동 수신 → 총무 보드에 실시간 표시.
 * 총무/관리자/대표: 실시간 수신 보드. FC: 내 폰 연결(기기 토큰) + 내 수신 내역.
 */

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}

export default function OtpRelayPage(): JSX.Element {
  const { session } = useSession()
  const role = session.role
  const isBoard = role === 'owner' || role === 'admin' || role === 'back-office'

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2 rounded-2xl bg-[#0e1e3a] px-5 py-4">
        <KeyRound className="h-5 w-5 text-[#e6c877]" />
        <div className="min-w-0">
          <div className="text-base font-extrabold text-white">인증번호 전달함</div>
          <div className="mt-0.5 text-[12px] font-medium text-white/80">보험사 전산 로그인 인증번호를 폰에서 자동으로 받아옵니다.</div>
        </div>
      </div>

      {isBoard ? <Board /> : null}
      <DeviceConnect />
    </div>
  )
}

/** 총무/관리자 실시간 수신 보드 */
function Board(): JSX.Element {
  const now = useNow()
  const [codes, setCodes] = useState<OtpCode[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | undefined>()
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    void listRecentCodes().then((rows) => {
      if (!alive) return
      rows.forEach((r) => seen.current.add(r.id))
      setCodes(rows)
      setLoading(false)
    })
    const off = subscribeCodes((row) => {
      if (seen.current.has(row.id)) return
      seen.current.add(row.id)
      // 실시간 INSERT 는 staffName 이 없으므로 보충 조회
      void listRecentCodes(5).then((rows) => {
        const match = rows.find((r) => r.id === row.id)
        setCodes((prev) => [match ?? row, ...prev].slice(0, 40))
      })
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  const copy = async (c: OtpCode): Promise<void> => {
    const ok = await copyText(c.code)
    if (ok) {
      setCopiedId(c.id)
      window.setTimeout(() => setCopiedId(undefined), 1500)
    }
  }

  const live = codes.filter((c) => new Date(c.expires_at).getTime() > now)

  return (
    <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-100">
        <Inbox className="h-4 w-4 text-[#c6982f]" /> 실시간 수신
        <span className="text-[11px] font-medium text-slate-500">({live.length}건 · 3분 내)</span>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
        </div>
      ) : live.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 py-8 text-center text-[13px] text-slate-500">
          대기 중 — FC 폰에 인증번호가 오면 여기에 바로 뜹니다.
        </div>
      ) : (
        <div className="space-y-2">
          {live.map((c) => {
            const left = Math.max(0, Math.round((new Date(c.expires_at).getTime() - now) / 1000))
            return (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <span className="font-bold text-slate-100">{c.staffName ?? '직원'}</span>
                    {c.insurer ? <span className="rounded-full bg-[#0e1e3a] px-1.5 py-0.5 text-[10px] font-bold text-[#e6c877]">{c.insurer}</span> : null}
                    <span className="text-[10px] text-slate-500">{left}초 남음</span>
                  </div>
                  <div className="mt-0.5 font-mono text-2xl font-black tracking-widest text-slate-100">{c.code}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void copy(c)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#0e1e3a] px-3 py-2 text-[12px] font-bold text-[#e6c877] hover:brightness-125"
                >
                  {copiedId === c.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copiedId === c.id ? '복사됨' : '복사'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** FC 내 폰 연결 (기기 토큰) */
function DeviceConnect(): JSX.Element {
  const [device, setDevice] = useState<OtpDevice | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | undefined>()

  const load = async (): Promise<void> => {
    setLoading(true)
    const d = await getOrCreateMyDevice()
    setDevice(d)
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const regen = async (): Promise<void> => {
    setBusy(true)
    const d = await regenerateMyDevice()
    setBusy(false)
    if (d) setDevice(d)
  }

  const copy = async (key: string, val: string): Promise<void> => {
    const ok = await copyText(val)
    if (ok) {
      setCopied(key)
      window.setTimeout(() => setCopied(undefined), 1500)
    }
  }

  const url = ingestUrl()

  return (
    <div className="rounded-2xl border border-[#c6982f]/40 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-1.5 text-sm font-bold text-slate-100">
        <Smartphone className="h-4 w-4 text-[#c6982f]" /> 내 폰 연결
      </div>
      <p className="mb-3 text-[12px] leading-5 text-slate-500">
        폰에 설치한 <b className="text-slate-300">SJ 인증번호 앱</b>에 아래 두 값을 한 번만 입력하면, 이후 보험사 인증문자가 자동으로 총무에게 전달됩니다.
      </p>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
        </div>
      ) : !device ? (
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-600">서버 연결 후 사용할 수 있습니다.</div>
      ) : (
        <div className="space-y-2">
          <Field label="수신 주소 (URL)" value={url} k="url" copied={copied} onCopy={copy} />
          <Field label="내 기기 토큰" value={device.token} k="token" copied={copied} onCopy={copy} mono />
          <div className="flex items-center justify-between pt-1">
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <ShieldCheck className="h-3 w-3 text-emerald-600" /> 이 토큰은 내 계정에만 연결됩니다.
            </span>
            <button
              type="button"
              onClick={() => void regen()}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-400 hover:text-slate-200 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} 토큰 재발급
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  k,
  copied,
  onCopy,
  mono
}: {
  label: string
  value: string
  k: string
  copied?: string
  onCopy: (k: string, v: string) => void
  mono?: boolean
}): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
      <div className="mb-0.5 text-[10px] font-semibold text-slate-500">{label}</div>
      <div className="flex items-center gap-2">
        <span className={['min-w-0 flex-1 truncate text-[12px] text-slate-100', mono ? 'font-mono' : ''].join(' ')}>{value || '-'}</span>
        <button
          type="button"
          onClick={() => onCopy(k, value)}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-800 bg-white px-2 py-1 text-[11px] font-bold text-slate-300 hover:bg-slate-950"
        >
          {copied === k ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
    </div>
  )
}
