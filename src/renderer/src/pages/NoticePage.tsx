import { useEffect, useMemo, useState } from 'react'
import { Megaphone, Pin, AlertTriangle, Loader2, ChevronLeft, Database, HardDrive } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import type { AnnouncementView } from '@shared/commercial/announcements'
import { PRIORITY_LABEL, TARGET_LABEL } from '@shared/commercial/announcements'
import { listVisibleAnnouncements, markAnnouncementRead, type AnnDataMode } from '@renderer/services/commercial/announcementService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

/** Tables whose changes should live-refresh this screen (stable ref for the hook). */
const RT_TABLES = ['announcements']

/**
 * 공지사항 (staff). Shows only published + targeted notices (RLS + client filter),
 * pinned first, with read/unread state. Opening a notice marks it read for the
 * current user only. Mobile-friendly cards. No admin controls here.
 */
export default function NoticePage(): JSX.Element {
  const { session } = useSession()
  const [items, setItems] = useState<AnnouncementView[]>([])
  const [mode, setMode] = useState<AnnDataMode>('local-mock')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [selected, setSelected] = useState<AnnouncementView | null>(null)

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
