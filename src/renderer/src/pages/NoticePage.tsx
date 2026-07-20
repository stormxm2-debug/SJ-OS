import { useEffect, useMemo, useState } from 'react'
import { Megaphone, Pin, AlertTriangle, Loader2, ChevronLeft, Database, HardDrive, Plus, Send, X, CheckCircle2, SlidersHorizontal } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { useIsMobile } from '@renderer/navigation/appTarget'
import type { AnnouncementPriority, AnnouncementView } from '@shared/commercial/announcements'
import { PRIORITY_LABEL, TARGET_LABEL } from '@shared/commercial/announcements'
import { createAnnouncement, listVisibleAnnouncements, markAnnouncementRead, type AnnDataMode } from '@renderer/services/commercial/announcementService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

/** Tables whose changes should live-refresh this screen (stable ref for the hook). */
const RT_TABLES = ['announcements']

const PRIORITY_OPTIONS: AnnouncementPriority[] = ['normal', 'important', 'urgent']

/**
 * 공지사항 (staff). Shows only published + targeted notices (RLS + client filter),
 * pinned first, with read/unread state. Opening a notice marks it read for the
 * current user only. Mobile-friendly cards.
 *
 * 관리자(owner/admin)는 상단 '공지 쓰기' 칸에서 바로 작성·발행할 수 있다
 * (제목·내용·중요도·고정, 대상=전 직원, 즉시 발행 — 대표 지시). 역할/팀 대상
 * 지정·임시저장·숨김·보관은 [상세 관리](announcements 라우트, 데스크톱)에서.
 */
