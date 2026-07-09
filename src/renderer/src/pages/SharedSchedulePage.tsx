import { useEffect, useMemo, useState } from 'react'
import { Share2, Plus, X, Loader2, MapPin, Trash2, AlertTriangle, ChevronDown } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import {
  addSharedSchedule,
  deleteSharedSchedule,
  listSharedSchedules,
  type SharedSchedule
} from '@renderer/services/commercial/sharedScheduleService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

/**
 * 공유 일정 게시판 — 개인 일정과 분리된 전 직원 공용 보드 (대표 승인: 게시판 방식).
 * 누구나 올리고 전 직원이 본다. 삭제는 본인 글 + 관리자.
 */

const RT_TABLES = ['shared_schedules']
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']

function fmt(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY_NAMES[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function SharedSchedulePage(): JSX.Element {
  const { session } = useSession()
  const admin = isAdminRole(session.role)
  const [items, setItems] = useState<SharedSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [showPast, setShowPast] = useState(false)

  // 등록 폼
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayYmd())
  const [time, setTime] = useState('10:00')
  const [location, setLocation] = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    const r = await listSharedSchedules()
    setItems(r.items)
    setError(r.ok ? undefined : r.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])
  useRealtimeSync(RT_TABLES, load)

  const now = Date.now()
  const upcoming = useMemo(
    () => items.filter((i) => Date.parse(i.startsAt) >= now - 3600000).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    [items, now]
  )
  const past = useMemo(() => items.filter((i) => Date.parse(i.startsAt) < now - 3600000), [items, now])

  const submit = async (): Promise<void> => {
    if (!title.trim()) {
      setError('제목을 입력해 주세요.')
      return
    }
    const [h, m] = time.split(':').map(Number)
    const [y, mo, d] = date.split('-').map(Number)
    const starts = new Date(y, mo - 1, d, h || 10, m || 0)
    setBusy(true)
    const r = await addSharedSchedule({ title, startsAt: starts.toISOString(), location: location || undefined, detail: detail || undefined })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setError(undefined)
    setTitle('')
    setLocation('')
    setDetail('')
    setFormOpen(false)
    void load()
  }

  const del = async (i: SharedSchedule): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm(`"${i.title}" 공유 일정을 삭제할까요?`)) return
    const r = await deleteSharedSchedule(i.id)
    if (!r.ok) {
      setError(r.error)
      return
    }
    void load()
  }

  const Row = ({ i }: { i: SharedSchedule }): JSX.Element => {
    const mineOrAdmin = admin || i.staffId === session.id
    const isMine = i.staffId === session.id
    return (
      <div className="rounded-xl border border-slate-800 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded-lg bg-[#0e1e3a] px-2 py-1 text-[11px] font-bold tabular-nums text-[#e6c877]">{fmt(i.startsAt)}</span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-100">{i.title}</span>
          {mineOrAdmin ? (
            <button type="button" onClick={() => void del(i)} aria-label="삭제" className="shrink-0 rounded-lg p-1 text-slate-400 active:text-rose-600">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        {i.detail ? <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-400">{i.detail}</p> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span
            className={[
              'rounded-full px-2 py-0.5 font-bold',
              isMine ? 'bg-[#c6982f]/15 text-[#b0821f]' : 'bg-indigo-50 text-indigo-600'
            ].join(' ')}
          >
            {i.staffName}
            {isMine ? ' (나)' : ''}
          </span>
          {i.location ? (
            <span className="inline-flex items-center gap-0.5">
              <MapPin className="h-3 w-3" /> {i.location}
            </span>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-[#b0821f]" />
            <div>
              <h2 className="text-base font-bold text-slate-100">공유 일정</h2>
              <p className="text-[10px] text-slate-500">전 직원이 함께 보는 일정 게시판 — 개인 일정은 본인만 보입니다</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setFormOpen((v) => !v)
              setError(undefined)
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm active:brightness-110"
          >
            {formOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {formOpen ? '닫기' : '공유 등록'}
          </button>
        </div>

        {formOpen ? (
          <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-2.5">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="제목 — 예: 사무실 전체 교육, 지점 회식"
              className="mb-2 w-full rounded-xl border border-slate-800 bg-white px-2.5 py-2 text-[13px] text-slate-100 placeholder:text-slate-500"
            />
            <div className="mb-2 grid grid-cols-2 gap-2">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl border border-slate-800 bg-white px-2.5 py-2 text-[13px] text-slate-100" />
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-xl border border-slate-800 bg-white px-2.5 py-2 text-[13px] text-slate-100" />
            </div>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="장소 (선택)"
              className="mb-2 w-full rounded-xl border border-slate-800 bg-white px-2.5 py-2 text-[13px] text-slate-100 placeholder:text-slate-500"
            />
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="내용 (선택) — 함께 알아야 할 안내"
              rows={2}
              className="mb-2 w-full rounded-xl border border-slate-800 bg-white px-2.5 py-2 text-[13px] text-slate-100 placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white active:brightness-110 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} 전 직원에게 공유
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 공유 일정을 불러오는 중…
        </div>
      ) : upcoming.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 py-8 text-center text-[12px] text-slate-500">
          다가오는 공유 일정이 없습니다. 위의 <b className="text-slate-300">공유 등록</b>으로 전 직원에게 알려보세요.
        </div>
      ) : (
        <div className="space-y-2">
          {upcoming.map((i) => (
            <Row key={i.id} i={i} />
          ))}
        </div>
      )}

      {past.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setShowPast((v) => !v)}
            className="flex w-full items-center justify-center gap-1 py-1 text-[11px] font-medium text-slate-500"
          >
            지난 공유 일정 {past.length}건 <ChevronDown className={['h-3.5 w-3.5 transition-transform', showPast ? 'rotate-180' : ''].join(' ')} />
          </button>
          {showPast ? (
            <div className="mt-1 space-y-2 opacity-70">
              {past.map((i) => (
                <Row key={i.id} i={i} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
