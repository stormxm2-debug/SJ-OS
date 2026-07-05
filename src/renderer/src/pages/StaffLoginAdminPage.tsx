import { useEffect, useState } from 'react'
import { UserCog, Plus, RefreshCw, Ban, CheckCircle2, KeyRound, ShieldOff, Database, HardDrive, Loader2 } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import type { StaffRole } from '@shared/commercial/models'
import type { PasswordResetRequest, StaffLoginAccount } from '@shared/commercial/phoneLogin'
import { maskKoreanPhoneDisplay } from '@shared/phone'
import { PASSWORD_STATUS_LABEL, STAFF_LOGIN_STATUS_LABEL } from '@shared/commercial/phoneLogin'
import { ROLE_LABEL } from '@renderer/navigation/roleAccess'
import { isClaimFunctionConfigured } from '@renderer/services/commercial/phoneAuthService'
import {
  approvePasswordResetRequest,
  blockStaffLoginAccount,
  createStaffLoginAccount,
  deactivateStaffLoginAccount,
  listPasswordResetRequests,
  listStaffLoginAccounts,
  updateStaffLoginStatus,
  type StaffAdminDataMode
} from '@renderer/services/commercial/staffLoginAccountService'

/**
 * 직원 로그인 관리 (owner/admin only; Router-guarded + hidden on mobile). Registers
 * allowed staff phone numbers into public.staff_login_accounts (Supabase when
 * configured, else local-mock). It NEVER creates Supabase Auth users and NEVER sets
 * passwords — that is the claim-phone-account Edge Function. Phones are masked;
 * nothing is logged.
 */
