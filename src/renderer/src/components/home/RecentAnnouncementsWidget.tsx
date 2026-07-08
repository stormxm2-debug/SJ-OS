import { useCallback, useEffect, useRef, useState } from 'react'
import { Megaphone, AlertTriangle, ChevronRight } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { AnnouncementView } from '@shared/commercial/announcements'
import { listVisibleAnnouncements } from '@renderer/services/commercial/announcementService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

/** Tables whose changes should live-refresh this widget (stable ref for the hook). */
const RT_TABLES = ['announcements']

/**
 * 최근 공지 widget for staff home (desktop + mobile). Shows the latest 3 visible
 * announcements + unread badge. Read/target scoping comes from the service (RLS).
 */
export default function RecentAnnouncementsWidget(): JSX.Element {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const [items, setItems] = useState<AnnouncementView[]>([])
  const [unread, setUnread] = useState(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    const res = await listVisibleAnnouncements({ role: session.role, teamId: session.teamName, teamName: session.teamName })
    if (!mounted.current) return
    setItems(res.announcements.slice(0, 3))
    setUnread(res.announcements.filter((a) => !a.read).length)
  }, [session.role, session.teamName])

  useEffect(() => {
    void load()
  }, [load])
  // Live sync: re-load instantly when announcements change on any device.
  useRealtimeSync(RT_TABLES, load)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-300">
        <Megaphone className="h-4 w-4 text-indigo-500" /> 최근 공지
        {unread > 0 ? <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">{unread}</span> : null}
      </div>
      {items.length === 0 ? (
        <p className="py-2 text-center text-[11px] text-slate-400">확인할 공지가 없습니다.</p>
      ) : (
        <div className="space-y-1">
          {items.map((a) => (
            <button key={a.id} type="button" onClick={() => navigate({ name: 'notice' })} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left transition active:bg-slate-50">
              <span className="flex min-w-0 items-center gap-1.5 text-xs">
                {a.priority === 'urgent' ? <AlertTriangle className="h-3 w-3 shrink-0 text-rose-500" /> : null}
                <span className={['truncate', a.read ? 'font-medium text-slate-600' : 'font-bold text-slate-100'].join(' ')}>{a.pinned ? '📌 ' : ''}{a.title}</span>
              </span>
              {!a.read ? <span className="ml-2 h-2 w-2 shrink-0 rounded-full bg-rose-500" /> : null}
            </button>
          ))}
        </div>
      )}
      <button type="button" onClick={() => navigate({ name: 'notice' })} className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg border border-slate-200 py-2 text-[11px] font-medium text-indigo-600 transition active:bg-slate-50">
        공지사항 보기 <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  )
}
