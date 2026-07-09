import { useEffect, useMemo, useState } from 'react'
import {
  Clock,
  LogIn,
  LogOut,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Database,
  HardDrive,
  Camera,
  MapPin,
  CalendarDays,
  Timer,
  ImageOff
} from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import {
  createCheckIn,
  createCheckOut,
  getAttendanceSummary,
  getTodayWorkedDuration,
  listAttendanceRecords,
  listMyTodayAttendance,
  saveAddress,
  type AttendanceDataMode,
  type AttendanceWithStaff
} from '@renderer/services/commercial/attendanceService'
import {
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_TYPE_LABEL,
  validateAttendanceInput,
  type AttendanceInput
} from '@renderer/services/commercial/attendanceValidation'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import AttendanceCamera, { reverseGeocode, type CapturedAttendancePhoto } from './AttendanceCamera'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'
import { feeLabel, lateFeeFor } from '@renderer/services/commercial/attendanceLate'
import { getSupabaseClient, initSupabaseClient } from '@renderer/services/commercial/supabaseClient'

/** 활성 직원(설계사·팀장) 프로필 — 미출근 계산용. 관리자/팀장 패널에서만 사용. */
interface StaffLite {
  id: string
  name: string
  teamId?: string
}
async function listActiveStaff(): Promise<StaffLite[]> {
  try {
    await initSupabaseClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getSupabaseClient() as any
    if (!client) return []
    const { data } = await client.from('profiles').select('id, name, team_id, role, status').eq('status', 'active').in('role', ['fc', 'team-leader'])
    return ((data as { id: string; name: string; team_id: string | null }[]) ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      teamId: p.team_id ?? undefined
    }))
  } catch {
    return []
  }
}

/** Tables whose changes should live-refresh this screen (stable ref for the hook). */
const RT_TABLES = ['attendance_records', 'profiles']

