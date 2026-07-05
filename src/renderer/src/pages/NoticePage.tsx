import { Megaphone, Pin } from 'lucide-react'
import { noticeService } from '@renderer/services/mvp'

/**
 * 공지사항 (MVP). Local mock notices.
 * Future: replace with noticeService server API.
 */
export default function NoticePage(): JSX.Element {
  const notices = noticeService.list()
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">공지사항</h1>
        <p className="text-sm text-slate-500">상용 MVP 로컬 데이터 · 실제 공지 서버는 다음 단계에서 연결됩니다.</p>
      </div>
      <div className="space-y-2">
        {notices.map((n) => (
          <div key={n.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              {n.pinned ? <Pin className="h-4 w-4 text-amber-500" /> : <Megaphone className="h-4 w-4 text-indigo-500" />}
              <div className="text-sm font-semibold text-slate-800">{n.title}</div>
              <div className="ml-auto text-xs text-slate-400">{n.postedAt}</div>
            </div>
            <p className="mt-1.5 text-sm text-slate-500">{n.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