export default function StaffLoginAdminPage(): JSX.Element {
  const { session } = useSession()
  const [accounts, setAccounts] = useState<StaffLoginAccount[]>([])
  const [resets, setResets] = useState<PasswordResetRequest[]>([])
  const [mode, setMode] = useState<StaffAdminDataMode>('local-mock')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<StaffRole>('fc')
  const [team, setTeam] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    const [a, r] = await Promise.all([listStaffLoginAccounts(), listPasswordResetRequests()])
    setMode(a.mode)
    setAccounts(a.accounts)
    setResets(r.requests)
    setError(a.ok ? undefined : a.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // owner-only guard for creating another owner (admin cannot casually create owner).
  const roleOptions: StaffRole[] = session.role === 'owner' ? ['owner', 'admin', 'team-leader', 'fc'] : ['admin', 'team-leader', 'fc']

  const add = async (): Promise<void> => {
    setBusy(true)
    const res = await createStaffLoginAccount({ name, phone, role, teamName: team })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    setError(undefined); setName(''); setPhone(''); setTeam(''); void load()
  }
  const setStatus = async (id: string, fn: (id: string) => Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    const res = await fn(id)
    if (!res.ok) { setError(res.error); return }
    void load()
  }
  const approve = async (id: string): Promise<void> => {
    const res = await approvePasswordResetRequest(id, session.id)
    if (!res.ok) { setError(res.error); return }
    void load()
  }

  const pending = resets.filter((r) => r.status === 'pending')

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <UserCog className="h-6 w-6 text-indigo-500" />
        <h1 className="text-xl font-bold text-slate-800">직원 로그인 관리</h1>
        <ModeBadge mode={mode} />
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">관리자 전용</span>
      </div>
      <p className="text-xs text-slate-500">등록된 휴대폰 번호만 SJ OS에 접속할 수 있습니다. 여기서는 허용 번호만 등록하며, 실제 계정 생성/비밀번호 설정은 서버 함수(claim-phone-account)에서 처리됩니다. (service_role은 서버에만 저장)</p>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600">{error}</div> : null}

      {/* Server function status */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-slate-700">서버 함수 상태</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <FnStatus name="claim-phone-account" ready={isClaimFunctionConfigured()} />
          <FnStatus name="request-phone-password-reset" ready={isClaimFunctionConfigured()} />
        </div>
        <p className="mt-2 text-[10px] text-slate-400">배포 가이드: docs/supabase/SUPABASE_EDGE_FUNCTION_DEPLOYMENT_GUIDE.md · 프론트엔드는 anon key만 사용, service_role은 서버(Edge Function)에만 저장.</p>
      </div>

      {/* Add staff */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-slate-700">직원 번호 등록</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="직원명" maxLength={50} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="휴대폰 번호" className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
          <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="팀 (선택)" className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
        </div>
        <button type="button" onClick={() => void add()} disabled={busy} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} 직원 등록
        </button>
      </div>

      {/* Reset requests */}
      {pending.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800"><KeyRound className="h-4 w-4" /> 비밀번호 재설정 요청 ({pending.length})</div>
          <div className="space-y-1">
            {pending.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs">
                <span className="text-slate-600">{maskKoreanPhoneDisplay(r.normalizedPhone)} · {r.requestedAt ? new Date(r.requestedAt).toLocaleString() : ''}</span>
                <button type="button" onClick={() => void approve(r.id)} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white"><CheckCircle2 className="h-3 w-3" /> 승인</button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-amber-700">승인은 요청 상태만 변경합니다. 실제 비밀번호 재설정 적용은 서버 함수 연결 후 가능합니다.</p>
        </div>
      ) : null}

      {/* Staff list */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-700">등록된 직원 ({accounts.length})</div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"><RefreshCw className="h-3 w-3" /> 새로고침</button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…</div>
        ) : accounts.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">등록된 직원이 없습니다. 직원 번호를 등록해주세요.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-slate-400"><tr className="border-b border-slate-100">
                <th className="py-1.5 pr-2 font-medium">직원명</th>
                <th className="py-1.5 pr-2 font-medium">휴대폰</th>
                <th className="py-1.5 pr-2 font-medium">역할</th>
                <th className="py-1.5 pr-2 font-medium">팀</th>
                <th className="py-1.5 pr-2 font-medium">상태</th>
                <th className="py-1.5 pr-2 font-medium">비밀번호</th>
                <th className="py-1.5 pr-2 font-medium">프로필</th>
                <th className="py-1.5 pr-2 font-medium">관리</th>
              </tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b border-slate-50">
                    <td className="py-1.5 pr-2 font-medium text-slate-700">{a.name}</td>
                    <td className="py-1.5 pr-2 font-mono text-slate-500">{maskKoreanPhoneDisplay(a.normalizedPhone)}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{ROLE_LABEL[a.role]}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{a.teamName ?? '-'}</td>
                    <td className="py-1.5 pr-2"><span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{STAFF_LOGIN_STATUS_LABEL[a.status]}</span></td>
                    <td className="py-1.5 pr-2 text-slate-500">{PASSWORD_STATUS_LABEL[a.passwordStatus]}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{a.profileId ? '연결됨' : '-'}</td>
                    <td className="py-1.5 pr-2">
                      <div className="flex flex-wrap gap-1">
                        {a.status !== 'inactive' ? <ActBtn icon={<Ban className="h-3 w-3" />} label="비활성화" onClick={() => void setStatus(a.id, deactivateStaffLoginAccount)} /> : <ActBtn icon={<CheckCircle2 className="h-3 w-3" />} label="활성화" tone="emerald" onClick={() => void setStatus(a.id, (id) => updateStaffLoginStatus(id, 'active'))} />}
                        {a.status !== 'blocked' ? <ActBtn icon={<ShieldOff className="h-3 w-3" />} label="차단" tone="rose" onClick={() => void setStatus(a.id, blockStaffLoginAccount)} /> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function ActBtn({ icon, label, onClick, tone }: { icon: JSX.Element; label: string; onClick: () => void; tone?: 'emerald' | 'rose' }): JSX.Element {
  const t = tone === 'emerald' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : tone === 'rose' ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
  return <button type="button" onClick={onClick} className={['inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium', t].join(' ')}>{icon}{label}</button>
}
function FnStatus({ name, ready }: { name: string; ready: boolean }): JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-xs">
      <span className="font-mono text-slate-600">{name}</span>
      <span className={['rounded-full border px-2 py-0.5 text-[10px] font-bold', ready ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-amber-200 bg-amber-50 text-amber-600'].join(' ')}>{ready ? '준비됨' : '배포 필요'}</span>
    </div>
  )
}
function ModeBadge({ mode }: { mode: StaffAdminDataMode }): JSX.Element {
  const supa = mode === 'supabase'
  return <span className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold', supa ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-blue-200 bg-blue-50 text-blue-600'].join(' ')}>{supa ? <Database className="h-3 w-3" /> : <HardDrive className="h-3 w-3" />}{supa ? 'Supabase 공용 DB' : '로컬 MVP 데이터'}</span>
}
