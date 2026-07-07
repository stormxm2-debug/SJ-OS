import { useEffect, useState } from 'react'
import { Megaphone, Send, Save, RefreshCw, Loader2, Eye, EyeOff, Archive, Trash2, Pin } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import type { StaffRole } from '@shared/commercial/models'
import type { AnnouncementPriority, AnnouncementRecord, AnnouncementTargetType } from '@shared/commercial/announcements'
import { PRIORITY_LABEL, STATUS_LABEL, TARGET_LABEL } from '@shared/commercial/announcements'
import { ROLE_LABEL } from '@renderer/navigation/roleAccess'
import type { TeamRecord } from '@shared/commercial/teamOps'
import { listTeams } from '@renderer/services/commercial/staffOperationsService'
import {
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  hideAnnouncement,
  listAdminAnnouncements,
  publishAnnouncement,
  type AnnDataMode
} from '@renderer/services/commercial/announcementService'

/**
 * 공지사항 관리 (owner/admin only; Router-guarded + hidden on mobile). Create/publish/
 * hide/archive/delete announcements with all/role/team targeting + pin. Uses the
 * announcement service (Supabase when configured, else local-mock). No service_role.
 */
export default function AnnouncementAdminPage(): JSX.Element {
  const { session } = useSession()
  const [items, setItems] = useState<AnnouncementRecord[]>([])
  const [teams, setTeams] = useState<TeamRecord[]>([])
  const [mode, setMode] = useState<AnnDataMode>('local-mock')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState<AnnouncementPriority>('normal')
  const [targetType, setTargetType] = useState<AnnouncementTargetType>('all')
  const [targetRole, setTargetRole] = useState<StaffRole>('fc')
  const [targetTeamId, setTargetTeamId] = useState('')
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    const [a, t] = await Promise.all([listAdminAnnouncements(), listTeams()])
    setMode(a.mode)
    setItems(a.announcements)
    setTeams(t.teams)
    setError(a.ok ? undefined : a.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (status: 'draft' | 'published'): Promise<void> => {
    setBusy(true)
    const res = await createAnnouncement({
      title, body, priority, targetType,
      targetRole: targetType === 'role' ? targetRole : undefined,
      targetTeamId: targetType === 'team' ? targetTeamId : undefined,
      targetTeamName: targetType === 'team' ? teams.find((t) => t.id === targetTeamId)?.name : undefined,
      pinned, status, createdBy: session.id, createdByName: session.name
    })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    setError(undefined); setTitle(''); setBody(''); setPinned(false); void load()
  }
  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    const res = await fn()
    if (!res.ok) { setError(res.error); return }
    void load()
  }

  const targetLabel = (a: AnnouncementRecord): string =>
    a.targetType === 'role' ? `역할: ${a.targetRole ? ROLE_LABEL[a.targetRole] : '-'}` : a.targetType === 'team' ? `팀: ${teams.find((t) => t.id === a.targetTeamId)?.name ?? a.targetTeamName ?? '-'}` : TARGET_LABEL.all

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Megaphone className="h-6 w-6 text-indigo-500" />
        <h1 className="text-xl font-bold text-slate-100">공지사항 관리</h1>
        <span className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold', mode === 'supabase' ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-blue-200 bg-blue-50 text-blue-600'].join(' ')}>{mode === 'supabase' ? 'Supabase 공용 DB' : '로컬 MVP 데이터'}</span>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">관리자 전용</span>
      </div>
      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600">{error}</div> : null}

      {/* Compose */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-slate-300">공지 작성</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="내용" className="mb-2 h-24 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
          <label className="text-slate-500">중요도
            <select value={priority} onChange={(e) => setPriority(e.target.value as AnnouncementPriority)} className="ml-1 rounded-lg border border-slate-200 px-2 py-1 text-slate-300">
              {(['normal', 'important', 'urgent'] as AnnouncementPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </label>
          <label className="text-slate-500">대상
            <select value={targetType} onChange={(e) => setTargetType(e.target.value as AnnouncementTargetType)} className="ml-1 rounded-lg border border-slate-200 px-2 py-1 text-slate-300">
              <option value="all">전체</option>
              <option value="role">역할별</option>
              <option value="team">팀별</option>
            </select>
          </label>
          {targetType === 'role' ? (
            <select value={targetRole} onChange={(e) => setTargetRole(e.target.value as StaffRole)} className="rounded-lg border border-slate-200 px-2 py-1 text-slate-300">
              {(['owner', 'admin', 'team-leader', 'fc'] as StaffRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          ) : null}
          {targetType === 'team' ? (
            <select value={targetTeamId} onChange={(e) => setTargetTeamId(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-slate-300">
              <option value="">팀 선택</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          ) : null}
          <label className="inline-flex items-center gap-1 text-slate-600"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> <Pin className="h-3 w-3" /> 상단 고정</label>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void submit('draft')} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} 임시저장</button>
          <button type="button" onClick={() => void submit('published')} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} 게시</button>
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-300">공지 목록 ({items.length})</div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"><RefreshCw className="h-3 w-3" /> 새로고침</button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…</div>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">작성된 공지가 없습니다.</p>
        ) : (
          <div className="space-y-1.5">
            {items.map((a) => (
              <div key={a.id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2 text-[11px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-300">{a.pinned ? '📌 ' : ''}{a.title}</span>
                    <span className="text-slate-500"> · {STATUS_LABEL[a.status]} · {PRIORITY_LABEL[a.priority]} · {targetLabel(a)}{typeof a.readCount === 'number' ? ` · 읽음 ${a.readCount}` : ''}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {a.status !== 'published' ? <Act icon={<Eye className="h-3 w-3" />} label="게시" tone="emerald" onClick={() => void act(() => publishAnnouncement(a.id))} /> : <Act icon={<EyeOff className="h-3 w-3" />} label="숨김" onClick={() => void act(() => hideAnnouncement(a.id))} />}
                    <Act icon={<Archive className="h-3 w-3" />} label="보관" onClick={() => void act(() => archiveAnnouncement(a.id))} />
                    <Act icon={<Trash2 className="h-3 w-3" />} label="삭제" tone="rose" onClick={() => { if (window.confirm('이 공지를 삭제하시겠습니까?')) void act(() => deleteAnnouncement(a.id)) }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Act({ icon, label, onClick, tone }: { icon: JSX.Element; label: string; onClick: () => void; tone?: 'emerald' | 'rose' }): JSX.Element {
  const t = tone === 'emerald' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : tone === 'rose' ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
  return <button type="button" onClick={onClick} className={['inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium', t].join(' ')}>{icon}{label}</button>
}