/**
 * 출퇴근 (Supabase-connected). Check-in/out saves to attendance_records (Supabase
 * when configured + logged in, else local-mock). RLS enforces access; role guidance
 * + client filters are UX only. On check-in/out the staff takes a photo whose GPS +
 * time are burned in as a watermark (see AttendanceCamera); the watermarked JPEG data
 * URL travels as photoDataUrl and the thumbnail is shown in the record list. Raw photo
 * bytes are never logged.
 *
 * Colors: this app remaps the `slate` scale to a BRIGHT theme (bg-white/bg-slate-950
 * are light surfaces; text-slate-100/300/500 are dark, readable text). The premium
 * hero uses explicit hex so it is reliably a dark navy→indigo banner with white text.
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
  const [cameraFor, setCameraFor] = useState<AttendanceInput['type'] | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [staffList, setStaffList] = useState<StaffLite[]>([])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const roleHint =
    session.role === 'fc'
      ? '내 출퇴근 기록만 표시됩니다.'
      : session.role === 'team-leader'
        ? '팀 출퇴근 현황이 표시됩니다.'
        : '전체 출퇴근 현황이 표시됩니다.'
  const admin = isAdminRole(session.role) || session.role === 'team-leader'

  const load = async (): Promise<void> => {
    setLoading(true)
    const [allRes, myRes, staff] = await Promise.all([listAttendanceRecords(), listMyTodayAttendance(), listActiveStaff()])
    setMode(allRes.mode)
    setRecords(allRes.records)
    setMyToday(myRes.records)
    setStaffList(staff)
    setError(allRes.ok ? undefined : allRes.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Live sync: re-load instantly when attendance changes on any device.
  useRealtimeSync(RT_TABLES, load)

  const hasCheckIn = myToday.some((r) => r.type === 'check-in')
  const hasCheckOut = myToday.some((r) => r.type === 'check-out')
  const lastRecord = myToday[0]
  const worked = useMemo(() => getTodayWorkedDuration(myToday), [myToday])
  const summary = useMemo(() => getAttendanceSummary(records), [records])

  // ─── 지각·벌금 리포트 (오늘 + 이번 달) ─────────────────────────────────
  const todayKey = now.toDateString()
  const todayCheckIns = useMemo(
    () => records.filter((r) => r.type === 'check-in' && new Date(r.timestamp).toDateString() === todayKey),
    [records, todayKey]
  )
  const todayLate = useMemo(() => todayCheckIns.filter((r) => (r.lateFee ?? 0) > 0), [todayCheckIns])
  const todayFeeSum = todayLate.reduce((s, r) => s + (r.lateFee ?? 0), 0)
  const absentToday = useMemo(() => {
    const checked = new Set(todayCheckIns.map((r) => r.staffId))
    const scope = session.role === 'team-leader' ? staffList.filter((s) => s.teamId && s.teamId === session.teamName) : staffList
    return scope.filter((s) => !checked.has(s.id))
  }, [todayCheckIns, staffList, session.role, session.teamName])
  const monthlyFines = useMemo(() => {
    const map = new Map<string, { name: string; count: number; sum: number }>()
    for (const r of records) {
      if (r.type !== 'check-in') continue
      const fee = r.lateFee ?? 0
      if (fee <= 0) continue
      const d = new Date(r.timestamp)
      if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) continue
      const cur = map.get(r.staffId) ?? { name: r.staffName || '(이름없음)', count: 0, sum: 0 }
      cur.count += 1
      cur.sum += fee
      map.set(r.staffId, cur)
    }
    return [...map.values()].sort((a, b) => b.sum - a.sum)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, now.getFullYear(), now.getMonth()])
  const myTodayLate = myToday.find((r) => r.type === 'check-in' && (r.lateFee ?? 0) > 0)

  const workState: 'before' | 'working' | 'done' = !hasCheckIn ? 'before' : hasCheckOut ? 'done' : 'working'
  const hour = now.getHours()
  const greeting = hour < 6 ? '늦은 밤입니다' : hour < 12 ? '좋은 아침입니다' : hour < 18 ? '좋은 오후입니다' : '좋은 저녁입니다'
  const hh = String(hour).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')

  const buildInput = (type: AttendanceInput['type'], photo: CapturedAttendancePhoto | null): AttendanceInput => {
    const at = photo?.timestamp ? new Date(photo.timestamp) : new Date()
    const fee = type === 'check-in' ? (photo?.lateFee ?? lateFeeFor(at)) : 0
    return {
      type,
      status: type === 'check-in' && fee > 0 ? 'late' : 'normal',
      timestamp: at.toISOString(),
      photoDataUrl: photo?.dataUrl,
      watermarkText:
        photo?.watermarkText ?? `${session.name || '직원'} ${ATTENDANCE_TYPE_LABEL[type]} ${at.toLocaleString('ko-KR')}`,
      memo: memo.trim() || undefined,
      lateFee: fee,
      address: photo?.address ?? undefined
    }
  }

  const doSubmit = async (type: AttendanceInput['type'], photo: CapturedAttendancePhoto | null): Promise<void> => {
    const input = buildInput(type, photo)
    const v = validateAttendanceInput(input)
    if (!v.ok) {
      setError(v.errors[0])
      return
    }
    setBusy(true)
    const res = type === 'check-in' ? await createCheckIn(input) : await createCheckOut(input)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(undefined)
    setMemo('')
    void load()
    // 속도 우선: 주소 변환(최대 6초)은 기록을 막지 않고 뒤에서 채운다.
    const recordId = res.record?.id
    const coords = photo?.coords
    if (recordId && coords) {
      void reverseGeocode(coords.lat, coords.lng).then(async (addr) => {
        if (!addr) return
        const saved = await saveAddress(recordId, addr)
        if (saved.ok) void load()
      })
    }
  }

  const openCamera = (type: AttendanceInput['type']): void => {
    setConfirm(null)
    setError(undefined)
    setCameraFor(type)
  }
  const onCheckIn = (): void => {
    // 순서 변경 (대표 지시): 사진 → 출근 보고 → 다짐. 다짐을 안 적으면 저장 후
    // 전체 화면 잠금(ResolutionLockGate)이 떠서 적을 때까지 앱 사용 불가.
    if (hasCheckIn) setConfirm('checkin-dup')
    else openCamera('check-in')
  }
  const onCheckOut = (): void => {
    if (!hasCheckIn) setConfirm('checkout-none')
    else openCamera('check-out')
  }

  return (
    <div className="space-y-4">
      {/* ─── Premium hero — deep navy + gold (Direction A). Explicit hex so it is
          reliably dark with white text regardless of the slate token remap. ─── */}
      <div
        className="relative overflow-hidden rounded-3xl p-6 text-white shadow-xl ring-1 ring-black/5"
        style={{
          background:
            'radial-gradient(680px 240px at 88% -30%, rgba(198,152,47,0.20), rgba(198,152,47,0) 60%), linear-gradient(135deg, #0e1e3a 0%, #16294b 60%, #1d2f57 100%)'
        }}
      >
        {/* gold top hairline */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#c6982f] to-transparent opacity-80" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-medium text-white/70">
              <Clock className="h-3.5 w-3.5" /> 출퇴근 관리
              <ModeBadge mode={mode} />
            </div>
            <div className="mt-3 flex items-end gap-2">
              <span className="text-5xl font-bold tabular-nums tracking-tight text-white sm:text-6xl">
                {hh}:{mm}
              </span>
              <span className="mb-1.5 text-lg font-semibold tabular-nums text-white/60">{ss}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-white/75">
              <CalendarDays className="h-3.5 w-3.5" />
              {now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            </div>
            <div className="mt-2 text-sm text-white/65">
              {session.name || '직원'}님, {greeting}.
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <WorkStatePill state={workState} />
            <div className="rounded-2xl bg-white/10 px-4 py-2.5 text-right ring-1 ring-white/15 backdrop-blur">
              <div className="flex items-center justify-end gap-1 text-[10px] uppercase tracking-wide text-white/55">
                <Timer className="h-3 w-3" /> {worked.ended ? '오늘 근무' : '근무 (진행)'}
              </div>
              <div className="text-xl font-bold tabular-nums text-white">{worked.label}</div>
            </div>
          </div>
        </div>

        <div className="relative mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onCheckIn}
            disabled={busy}
            className="inline-flex items-center gap-2.5 rounded-2xl bg-gradient-to-r from-emerald-400 to-emerald-600 px-6 py-3 text-base font-bold text-white shadow-lg shadow-emerald-900/30 transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
            출근하기
            <span className="ml-1 hidden items-center gap-1 rounded-full bg-black/15 px-2 py-0.5 text-[10px] font-semibold sm:inline-flex">
              <Camera className="h-3 w-3" /> 사진
            </span>
          </button>
          <button
            type="button"
            onClick={onCheckOut}
            disabled={busy}
            className="inline-flex items-center gap-2.5 rounded-2xl border border-white/25 bg-white/10 px-6 py-3 text-base font-bold text-white backdrop-blur transition hover:bg-white/20 disabled:opacity-60"
          >
            <LogOut className="h-5 w-5" /> 퇴근하기
            <span className="ml-1 hidden items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold sm:inline-flex">
              <Camera className="h-3 w-3" /> 사진
            </span>
          </button>
        </div>

        <div className="relative mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/60">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" /> 사진에 SJ INVEST 마크 · 시간 · GPS 주소가 자동으로 새겨집니다.
          </span>
          <span className="inline-flex items-center gap-1 text-[#e6c877]">
            출근 기준 9시 — 초과 5만 · 11시 초과 10만 · 12시 초과 20만 (평일)
          </span>
        </div>
      </div>

      {/* ─── Body (bright surfaces + dark text) ───────────────────────────── */}
      <div className="rounded-3xl border border-slate-800 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">
            {roleHint} <span className="text-slate-400">(실제 접근 권한은 Supabase RLS가 적용됩니다.)</span>
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-950"
          >
            <RefreshCw className="h-3 w-3" /> 새로고침
          </button>
        </div>

        {mode === 'not-configured' ? <Notice text="Supabase가 아직 연결되지 않아 로컬 데이터로 표시됩니다." /> : null}
        {mode === 'no-session' ? <Notice text="Supabase 로그인 후 출퇴근 DB를 사용할 수 있습니다." /> : null}
        {error ? (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700">
            <AlertTriangle className="mr-1 inline h-3 w-3" />
            {error}
          </div>
        ) : null}

        {/* Today snapshot */}
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="오늘 출근" value={hasCheckIn ? '완료' : '미출근'} tone={hasCheckIn ? 'emerald' : 'amber'} />
          <Field label="오늘 퇴근" value={hasCheckOut ? '완료' : '-'} tone={hasCheckOut ? 'emerald' : 'slate'} />
          <Field label={worked.ended ? '근무 시간' : '근무 (진행)'} value={worked.label} tone={worked.started ? 'emerald' : 'slate'} />
          <Field
            label="마지막 기록"
            value={lastRecord ? `${ATTENDANCE_TYPE_LABEL[lastRecord.type]} · ${new Date(lastRecord.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : '-'}
          />
        </div>
        {myTodayLate ? (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-bold text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            오늘 지각 · 벌금 {feeLabel(myTodayLate.lateFee ?? 0)} (
            {new Date(myTodayLate.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 출근)
          </div>
        ) : null}
        <div className="mb-4">
          <div className="mb-1 text-[11px] font-semibold text-slate-300">오늘의 다짐</div>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="미리 적어도 되고, 비워두면 출근 직후 다짐 입력 화면이 뜹니다 (저장 전까지 잠금)."
            className="w-full rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-[13px] text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
        {confirm === 'checkin-dup' ? (
          <ConfirmBar text="오늘 이미 출근 기록이 있습니다. 계속하시겠습니까?" onYes={() => openCamera('check-in')} onNo={() => setConfirm(null)} />
        ) : null}
        {confirm === 'checkout-none' ? (
          <ConfirmBar text="오늘 출근 기록이 없습니다. 퇴근을 기록하시겠습니까?" onYes={() => openCamera('check-out')} onNo={() => setConfirm(null)} />
        ) : null}

        {/* 관리자/팀장 — 오늘 지각 리포트 + 월별 벌금 정산 */}
        {admin ? (
          <div className="mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="오늘 출근" value={todayCheckIns.length} tone="emerald" />
              <Stat label="오늘 지각" value={todayLate.length} tone="rose" />
              <Stat label="미출근" value={absentToday.length} tone="amber" />
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
                <div className="text-[10px] font-medium text-rose-500">오늘 벌금 합계</div>
                <div className="text-lg font-bold tabular-nums text-rose-600">{feeLabel(todayFeeSum)}</div>
              </div>
            </div>

            {todayLate.length > 0 ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
                <div className="mb-1.5 text-[12px] font-bold text-rose-700">오늘 지각자 (9시 기준 자동 판정)</div>
                <div className="space-y-1">
                  {todayLate.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-[12px]">
                      <span className="font-semibold text-slate-100">{r.staffName || '(이름없음)'}</span>
                      <span className="text-slate-500">
                        {new Date(r.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 출근
                      </span>
                      <span className="ml-auto font-bold text-rose-600">벌금 {feeLabel(r.lateFee ?? 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {absentToday.length > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-800">
                <b>아직 미출근:</b> {absentToday.map((s) => s.name).join(', ')}
                <span className="ml-1 text-[11px] text-amber-600">(평일 09:05 공지로도 자동 보고됩니다)</span>
              </div>
            ) : null}

            {monthlyFines.length > 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <div className="mb-1.5 text-[12px] font-bold text-slate-200">
                  {now.getMonth() + 1}월 벌금 정산 <span className="font-medium text-slate-500">(지각 횟수 · 누적 벌금)</span>
                </div>
                <div className="space-y-1">
                  {monthlyFines.map((f) => (
                    <div key={f.name} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-[12px]">
                      <span className="font-semibold text-slate-100">{f.name}</span>
                      <span className="text-slate-500">{f.count}회</span>
                      <span className="ml-auto font-bold tabular-nums text-rose-600">{feeLabel(f.sum)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-bold">
                    <span className="text-slate-200">합계</span>
                    <span className="tabular-nums text-rose-600">{feeLabel(monthlyFines.reduce((s, f) => s + f.sum, 0))}</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Records — photo cards */}
        <div className="mb-2 flex items-center gap-2 text-[12px] font-bold text-slate-100">
          <Camera className="h-4 w-4 text-indigo-600" /> 출퇴근 기록
          {!loading ? <span className="text-[11px] font-medium text-slate-500">({records.length})</span> : null}
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 출퇴근 기록을 불러오는 중입니다.
          </div>
        ) : records.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 py-10 text-center">
            <Camera className="mx-auto mb-2 h-7 w-7 text-slate-600" />
            <div className="text-sm text-slate-300">아직 출퇴근 기록이 없습니다.</div>
            <div className="text-[11px] text-slate-500">위의 출근하기 버튼으로 사진과 함께 기록을 시작하세요.</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {records.slice(0, 24).map((r) => (
              <RecordCard key={r.id} record={r} />
            ))}
          </div>
        )}
      </div>

      {/* Camera modal */}
      <AttendanceCamera
        open={cameraFor !== null}
        label={cameraFor === 'check-out' ? '퇴근' : '출근'}
        staffName={session.name || '직원'}
        onCapture={(photo) => {
          const type = cameraFor
          setCameraFor(null)
          if (type) void doSubmit(type, photo)
        }}
        onClose={() => setCameraFor(null)}
        onSkip={() => {
          const type = cameraFor
          setCameraFor(null)
          if (type) void doSubmit(type, null)
        }}
      />
    </div>
  )
}

/* ─── Record card with watermarked photo thumbnail ─────────────────────── */
function RecordCard({ record: r }: { record: AttendanceWithStaff }): JSX.Element {
  const isIn = r.type === 'check-in'
  const time = r.timestamp ? new Date(r.timestamp) : null
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-white shadow-sm transition hover:shadow-md">
      <div className="relative aspect-[4/3] w-full bg-slate-950">
        {r.photoUrl ? (
          <img src={r.photoUrl} alt="출퇴근 인증 사진" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-600">
            <ImageOff className="h-6 w-6" />
            <span className="text-[10px]">사진 없음</span>
          </div>
        )}
        <span
          className={[
            'absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur',
            isIn ? 'bg-emerald-600/90' : 'bg-[#0f1a2e]/85'
          ].join(' ')}
        >
          {isIn ? <LogIn className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
          {ATTENDANCE_TYPE_LABEL[r.type]}
        </span>
        {r.watermarkText ? (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[9px] font-medium text-white/90 backdrop-blur">
            <MapPin className="h-2.5 w-2.5" /> GPS·시간
          </span>
        ) : null}
      </div>
      <div className="p-2.5">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[12px] font-semibold text-slate-100">{r.staffName || '직원'}</span>
          <StatusChip label={ATTENDANCE_STATUS_LABEL[r.status]} status={r.status} />
        </div>
        <div className="mt-0.5 text-[11px] tabular-nums text-slate-500">
          {time ? time.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
        </div>
        {r.memo ? <div className="mt-1 truncate text-[10px] text-slate-400">{r.memo}</div> : null}
      </div>
    </div>
  )
}

function WorkStatePill({ state }: { state: 'before' | 'working' | 'done' }): JSX.Element {
  const cfg =
    state === 'working'
      ? { label: '근무 중', dot: 'bg-emerald-400' }
      : state === 'done'
        ? { label: '퇴근 완료', dot: 'bg-sky-300' }
        : { label: '출근 전', dot: 'bg-amber-400' }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur">
      <span className={['h-2 w-2 rounded-full', cfg.dot, state === 'working' ? 'animate-pulse' : ''].join(' ')} />
      {cfg.label}
    </span>
  )
}

function ConfirmBar({ text, onYes, onNo }: { text: string; onYes: () => void; onNo: () => void }): JSX.Element {
  return (
    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
      <p className="text-[12px] font-semibold text-amber-800">{text}</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={onYes} className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-700">
          <Camera className="h-3 w-3" /> 촬영 후 계속
        </button>
        <button type="button" onClick={onNo} className="rounded-lg border border-slate-800 bg-white px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-950">
          취소
        </button>
      </div>
    </div>
  )
}
function Field({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' | 'slate' }): JSX.Element {
  const t = tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-100'
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={['mt-0.5 text-[13px] font-bold', t].join(' ')}>{value}</div>
    </div>
  )
}
function Stat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'indigo' | 'amber' | 'rose' }): JSX.Element {
  const t =
    tone === 'emerald'
      ? 'text-emerald-600'
      : tone === 'indigo'
        ? 'text-indigo-600'
        : tone === 'amber'
          ? 'text-amber-600'
          : tone === 'rose'
            ? 'text-rose-600'
            : 'text-slate-100'
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-center">
      <div className={['text-lg font-bold', t].join(' ')}>{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  )
}
function StatusChip({ label, status }: { label: string; status: string }): JSX.Element {
  const tone =
    status === 'normal'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'missing'
        ? 'bg-rose-50 text-rose-700'
        : 'bg-amber-50 text-amber-700'
  return <span className={['shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold', tone].join(' ')}>{label}</span>
}
function ModeBadge({ mode }: { mode: AttendanceDataMode }): JSX.Element {
  const supa = mode === 'supabase'
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/90 ring-1 ring-white/20">
      {supa ? <Database className="h-3 w-3" /> : <HardDrive className="h-3 w-3" />}
      {supa ? 'Supabase 공용 DB' : '로컬 데이터'}
    </span>
  )
}
function Notice({ text }: { text: string }): JSX.Element {
  return <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">{text}</div>
}