export default function NoticePage(): JSX.Element {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const isMobileVp = useIsMobile()
  const isAdmin = session.role === 'owner' || session.role === 'admin'
  const [items, setItems] = useState<AnnouncementView[]>([])
  const [mode, setMode] = useState<AnnDataMode>('local-mock')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [selected, setSelected] = useState<AnnouncementView | null>(null)

  // 관리자 공지 쓰기 칸
  const [composeOpen, setComposeOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState<AnnouncementPriority>('normal')
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [composeMsg, setComposeMsg] = useState<{ ok: boolean; text: string } | undefined>()

  const viewer = { role: session.role, teamId: session.teamName, teamName: session.teamName }

  const load = async (): Promise<void> => {
    setLoading(true)
    const res = await listVisibleAnnouncements(viewer)
    setMode(res.mode)
    setItems(res.announcements)
    setError(res.ok ? undefined : res.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Live sync: re-load instantly when announcements change on any device.
  useRealtimeSync(RT_TABLES, load)

  const unread = useMemo(() => items.filter((a) => !a.read).length, [items])

  const open = async (a: AnnouncementView): Promise<void> => {
    setSelected(a)
    if (!a.read) {
      await markAnnouncementRead(a.id)
      void load()
    }
  }

  /** 관리자: 즉시 발행 (대상=전 직원). 세부 옵션은 상세 관리 페이지에서. */
  const publish = async (): Promise<void> => {
    if (!title.trim() || !body.trim()) {
      setComposeMsg({ ok: false, text: '제목과 내용을 입력해주세요.' })
      return
    }
    setBusy(true)
    setComposeMsg(undefined)
    const res = await createAnnouncement({
      title,
      body,
      priority,
      targetType: 'all',
      pinned,
      status: 'published',
      createdBy: session.id,
      createdByName: session.name
    })
    setBusy(false)
    if (res.ok) {
      setTitle('')
      setBody('')
      setPriority('normal')
      setPinned(false)
      setComposeOpen(false)
      setComposeMsg({ ok: true, text: '공지가 발행되었습니다. 전 직원 화면에 바로 표시됩니다.' })
      void load()
    } else {
      setComposeMsg({ ok: false, text: res.error ?? '공지 발행에 실패했습니다.' })
    }
  }

  if (selected) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <button type="button" onClick={() => setSelected(null)} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ChevronLeft className="h-4 w-4" /> 목록으로</button>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {selected.pinned ? <Badge tone="amber"><Pin className="h-3 w-3" /> 고정</Badge> : null}
            <PriorityBadge p={selected.priority} />
            <Badge tone="slate">{TARGET_LABEL[selected.targetType]}</Badge>
          </div>
          <h1 className="text-lg font-bold text-slate-100">{selected.title}</h1>
          <div className="mt-1 text-[11px] text-slate-400">{selected.publishedAt ? new Date(selected.publishedAt).toLocaleString() : ''}</div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{selected.body}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Megaphone className="h-6 w-6 text-indigo-500" />
        <h1 className="text-xl font-bold text-slate-100">공지사항</h1>
        {unread > 0 ? <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">안읽음 {unread}</span> : null}
        <ModeBadge mode={mode} />
      </div>
      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600"><AlertTriangle className="mr-1 inline h-3 w-3" />{error}</div> : null}

      {/* 관리자: 공지 쓰기 칸 (즉시 발행 · 대상=전 직원) */}
      {isAdmin ? (
        <div className="rounded-2xl border border-[#e6c877] bg-[#fdf7ea] p-3">
          {!composeOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setComposeOpen(true)
                  setComposeMsg(undefined)
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-110"
              >
                <Plus className="h-3.5 w-3.5" /> 공지 쓰기
              </button>
              {!isMobileVp ? (
                <button
                  type="button"
                  onClick={() => navigate({ name: 'announcements' })}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#c6982f] bg-white px-3 py-2 text-xs font-semibold text-[#8a6a1f] transition hover:brightness-95"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" /> 상세 관리
                </button>
              ) : null}
              <span className="text-[11px] text-slate-500">관리자 전용 — 등록하면 전 직원에게 바로 발행됩니다</span>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="공지 제목"
                className="w-full rounded-lg border border-slate-800 bg-white px-3 py-2 text-sm font-semibold text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="공지 내용을 입력하세요"
                rows={4}
                className="w-full resize-y rounded-lg border border-slate-800 bg-white px-3 py-2 text-sm leading-6 text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as AnnouncementPriority)}
                  className="rounded-lg border border-slate-800 bg-white px-2 py-2 text-xs font-medium text-slate-200 focus:outline-none"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-300">
                  <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-3.5 w-3.5" />
                  <Pin className="h-3 w-3 text-amber-600" /> 상단 고정
                </label>
                <span className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void publish()}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} 발행
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposeOpen(false)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200"
                  >
                    <X className="h-3.5 w-3.5" /> 취소
                  </button>
                </span>
              </div>
              <p className="text-[10px] text-slate-500">대상은 전 직원입니다 · 역할/팀별 공지, 임시저장, 숨김·보관은 [상세 관리]에서 할 수 있습니다</p>
            </div>
          )}
          {composeMsg ? (
            <p className={['mt-2 flex items-center gap-1.5 text-[12px]', composeMsg.ok ? 'text-emerald-600' : 'text-rose-600'].join(' ')}>
              {composeMsg.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {composeMsg.text}
            </p>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">현재 확인할 공지사항이 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <button key={a.id} type="button" onClick={() => void open(a)} className={['w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition active:bg-slate-50', a.read ? 'border-slate-200' : 'border-indigo-200 ring-1 ring-indigo-100'].join(' ')}>
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                {a.pinned ? <Badge tone="amber"><Pin className="h-3 w-3" /> 고정</Badge> : null}
                <PriorityBadge p={a.priority} />
                <Badge tone="slate">{TARGET_LABEL[a.targetType]}</Badge>
                {!a.read ? <span className="ml-auto h-2 w-2 rounded-full bg-rose-500" /> : null}
              </div>
              <div className={['text-sm', a.read ? 'font-medium text-slate-300' : 'font-bold text-slate-100'].join(' ')}>{a.title}</div>
              <div className="mt-0.5 line-clamp-2 text-[12px] text-slate-500">{a.body}</div>
              <div className="mt-1 text-[10px] text-slate-400">{a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : ''}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'amber' | 'slate' | 'rose' | 'indigo' }): JSX.Element {
  const t = tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-600' : tone === 'rose' ? 'border-rose-200 bg-rose-50 text-rose-600' : tone === 'indigo' ? 'border-indigo-200 bg-indigo-50 text-indigo-600' : 'border-slate-200 bg-slate-50 text-slate-600'
  return <span className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', t].join(' ')}>{children}</span>
}
function PriorityBadge({ p }: { p: AnnouncementView['priority'] }): JSX.Element {
  if (p === 'urgent') return <Badge tone="rose"><AlertTriangle className="h-3 w-3" /> {PRIORITY_LABEL.urgent}</Badge>
  if (p === 'important') return <Badge tone="amber">{PRIORITY_LABEL.important}</Badge>
  return <Badge tone="slate">{PRIORITY_LABEL.normal}</Badge>
}
function ModeBadge({ mode }: { mode: AnnDataMode }): JSX.Element {
  const supa = mode === 'supabase'
  return <span className={['ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold', supa ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-blue-200 bg-blue-50 text-blue-600'].join(' ')}>{supa ? <Database className="h-3 w-3" /> : <HardDrive className="h-3 w-3" />}{supa ? 'Supabase' : '로컬'}</span>
}
