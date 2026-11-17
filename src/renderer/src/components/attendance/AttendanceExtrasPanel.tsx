import { useEffect, useState } from 'react'
import { Send, Check, X, Pause, Play, MapPin } from 'lucide-react'
import {
  submitJikchulReport,
  listJikchulReports,
  reviewJikchulReport,
  pauseStaff,
  resumeStaff,
  type JikchulReport,
  type PausedStaff
} from '@renderer/services/commercial/attendanceExtraService'

export interface StaffOpt {
  id: string
  name: string
}

function dayKey(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}
const statusLabel: Record<JikchulReport['status'], string> = { pending: '승인 대기', approved: '승인됨', rejected: '반려됨' }
const statusCls: Record<JikchulReport['status'], string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-rose-50 text-rose-700'
}

/** FC(및 전 직원)용 — 직출 보고 제출 + 내 최근 보고. */
export function JikchulSubmitCard({ staffName, onChanged }: { staffName?: string; onChanged?: () => void }): JSX.Element {
  const [forDate, setForDate] = useState(dayKey(1)) // 기본: 내일
  const [dest, setDest] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [mine, setMine] = useState<JikchulReport[]>([])

  const loadMine = async (): Promise<void> => {
    const r = await listJikchulReports()
    if (r.ok) setMine(r.items.slice(0, 5))
  }
  useEffect(() => {
    void loadMine()
  }, [])

  const submit = async (): Promise<void> => {
    if (!forDate) {
      setMsg('직출 날짜를 선택하세요.')
      return
    }
    setBusy(true)
    setMsg(null)
    const r = await submitJikchulReport({ forDate, destination: dest, reason, staffName })
    setBusy(false)
    if (!r.ok) {
      setMsg(r.error ?? '제출에 실패했습니다.')
      return
    }
    setMsg('직출 보고를 제출했습니다 — 승인 대기중입니다.')
    setDest('')
    setReason('')
    await loadMine()
    onChanged?.()
  }

  return (
    <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-slate-100">
        <MapPin className="h-3.5 w-3.5 text-[#b0821f]" /> 직출 보고
        <span className="font-medium text-slate-500">(승인되면 그날 출근 면제)</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <label className="text-[10px] font-semibold text-slate-400">직출 날짜</label>
          <input
            type="date"
            value={forDate}
            onChange={(e) => setForDate(e.target.value)}
            className="mt-0.5 h-8 w-full rounded-lg border border-slate-800 bg-white px-2 text-[12px] font-semibold text-slate-100 outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-slate-400">행선지</label>
          <input
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            placeholder="예: OO병원 / 고객 미팅"
            className="mt-0.5 h-8 w-full rounded-lg border border-slate-800 bg-white px-2 text-[12px] text-slate-100 outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-slate-400">사유</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="간단히"
            className="mt-0.5 h-8 w-full rounded-lg border border-slate-800 bg-white px-2 text-[12px] text-slate-100 outline-none"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#0e1e3a] px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
      >
        <Send className="h-3.5 w-3.5" /> 직출 보고 제출
      </button>
      {msg ? <div className="mt-1.5 text-[11px] font-semibold text-emerald-400">{msg}</div> : null}
      {mine.length > 0 ? (
        <div className="mt-2 space-y-1">
          <div className="text-[10px] font-semibold text-slate-400">내 직출 보고</div>
          {mine.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-1 text-[11px]">
              <span className="font-semibold text-slate-100">{m.forDate}</span>
              <span className="truncate text-slate-500">{m.destination || m.reason || ''}</span>
              <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${statusCls[m.status]}`}>{statusLabel[m.status]}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** 관리자/팀장용 — 직출 승인/반려 + 잠시 멈춤 관리. */
export function AttendanceManageCard({ staff, paused, onChanged }: { staff: StaffOpt[]; paused: PausedStaff[]; onChanged: () => void }): JSX.Element {
  const [pending, setPending] = useState<JikchulReport[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pauseSel, setPauseSel] = useState('')

  const loadPending = async (): Promise<void> => {
    const r = await listJikchulReports({ status: 'pending' })
    if (r.ok) setPending(r.items)
  }
  useEffect(() => {
    void loadPending()
  }, [])

  const review = async (id: string, status: 'approved' | 'rejected'): Promise<void> => {
    setBusyId(id)
    await reviewJikchulReport(id, status)
    setBusyId(null)
    await loadPending()
    onChanged()
  }
  const doPause = async (): Promise<void> => {
    if (!pauseSel) return
    const s = staff.find((x) => x.id === pauseSel)
    setBusyId(pauseSel)
    await pauseStaff(pauseSel, s?.name)
    setBusyId(null)
    setPauseSel('')
    onChanged()
  }
  const doResume = async (staffId: string): Promise<void> => {
    setBusyId(staffId)
    await resumeStaff(staffId)
    setBusyId(null)
    onChanged()
  }

  const pausedIds = new Set(paused.map((p) => p.staffId))
  const pausable = staff.filter((s) => !pausedIds.has(s.id))

  return (
    <div className="mb-4 space-y-3">
      {/* 직출 승인 */}
      <div className="rounded-xl border border-slate-800 bg-white p-3">
        <div className="mb-2 text-[12px] font-bold text-slate-100">
          직출 보고 승인 <span className="font-medium text-slate-500">(대기 {pending.length}건)</span>
        </div>
        {pending.length === 0 ? (
          <div className="text-[11px] text-slate-500">승인 대기중인 직출 보고가 없습니다.</div>
        ) : (
          <div className="space-y-1">
            {pending.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-[12px]">
                <span className="font-semibold text-slate-100">{r.staffName || '직원'}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-700">{r.forDate}</span>
                <span className="min-w-0 truncate text-slate-400">{[r.destination, r.reason].filter(Boolean).join(' · ')}</span>
                <div className="ml-auto flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => void review(r.id, 'approved')}
                    disabled={busyId === r.id}
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" /> 승인
                  </button>
                  <button
                    type="button"
                    onClick={() => void review(r.id, 'rejected')}
                    disabled={busyId === r.id}
                    className="inline-flex items-center gap-1 rounded-full bg-rose-500 px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-50"
                  >
                    <X className="h-3 w-3" /> 반려
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 잠시 멈춤 관리 */}
      <div className="rounded-xl border border-slate-800 bg-white p-3">
        <div className="mb-2 text-[12px] font-bold text-slate-100">
          잠시 멈춤 <span className="font-medium text-slate-500">(멈춤 중 {paused.length}명 — 출근현황 제외)</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={pauseSel}
            onChange={(e) => setPauseSel(e.target.value)}
            className="h-8 min-w-0 flex-1 rounded-lg border border-slate-800 bg-white px-2 text-[12px] font-semibold text-slate-100 outline-none"
          >
            <option value="">— 멈출 직원 선택 —</option>
            {pausable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void doPause()}
            disabled={!pauseSel || busyId === pauseSel}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-700 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
          >
            <Pause className="h-3.5 w-3.5" /> 멈춤
          </button>
        </div>
        {paused.length > 0 ? (
          <div className="mt-2 space-y-1">
            {paused.map((p) => (
              <div key={p.staffId} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-[12px]">
                <span className="font-semibold text-slate-100">{p.staffName || '직원'}</span>
                <span className="text-[10px] text-slate-500">멈춤 중</span>
                <button
                  type="button"
                  onClick={() => void doResume(p.staffId)}
                  disabled={busyId === p.staffId}
                  className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-50"
                >
                  <Play className="h-3 w-3" /> 재개
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
