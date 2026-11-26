import { useCallback, useEffect, useState } from 'react'
import { Wrench, Trash2, RefreshCw, ArrowRight, CheckCircle2 } from 'lucide-react'
import {
  isSupabaseMode,
  listRequests,
  updateStatus,
  deleteRequest,
  DEV_STATUS_LABEL,
  DEV_RT_TABLES,
  type DevRequest,
  type DevStatus
} from '@renderer/services/commercial/devRequestService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

const STATUS_STYLE: Record<DevStatus, string> = {
  new: 'border-slate-300 bg-slate-100 text-slate-600',
  doing: 'border-amber-300 bg-amber-50 text-amber-700',
  done: 'border-emerald-300 bg-emerald-50 text-emerald-700'
}
const NEXT: Record<DevStatus, DevStatus> = { new: 'doing', doing: 'done', done: 'new' }

/**
 * 개발 요청함 (대표 전용) — 경영 회의실 안건 등에서 넘어온 개발 요청을 상태별로 관리.
 */
export default function DevRequestsPage(): JSX.Element {
  const supa = isSupabaseMode()
  const [rows, setRows] = useState<DevRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supa) return
    setLoading(true)
    setErr(null)
    try {
      setRows(await listRequests())
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [supa])

  useEffect(() => {
    void load()
  }, [load])
  useRealtimeSync(DEV_RT_TABLES, load)

  const onCycle = async (r: DevRequest): Promise<void> => {
    const next = NEXT[r.status]
    setRows((list) => list.map((x) => (x.id === r.id ? { ...x, status: next } : x)))
    try {
      await updateStatus(r.id, next)
    } catch {
      await load()
    }
  }
  const onDelete = async (id: string): Promise<void> => {
    if (!window.confirm('이 요청을 삭제할까요?')) return
    setRows((list) => list.filter((x) => x.id !== id))
    try {
      await deleteRequest(id)
    } catch {
      await load()
    }
  }

  const counts = {
    new: rows.filter((r) => r.status === 'new').length,
    doing: rows.filter((r) => r.status === 'doing').length,
    done: rows.filter((r) => r.status === 'done').length
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-100">
            <Wrench className="h-5 w-5 text-[#e6c877]" /> 개발 요청함
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">경영 회의실 안건 등에서 넘어온 개발 요청을 관리합니다</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
        >
          <RefreshCw className="h-3.5 w-3.5" /> 새로고침
        </button>
      </div>

      <div className="flex gap-2">
        {(['new', 'doing', 'done'] as DevStatus[]).map((s) => (
          <div key={s} className={['flex-1 rounded-xl border px-3 py-2 text-center', STATUS_STYLE[s]].join(' ')}>
            <div className="text-lg font-bold">{counts[s]}</div>
            <div className="text-[11px] font-semibold">{DEV_STATUS_LABEL[s]}</div>
          </div>
        ))}
      </div>

      {!supa ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          전산(서버) 연동 환경에서만 동작합니다.
        </div>
      ) : null}
      {err ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-white/50 px-4 py-10 text-center text-sm text-slate-500">
          {loading ? '불러오는 중…' : '아직 개발 요청이 없습니다. 경영 회의실 안건에서 ‘개발 요청’을 눌러 추가하세요.'}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <section key={r.id} className="rounded-2xl border border-slate-800 bg-white p-3 shadow-sm">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => void onCycle(r)}
                  className={['shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold', STATUS_STYLE[r.status]].join(' ')}
                  title="눌러서 상태 변경 (접수 → 진행 → 완료)"
                >
                  {DEV_STATUS_LABEL[r.status]}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={['text-sm font-medium', r.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'].join(' ')}>
                    {r.title}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
                    {r.source === 'board-meeting' ? <span>경영 회의실{r.sourceRef ? ` · ${r.sourceRef}` : ''}</span> : r.source ? <span>{r.source}</span> : null}
                    <span>{new Date(r.createdAt).toLocaleDateString('ko-KR')}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void onDelete(r.id)}
                  className="shrink-0 text-slate-400 hover:text-rose-500"
                  aria-label="삭제"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="flex items-center gap-1 px-1 text-[11px] text-slate-400">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        상태 칩을 누르면 접수 <ArrowRight className="inline h-3 w-3" /> 진행 <ArrowRight className="inline h-3 w-3" /> 완료로 바뀝니다
      </p>
    </div>
  )
}
