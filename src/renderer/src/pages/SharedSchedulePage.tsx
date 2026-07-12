import { useEffect, useMemo, useState } from 'react'
import { Share2, Plus, X, Loader2, MapPin, Trash2, AlertTriangle, ChevronDown, UserRound, CalendarDays } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import {
  addSharedSchedule,
  deleteSharedSchedule,
  listSharedSchedules,
  type SharedSchedule
} from '@renderer/services/commercial/sharedScheduleService'
import { listScheduleEvents } from '@renderer/services/commercial/scheduleService'
import type { ScheduleWithCustomer } from '@renderer/services/commercial/supabaseScheduleAdapter'
import { SCHEDULE_TYPE_LABEL } from '@renderer/services/commercial/scheduleValidation'
import { listOverviewStaff } from '@renderer/services/commercial/staffOverviewService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

/**
 * 공유 일정 (관리자 전용, 2026-07-10 대표 지시로 재편) —
 * ① 전 직원의 개인 일정(schedule_events)이 자동으로 여기에 모여 보인다
 *    (관리자 RLS로 전체 조회 — 직원들은 이 화면 자체가 안 보임).
 * ② 관리자가 직접 올리는 공지성 일정(shared_schedules)도 함께 표시.
 * 직원 화면에서는 메뉴가 제거되었고 라우트도 관리자만 접근 가능.
 */

const RT_TABLES = ['shared_schedules', 'schedule_events']
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']

