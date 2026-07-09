import { useEffect, useState } from 'react'
import { Lock, Loader2, CheckCircle2 } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { getBackendConfig } from '@renderer/services/commercial/backendConfig'
import { listMyTodayAttendance, saveResolution } from '@renderer/services/commercial/attendanceService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

/**
 * 오늘의 다짐 잠금 게이트 (대표 지시: 출근 직후부터 다짐 저장 전까지 앱 사용 불가).
 *
 * 오늘 내 출근(check-in) 기록이 있는데 다짐(memo)이 비어 있으면 전체 화면 잠금
 * 오버레이를 띄운다 — 사이드바·메뉴 포함 모든 UI 위(z-[80]). 다짐을 저장하는 순간
 * 해제. 앱을 껐다 켜도 조건이 유지되면 다시 잠긴다. AppShell/MobileShell 공용.
 */

const RT_TABLES = ['attendance_records']

export default function ResolutionLockGate(): JSX.Element | null {
  const { session } = useSession()
  const [lockedRecordId, setLockedRecordId] = useState<string | null>(null)
  const [checkInTime, setCheckInTime] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | undefined>()

  const check = async (): Promise<void> => {
    if (getBackendConfig().mode !== 'supabase' || !session.isLoggedIn) {
      setLockedRecordId(null)
      return
    }
    const res = await listMyTodayAttendance()
    if (!res.ok) return
    const checkIn = res.records.find((r) => r.type === 'check-in')
    if (checkIn && !(checkIn.memo ?? '').trim()) {
      setLockedRecordId(checkIn.id)
      setCheckInTime(new Date(checkIn.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }))
    } else {
      setLockedRecordId(null)
    }
  }

  useEffect(() => {
    void check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.isLoggedIn, session.id])
  useRealtimeSync(RT_TABLES, check)

  const save = async (): Promise<void> => {
    if (!lockedRecordId) return
    if (!text.trim()) {
      setErr('오늘의 다짐을 적어주세요.')
      return
    }
    setBusy(true)
    setErr(undefined)
    const res = await saveResolution(lockedRecordId, text.trim())
    setBusy(false)
    if (!res.ok) {
      setErr(res.error)
      return
    }
    setText('')
    setLockedRecordId(null)
  }

  if (!lockedRecordId) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0b1120]/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl border border-slate-800 bg-white p-6 shadow-2xl">
        <div className="mb-1 flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50">
            <Lock className="h-5 w-5 text-amber-600" />
          </span>
          <div>
            <div className="text-base font-bold text-slate-100">출근 완료! 오늘의 다짐을 적어주세요</div>
            <div className="text-[11px] text-slate-500">{checkInTime} 출근 보고됨 · 다짐을 저장해야 다른 메뉴를 쓸 수 있어요</div>
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          placeholder="오늘 하루 어떤 다짐으로 살 것인가요?"
          className="mt-3 h-24 w-full rounded-2xl border border-slate-800 bg-white px-3 py-2.5 text-[14px] leading-6 text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
        {err ? <p className="mt-1.5 text-[12px] text-rose-600">{err}</p> : null}
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          다짐 저장하고 시작하기
        </button>
      </div>
    </div>
  )
}
