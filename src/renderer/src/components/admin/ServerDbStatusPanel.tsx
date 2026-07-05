import { useState } from 'react'
import { Server, Database, RefreshCw, FileText, ListChecks, CheckCircle2, Circle } from 'lucide-react'
import { API_ENDPOINTS } from '@shared/commercial/apiContract'
import {
  getCommercialReadiness,
  getServerDbStatus,
  SERVER_CONNECT_CHECKLIST,
  type ReadinessStatus,
  type ServerDbStatus
} from '@renderer/services/commercial/backendConfig'

/**
 * 서버/DB 연결 상태 + 상용화 준비 체크리스트 (owner/admin only). Reports the local-mock
 * status and the future API contract — it never contacts an external server. Inline
 * cards only; no backdrop.
 */
export default function ServerDbStatusPanel(): JSX.Element {
  const [status, setStatus] = useState<ServerDbStatus>(() => getServerDbStatus())
  const [showContract, setShowContract] = useState(false)
  const [showChecklist, setShowChecklist] = useState(false)
  const readiness = getCommercialReadiness()

  const endpointRows = Object.entries(API_ENDPOINTS).flatMap(([group, eps]) =>
    Object.entries(eps).map(([name, ep]) => ({ group, name, method: ep.method, path: ep.path }))
  )

  return (
    <div className="space-y-4">
      {/* Server / DB status */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-indigo-500" />
            <h2 className="text-base font-bold text-slate-800">서버/DB 연결 상태</h2>
          </div>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">상용 준비 · 로컬 MVP</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <Field label="현재 데이터 모드" value={status.dataMode} />
          <Field label="서버 API URL" value={status.apiBaseUrl} />
          <Field label="DB 연결" value={status.dbConnection} />
          <Field label="인증 방식" value={status.authMode} />
          <Field label="동기화 상태" value={status.syncStatus} />
          <Field label="마지막 확인" value={status.lastCheckedAt} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn icon={<RefreshCw className="h-3 w-3" />} label="연결 상태 확인" onClick={() => setStatus(getServerDbStatus())} />
          <Btn icon={<FileText className="h-3 w-3" />} label="API 계약 보기" onClick={() => setShowContract((s) => !s)} />
          <Btn icon={<ListChecks className="h-3 w-3" />} label="서버 연결 준비 체크리스트 보기" onClick={() => setShowChecklist((s) => !s)} />
        </div>

        {showContract ? (
          <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-1 text-[11px] font-semibold text-slate-600">향후 서버 API 엔드포인트 ({endpointRows.length})</div>
            <div className="space-y-0.5 font-mono text-[10px] text-slate-500">
              {endpointRows.map((r) => (
                <div key={`${r.group}.${r.name}`}>
                  <span className="inline-block w-12 font-bold text-indigo-600">{r.method}</span> {r.path}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {showChecklist ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-1 text-[11px] font-semibold text-slate-600">서버 연결 준비 체크리스트</div>
            <ul className="space-y-0.5 text-[11px] text-slate-500">
              {SERVER_CONNECT_CHECKLIST.map((c, i) => <li key={c}>{i + 1}. {c}</li>)}
            </ul>
          </div>
        ) : null}
      </div>

      {/* Commercial readiness checklist */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Database className="h-5 w-5 text-indigo-500" />
          <h2 className="text-base font-bold text-slate-800">상용화 준비 체크리스트</h2>
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {readiness.map((it) => (
            <div key={it.label} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-1.5 text-xs">
              <span className="flex items-center gap-1.5 text-slate-700">
                {it.status === '완료' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Circle className="h-3.5 w-3.5 text-slate-300" />}
                {it.label}
              </span>
              <span className={['rounded-full border px-2 py-0.5 text-[10px] font-bold', readinessTone(it.status)].join(' ')}>{it.status}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[10px] text-slate-400">상용 MVP 로컬 데이터 · 실제 백엔드/DB 연결은 다음 단계에서 진행됩니다.</p>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="truncate font-mono text-[11px] font-semibold text-slate-700">{value}</div>
    </div>
  )
}
function readinessTone(s: ReadinessStatus): string {
  if (s === '완료') return 'border-emerald-200 bg-emerald-50 text-emerald-600'
  if (s === '준비됨') return 'border-indigo-200 bg-indigo-50 text-indigo-600'
  if (s === '로컬 MVP') return 'border-blue-200 bg-blue-50 text-blue-600'
  if (s === '미연결') return 'border-amber-200 bg-amber-50 text-amber-600'
  return 'border-slate-200 bg-slate-50 text-slate-500'
}
function Btn({ icon, label, onClick }: { icon: JSX.Element; label: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50">
      {icon}
      {label}
    </button>
  )
}
