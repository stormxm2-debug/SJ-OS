import { useState } from 'react'
import { Database, RefreshCw, PlugZap, FileCode2, ShieldCheck, CheckCircle2, Circle } from 'lucide-react'
import {
  getCommercialReadiness,
  getServerDbStatus,
  type ReadinessStatus,
  type ServerDbStatus
} from '@renderer/services/commercial/backendConfig'
import { testSupabaseConnection, type ConnectionTestResult } from '@renderer/services/commercial/supabaseClient'
import { useSession } from '@renderer/navigation/SessionContext'
import { ROLE_LABEL } from '@renderer/navigation/roleAccess'

/**
 * Supabase 연결 상태 + 상용화 준비 체크리스트 (owner/admin only). Reports local Supabase
 * config status (URL/anon key presence only — never secrets, never service_role) and
 * points at the SQL/RLS drafts. It never contacts a server unless configured, and
 * the connection test is read-only + secret-free. Inline cards only; no backdrop.
 */
export default function ServerDbStatusPanel(): JSX.Element {
  const [status, setStatus] = useState<ServerDbStatus>(() => getServerDbStatus())
  const [test, setTest] = useState<ConnectionTestResult | null>(null)
  const [showSchema, setShowSchema] = useState(false)
  const [showRls, setShowRls] = useState(false)
  const readiness = getCommercialReadiness()
  const { authMode, authState, session, supabaseConfigured } = useSession()

  const runTest = async (): Promise<void> => {
    setTest(await testSupabaseConnection())
    setStatus(getServerDbStatus())
  }

  return (
    <div className="space-y-4">
      {/* Supabase status */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-emerald-500" />
            <h2 className="text-base font-bold text-slate-800">Supabase 연결 상태</h2>
          </div>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">상용 준비 · 로컬 MVP</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <Field label="현재 모드" value={status.mode} />
          <Field label="Supabase URL" value={status.supabaseUrlConfigured} />
          <Field label="anon key" value={status.anonKeyConfigured} />
          <Field label="service role" value="사용 금지" danger />
          <Field label="연결 상태" value={status.connectionStatus} />
          <Field label="RLS 준비" value={status.rlsStatus} />
        </div>
        {/* Auth status */}
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <Field label="Auth 방식" value={authMode} />
          <Field label="Supabase 설정" value={supabaseConfigured ? 'configured' : 'not configured'} />
          <Field label="현재 세션" value={authState === 'logged-in' ? 'active' : 'inactive'} />
          <Field label="프로필 로드" value={authState === 'logged-in' ? 'yes' : authState === 'profile-missing' ? 'missing' : 'no'} />
          <Field label="현재 권한" value={authState === 'logged-in' ? ROLE_LABEL[session.role] : '-'} />
          <Field label="RLS" value="required" />
        </div>
        <div className="mt-2 text-[10px] text-slate-400">마지막 확인: {status.lastCheckedAt}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn icon={<RefreshCw className="h-3 w-3" />} label="Supabase 설정 확인" onClick={() => setStatus(getServerDbStatus())} />
          <Btn icon={<PlugZap className="h-3 w-3" />} label="연결 테스트" onClick={() => void runTest()} />
          <Btn icon={<FileCode2 className="h-3 w-3" />} label="SQL 스키마 안내 보기" onClick={() => setShowSchema((s) => !s)} />
          <Btn icon={<ShieldCheck className="h-3 w-3" />} label="RLS 정책 안내 보기" onClick={() => setShowRls((s) => !s)} />
        </div>

        {test ? (
          <div className={['mt-3 rounded-lg border px-3 py-2 text-[11px]', test.status === 'not-configured' ? 'border-slate-200 bg-slate-50 text-slate-600' : test.status === 'ready' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'].join(' ')}>
            <span className="font-semibold">{test.status}</span> · {test.message}
          </div>
        ) : null}
        {showSchema ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
            DB 스키마는 <span className="font-mono">docs/supabase/SJ_OS_SUPABASE_SCHEMA.sql</span> 에 있습니다. Supabase SQL Editor에서 실행하세요. (profiles / teams / attendance_records / customers / consultations / schedule_events / performance_records / notices)
          </div>
        ) : null}
        {showRls ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
            RLS 정책은 <span className="font-mono">docs/supabase/SJ_OS_SUPABASE_RLS_POLICIES.sql</span> 에 있습니다. 모든 업무 테이블에 RLS를 활성화하고, 대표/관리자=전체, 팀장=팀, FC=본인 데이터 규칙을 적용합니다. 운영 적용 전 반드시 검토하세요.
          </div>
        ) : null}
      </div>

      {/* Commercial readiness checklist */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-indigo-500" />
          <h2 className="text-base font-bold text-slate-800">상용화 준비 체크리스트</h2>
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {readiness.map((it) => (
            <div key={it.label} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-1.5 text-xs">
              <span className="flex items-center gap-1.5 text-slate-700">
                {it.status === '완료' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Circle className="h-3.5 w-3.5 text-slate-300" />}
                {it.label}
              </span>
              <span className={['shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', readinessTone(it.status)].join(' ')}>{it.status}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[10px] text-slate-400">상용 MVP 로컬 데이터 · 실제 Supabase 연결은 대표님이 프로젝트 생성 후 진행합니다.</p>
      </div>
    </div>
  )
}

function Field({ label, value, danger }: { label: string; value: string; danger?: boolean }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className={['truncate font-mono text-[11px] font-semibold', danger ? 'text-rose-500' : 'text-slate-700'].join(' ')}>{value}</div>
    </div>
  )
}
function readinessTone(s: ReadinessStatus): string {
  if (s === '완료') return 'border-emerald-200 bg-emerald-50 text-emerald-600'
  if (s === '준비됨') return 'border-indigo-200 bg-indigo-50 text-indigo-600'
  if (s === '로컬 MVP') return 'border-blue-200 bg-blue-50 text-blue-600'
  if (s === '미설정') return 'border-amber-200 bg-amber-50 text-amber-600'
  if (s === '수동 작업 필요') return 'border-orange-200 bg-orange-50 text-orange-600'
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
