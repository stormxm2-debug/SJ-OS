import { useEffect, useMemo, useState } from 'react'
import { Clock, LogIn, LogOut, RefreshCw, Loader2, AlertTriangle, Database, HardDrive, Camera } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import {
  createCheckIn,
  createCheckOut,
  getAttendanceSummary,
  getTodayWorkedDuration,
  listAttendanceRecords,
  listMyTodayAttendance,
  type AttendanceDataMode,
  type AttendanceWithStaff
} from '@renderer/services/commercial/attendanceService'
import {
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_TYPE_LABEL,
  validateAttendanceInput,
  type AttendanceInput
} from '@renderer/services/commercial/attendanceValidation'
import { isAttendancePhotoStorageConfigured } from '@renderer/services/commercial/attendancePhotoStorage'
import { isAdminRole } from '@renderer/navigation/roleAccess'

/**
 * 출퇴근 (Supabase-connected). Check-in/out saves to attendance_records (Supabase
 * when configured + logged in, else local-mock). RLS enforces access; role guidance
 * + client filters are UX only. Photo upload is deferred; only watermark_text +
 * optional photo_path are stored. Never renders/logs photo/base64/tokens. Inline
 * cards only; no backdrop.
 */
export default function SupabaseAttendanceManager(): JSX.Element {
  const { session } = useSession()
  const [records, setRecords] = useState<AttendanceWithStaff[]>([])
  const [myToday, setMyToday] = useState<AttendanceWithStaff[]>([])
  const [mode, setMode] = useState<AttendanceDataMode>('local-mock')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'checkin-dup' | 'checkout-none' | null>(null)

  const roleHint = session.role === 'fc' ? '내 출퇴근 기록만 표시됩니다.' : session.role === 'team-leader' ? '팀 출퇴근 현황이 표시됩니다.' : '전체 출퇴근 현황이 표시됩니다.'
  const admin = isAdminRole(session.role) || session.role === 'team-leader'
  const photoConfigured = isAttendancePhotoStorageConfigured()

  const load = async (): Promise<void> => {
    setLoading(true)
    const [allRes, myRes] = await Promise.all([listAttendanceRecords(), listMyTodayAttendance()])
    setMode(allRes.mode)
    setRecords(allRes.records)
    setMyToday(myRes.records)
    setError(allRes.ok ? undefined : allRes.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasCheckIn = myToday.some((r) => r.type === 'check-in')
  const hasCheckOut = myToday.some((r) => r.type === 'check-out')
  const lastRecord = myToday[0]
  const worked = useMemo(() => getTodayWorkedDuration(myToday), [myToday])
  const summary = useMemo(() => getAttendanceSummary(records), [records])

  const buildInput = (type: AttendanceInput['type']): AttendanceInput => ({
    type,
    status: 'normal',
    timestamp: new Date().toISOString(),
    watermarkText: `${session.name || '직원'} ${ATTENDANCE_TYPE_LABEL[type]} ${new Date().toLocaleString()}`,
    memo: memo.trim() || undefined
  })

  const doCheckIn = async (): Promise<void> => {
    setConfirm(null)
    const input = buildInput('check-in')
    const v = validateAttendanceInput(input)
    if (!v.ok) { setError(v.errors[0]); return }
    setBusy(true)
    const res = await createCheckIn(input)
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    setMemo(''); void load()
  }
  const doCheckOut = async (): Promise<void> => {
    setConfirm(null)
    const input = buildInput('check-out')
    const v = validateAttendanceInput(input)
    if (!v.ok) { setError(v.errors[0]); return }
    setBusy(true)
    const res = await createCheckOut(input)
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    setMemo(''); void load()
  }

  const onCheckIn = (): void => { if (hasCheckIn) setConfirm('checkin-dup'); else void doCheckIn() }
  const onCheckOut = (): void => { if (!hasCheckIn) setConfirm('checkout-none'); else void doCheckOut() }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-indigo-500" />
          <h2 className="text-base font-bold text-slate-800">출퇴근</h2>
          <ModeBadge mode={mode} />
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"><RefreshCw className="h-3 w-3" /> 새로고침</button>
      </div>
      <p className="mb-3 text-[11px] text-slate-500">{roleHint} <span className="text-slate-400">(실제 접근 권한은 Supabase RLS가 적용됩니다.)</span></p>

      {mode === 'not-configured' ? <Notice text="Supabase가 아직 연결되지 않아 로컬 MVP 데이터로 표시됩니다." /> : null}
      {mode === 'no-session' ? <Notice text="Supabase 로그인 후 출퇴근 DB를 사용할 수 있습니다." /> : null}
      {error ? <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600"><AlertTriangle className="mr-1 inline h-3 w-3" />{error}</div> : null}

      {/* My attendance card + actions */}
      <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <div className="mb-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
          <Field label="오늘 출근" value={hasCheckIn ? '완료' : '미출근'} tone={hasCheckIn ? 'emerald' : 'amber'} />
          <Field label="오늘 퇴근" value={hasCheckOut ? '완료' : '-'} tone={hasCheckOut ? 'emerald' : 'slate'} />
          <Field label={worked.ended ? '오늘 근무 시간' : '근무 시간 (진행)'} value={worked.label} tone={worked.started ? 'emerald' : 'slate'} />
          <Field label="마지막 기록" value={lastRecord ? `${ATTENDANCE_TYPE_LABEL[lastRecord.type]} · ${new Date(lastRecord.timestamp).toLocaleTimeString()}` : '-'} />
        </div>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모 (선택)" className="mb-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-700 focus:outline-none" />
        {confirm === 'checkin-dup' ? <ConfirmBar text="오늘 이미 출근 기록이 있습니다. 계속하시겠습니까?" onYes={() => void doCheckIn()} onNo={() => setConfirm(null)} /> : null}
        {confirm === 'checkout-none' ? <ConfirmBar text="오늘 출근 기록이 없습니다. 퇴근을 기록하시겠습니까?" onYes={() => void doCheckOut()} onNo={() => setConfirm(null)} /> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onCheckIn} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} 출근하기</button>
          <button type="button" onClick={onCheckOut} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"><LogOut className="h-4 w-4" /> 퇴근하기</button>
        </div>
        {!photoConfigured ? <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-400"><Camera className="h-3 w-3" /> 사진 저장소가 설정되지 않아 출퇴근 기록만 저장됩니다. (워터마크 텍스트는 저장)</p> : null}
      </div>

      {/* Owner/team summary */}
      {admin ? (
        <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="전체 대상" value={summary.total} />
          <Stat label="출근 완료" value={summary.checkedIn} tone="emerald" />
          <Stat label="미출근" value={summary.notCheckedIn} tone="amber" />
          <Stat label="지각" value={summary.late} tone="amber" />
          <Stat label="퇴근 완료" value={summary.checkedOut} tone="indigo" />
          <Stat label="조퇴" value={summary.earlyLeave} tone="amber" />
          <Stat label="누락" value={summary.missing} tone="rose" />
        </div>
      ) : null}

      {/* Records list */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> 출퇴근 기록을 불러오는 중입니다.</div>
      ) : records.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-500"><div>오늘 출퇴근 기록이 없습니다.</div><div className="text-[11px] text-slate-400">출근하기 버튼으로 기록을 시작하세요.</div></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-slate-400"><tr className="border-b border-slate-100">
              <th className="py-1.5 pr-2 font-medium">직원명</th>
              <th className="py-1.5 pr-2 font-medium">유형</th>
              <th className="py-1.5 pr-2 font-medium">상태</th>
              <th className="py-1.5 pr-2 font-medium">시간</th>
              <th className="py-1.5 pr-2 font-medium">워터마크</th>
              <th className="py-1.5 pr-2 font-medium">메모</th>
            </tr></thead>
            <tbody>
              {records.slice(0, 100).map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="py-1.5 pr-2 font-medium text-slate-700">{r.staffName || '-'}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{ATTENDANCE_TYPE_LABEL[r.type]}</td>
                  <td className="py-1.5 pr-2"><StatusChip label={ATTENDANCE_STATUS_LABEL[r.status]} status={r.status} /></td>
                  <td className="py-1.5 pr-2 text-slate-500">{r.timestamp ? new Date(r.timestamp).toLocaleString() : '-'}</td>
                  <td className="py-1.5 pr-2 text-slate-400">{r.watermarkText ? '있음' : '-'}</td>
                  <td className="py-1.5 pr-2 text-slate-400">{r.memo ? '있음' : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ConfirmBar({ text, onYes, onNo }: { text: string; onYes: () => void; onNo: () => void }): JSX.Element {
  return (
    <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2">
      <p className="text-[11px] font-semibold text-amber-800">{text}</p>
      <div className="mt-1.5 flex gap-2">
        <button type="button" onClick={onYes} className="rounded-md bg-amber-600 px-3 py-1 text-[11px] font-semibold text-white">계속</button>
        <button type="button" onClick={onNo} className="rounded-md border border-slate-300 px-3 py-1 text-[11px] text-slate-600">취소</button>
      </div>
    </div>
  )
}
function Field({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' | 'slate' }): JSX.Element {
  const t = tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-700'
  return <div className="rounded-lg border border-slate-100 bg-white px-3 py-2"><div className="text-[10px] text-slate-400">{label}</div><div className={['text-[12px] font-bold', t].join(' ')}>{value}</div></div>
}
function Stat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'indigo' | 'amber' | 'rose' }): JSX.Element {
  const t = tone === 'emerald' ? 'text-emerald-600' : tone === 'indigo' ? 'text-indigo-600' : tone === 'amber' ? 'text-amber-600' : tone === 'rose' ? 'text-rose-600' : 'text-slate-700'
  return <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2 text-center"><div className={['text-base font-bold', t].join(' ')}>{value}</div><div className="text-[10px] text-slate-500">{label}</div></div>
}
function StatusChip({ label, status }: { label: string; status: string }): JSX.Element {
  const tone = status === 'normal' ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : status === 'missing' ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-amber-200 bg-amber-50 text-amber-600'
  return <span className={['rounded-full border px-2 py-0.5 text-[10px] font-semibold', tone].join(' ')}>{label}</span>
}
function ModeBadge({ mode }: { mode: AttendanceDataMode }): JSX.Element {
  const supa = mode === 'supabase'
  return <span className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold', supa ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-blue-200 bg-blue-50 text-blue-600'].join(' ')}>{supa ? <Database className="h-3 w-3" /> : <HardDrive className="h-3 w-3" />}{supa ? 'Supabase 공용 DB' : '로컬 MVP 데이터'}</span>
}
function Notice({ text }: { text: string }): JSX.Element {
  return <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">{text}</div>
}