function fmt(iso: string): string {
  const d = new Date(Date.parse(iso))
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY_NAMES[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 피드 항목 — 관리자 등록 글(post) 또는 직원 개인 일정(event). */
type FeedItem = { startsAt: string } & ({ kind: 'post'; post: SharedSchedule } | { kind: 'event'; ev: ScheduleWithCustomer })

export default function SharedSchedulePage(): JSX.Element {
  const { session } = useSession()
  const admin = isAdminRole(session.role)
  const [posts, setPosts] = useState<SharedSchedule[]>([])
  const [events, setEvents] = useState<ScheduleWithCustomer[]>([])
  const [staffNames, setStaffNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [showPast, setShowPast] = useState(false)

  // 관리자 등록 폼
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayYmd())
  const [time, setTime] = useState('10:00')
  const [location, setLocation] = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    const [p, e, staff] = await Promise.all([listSharedSchedules(), listScheduleEvents(), listOverviewStaff()])
    setPosts(p.items)
    setEvents(e.events)
    setStaffNames(new Map(staff.map((s) => [s.id, s.name])))
    setError(p.ok ? undefined : p.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])
  useRealtimeSync(RT_TABLES, load)

  const feed: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [
      ...posts.map((post) => ({ kind: 'post' as const, post, startsAt: post.startsAt })),
      ...events
        .filter((ev) => !Number.isNaN(Date.parse(ev.startsAt)))
        .map((ev) => ({ kind: 'event' as const, ev, startsAt: ev.startsAt }))
    ]
    return items
  }, [posts, events])

  // ─── 이번 주 직원별 활동량 (월~일 · 개인/내부 일정, 취소 제외) ──────────
  const week = useMemo(() => {
    const d = new Date()
    const day = d.getDay() // 0=일 … 6=토
    const mondayOffset = day === 0 ? -6 : 1 - day
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + mondayOffset)
    const end = new Date(start)
    end.setDate(start.getDate() + 7)
    return { start, end }
  }, [])
  const weeklyByStaff = useMemo(() => {
    const map = new Map<string, { id: string; total: number; done: number; types: Map<string, number> }>()
    for (const ev of events) {
      if (ev.type === 'personal' || ev.type === 'internal') continue
      if (ev.status === 'cancelled') continue
      const t = Date.parse(ev.startsAt)
      if (Number.isNaN(t) || t < week.start.getTime() || t >= week.end.getTime()) continue
      const cur = map.get(ev.staffId) ?? { id: ev.staffId, total: 0, done: 0, types: new Map<string, number>() }
      cur.total += 1
      if (ev.status === 'done') cur.done += 1
      cur.types.set(ev.type, (cur.types.get(ev.type) ?? 0) + 1)
      map.set(ev.staffId, cur)
    }
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [events, week])
  const weeklyMax = weeklyByStaff.reduce((m, s) => Math.max(m, s.total), 0)
  const weekRangeLabel = `${week.start.getMonth() + 1}/${week.start.getDate()}~${new Date(week.end.getTime() - 86400000).getMonth() + 1}/${new Date(week.end.getTime() - 86400000).getDate()}`

  const now = Date.now()
  const upcoming = useMemo(
    () => feed.filter((i) => Date.parse(i.startsAt) >= now - 3600000).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    [feed, now]
  )
  const past = useMemo(
    () => feed.filter((i) => Date.parse(i.startsAt) < now - 3600000).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)),
    [feed, now]
  )

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
    if (typeof window !== 'undefined' && !window.confirm(`"${i.title}" 등록 글을 삭제할까요?`)) return
    const r = await deleteSharedSchedule(i.id)
    if (!r.ok) {
      setError(r.error)
      return
    }
    void load()
  }

  const PostRow = ({ i }: { i: SharedSchedule }): JSX.Element => (
    <div className="rounded-xl border border-[#c6982f]/50 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-lg bg-[#0e1e3a] px-2 py-1 text-[11px] font-bold tabular-nums text-[#e6c877]">{fmt(i.startsAt)}</span>
        <span className="shrink-0 rounded-full bg-[#c6982f]/15 px-1.5 py-0.5 text-[9px] font-bold text-[#b0821f]">관리자 등록</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-100">{i.title}</span>
        {admin || i.staffId === session.id ? (
          <button type="button" onClick={() => void del(i)} aria-label="삭제" className="shrink-0 rounded-lg p-1 text-slate-400 active:text-rose-600">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {i.detail ? <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-400">{i.detail}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-bold text-indigo-600">{i.staffName}</span>
        {i.location ? (
          <span className="inline-flex items-center gap-0.5">
            <MapPin className="h-3 w-3" /> {i.location}
          </span>
        ) : null}
      </div>
    </div>
  )

  const EventRow = ({ ev }: { ev: ScheduleWithCustomer }): JSX.Element => (
    <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-white px-3 py-2.5 shadow-sm">
      <span className="shrink-0 rounded-lg bg-slate-950 px-2 py-1 text-[11px] font-bold tabular-nums text-slate-300">{fmt(ev.startsAt)}</span>
      <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
        {SCHEDULE_TYPE_LABEL[ev.type as keyof typeof SCHEDULE_TYPE_LABEL] ?? ev.type}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-slate-100">{ev.customerName || ev.title}</span>
        <span className="flex items-center gap-1 text-[10px] text-slate-500">
          <UserRound className="h-2.5 w-2.5" /> {staffNames.get(ev.staffId) || ev.staffName || '(이름없음)'}
          {ev.location ? (
            <span className="inline-flex min-w-0 items-center gap-0.5 truncate">
              · <MapPin className="h-2.5 w-2.5 shrink-0" /> <span className="truncate">{ev.location}</span>
            </span>
          ) : null}
        </span>
      </span>
      {ev.status === 'done' ? <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600">완료</span> : null}
      {ev.status === 'cancelled' ? <span className="shrink-0 rounded-full bg-slate-950 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">취소</span> : null}
    </div>
  )

  const Row = ({ i }: { i: FeedItem }): JSX.Element => (i.kind === 'post' ? <PostRow i={i.post} /> : <EventRow ev={i.ev} />)

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-[#b0821f]" />
            <div>
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-100">
                공유 일정
                <span className="rounded-full border border-[#c6982f]/40 bg-[#c6982f]/10 px-2 py-0.5 text-[10px] font-bold text-[#b0821f]">관리자 전용</span>
              </h2>
              <p className="text-[10px] text-slate-500">전 직원의 일정이 자동으로 모여 표시됩니다 (직원 화면에는 안 보임)</p>
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
            {formOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {formOpen ? '닫기' : '직접 등록'}
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
              placeholder="내용 (선택)"
              rows={2}
              className="mb-2 w-full rounded-xl border border-slate-800 bg-white px-2.5 py-2 text-[13px] text-slate-100 placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white active:brightness-110 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} 등록
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        ) : null}
      </div>

      {/* 이번 주 직원별 활동량 요약 — 누가 얼마나 뛰는지 한눈에 */}
      {!loading && weeklyByStaff.length > 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-3.5 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
            <div className="text-[12px] font-bold text-slate-100">
              이번 주 직원별 활동량 <span className="font-medium text-slate-500">({weekRangeLabel})</span>
            </div>
            <span className="text-[10px] text-slate-500">개인·내부 일정 제외 · 취소 미집계</span>
          </div>
          <div className="space-y-1.5">
            {weeklyByStaff.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5">
                <span className="w-16 shrink-0 truncate text-[12px] font-bold text-slate-100">{staffNames.get(s.id) || '(이름없음)'}</span>
                <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#c6982f] to-[#e6c877]"
                    style={{ width: `${weeklyMax > 0 ? Math.max(6, Math.round((s.total / weeklyMax) * 100)) : 0}%` }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right text-[12px] font-extrabold tabular-nums text-slate-100">{s.total}건</span>
                <span className="w-14 shrink-0 text-right text-[10px] font-bold text-emerald-600">완료 {s.done}</span>
                <span className="hidden shrink-0 gap-1 sm:flex">
                  {[...s.types.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([ty, n]) => (
                      <span key={ty} className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold text-indigo-600">
                        {SCHEDULE_TYPE_LABEL[ty as keyof typeof SCHEDULE_TYPE_LABEL] ?? ty} {n}
                      </span>
                    ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 전 직원 일정을 불러오는 중…
        </div>
      ) : upcoming.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 py-8 text-center text-[12px] text-slate-500">
          <CalendarDays className="mx-auto mb-1.5 h-6 w-6 text-slate-600" />
          다가오는 일정이 없습니다.
        </div>
      ) : (
        <div className="space-y-2">
          {upcoming.map((i) => (
            <Row key={i.kind === 'post' ? `p-${i.post.id}` : `e-${i.ev.id}`} i={i} />
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
            지난 일정 {past.length}건 <ChevronDown className={['h-3.5 w-3.5 transition-transform', showPast ? 'rotate-180' : ''].join(' ')} />
          </button>
          {showPast ? (
            <div className="mt-1 space-y-2 opacity-70">
              {past.map((i) => (
                <Row key={i.kind === 'post' ? `p-${i.post.id}` : `e-${i.ev.id}`} i={i} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
