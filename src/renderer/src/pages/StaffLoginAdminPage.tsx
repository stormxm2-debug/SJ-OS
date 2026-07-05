import { useState } from 'react'
import { UserCog, Plus, RefreshCw, Ban, CheckCircle2, KeyRound } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import type { StaffRole } from '@shared/commercial/models'
import { maskPhone } from '@shared/phone'
import { PASSWORD_STATUS_LABEL, STAFF_LOGIN_STATUS_LABEL } from '@shared/commercial/phoneLogin'
import { ROLE_LABEL } from '@renderer/navigation/roleAccess'
import {
  addStaffLoginAccount,
  approveResetRequest,
  setAccountStatus,
  useStaffLoginAccounts
} from '@renderer/services/commercial/phoneLoginStore'
import { isClaimFunctionConfigured } from '@renderer/services/commercial/phoneAuthService'

/**
 * 직원 로그인 관리 (owner/admin only; guarded by the Router + hidden on mobile).
 * Owner/admin register allowed staff phone numbers (the entry gate) and approve
 * password-reset requests. Real Supabase account creation/password set happens
 * server-side (Edge Function) — this page manages the local/draft registry that
 * mirrors the `staff_login_accounts` table. Phone numbers are masked in the list.
 */
function FnStatus({ name, ready }: { name: string; ready: boolean }): JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-xs">
      <span className="font-mono text-slate-600">{name}</span>
      <span className={['rounded-full border px-2 py-0.5 text-[10px] font-bold', ready ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-amber-200 bg-amber-50 text-amber-600'].join(' ')}>
        {ready ? '준비됨' : '배포 필요'}
      </span>
    </div>
  )
}

export default function StaffLoginAdminPage(): JSX.Element {
  const { session } = useSession()
  const { accounts, resets } = useStaffLoginAccounts()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<StaffRole>('fc')
  const [team, setTeam] = useState('')
  const [error, setError] = useState<string | undefined>()

  const add = (): void => {
    const res = addStaffLoginAccount({ name, phone, role, teamName: team, createdBy: session.id })
    if (!res.ok) { setError(res.error); return }
    setError(undefined); setName(''); setPhone(''); setTeam('')
  }

  const pending = resets.filter((r) => r.status === 'pending')

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <UserCog className="h-6 w-6 text-indigo-500" />
        <h1 className="text-xl font-bold text-slate-800">직원 로그인 관리</h1>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">관리자 전용</span>
      </div>
      <p className="text-xs text-slate-500">등록된 휴대폰 번호만 SJ OS에 접속할 수 있습니다. 실제 비밀번호 설정/재설정은 서버 함수(Edge Function)에서 처리됩니다. (service_role은 서버에만 저장)</p>

      {/* Server function status */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-slate-700">서버 함수 상태</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <FnStatus name="claim-phone-account" ready={isClaimFunctionConfigured()} />
          <FnStatus name="request-phone-password-reset" ready={isClaimFunctionConfigured()} />
        </div>
        <p className="mt-2 text-[10px] text-slate-400">배포 가이드: docs/supabase/SUPABASE_EDGE_FUNCTION_DEPLOYMENT_GUIDE.md · 프론트엔드는 anon key만 사용하고 service_role은 서버(Edge Function)에만 저장합니다.</p>
      </div>

      {/* Add staff */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-slate-700">직원 번호 등록</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="휴대폰 번호" className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
          <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            {(['owner', 'admin', 'team-leader', 'fc'] as StaffRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="팀 (선택)" className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
        </div>
        {error ? <p className="mt-1.5 text-[11px] text-rose-600">{error}</p> : null}
        <button type="button" onClick={add} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> 직원 번호 등록</button>
      </div>

      {/* Reset requests */}
      {pending.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800"><KeyRound className="h-4 w-4" /> 비밀번호 재설정 요청 ({pending.length})</div>
          <div className="space-y-1">
            {pending.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs">
                <span className="text-slate-600">{maskPhone(r.normalizedPhone)} · {new Date(r.requestedAt).toLocaleString()}</span>
                <button type="button" onClick={() => approveResetRequest(r.id, session.id)} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white"><CheckCircle2 className="h-3 w-3" /> 재설정 승인</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Staff list */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-700">등록된 직원 ({accounts.length})</div>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><RefreshCw className="h-3 w-3" /> 자동 갱신</span>
        </div>
        {accounts.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">등록된 직원이 없습니다. 직원 번호를 등록해주세요.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-slate-400"><tr className="border-b border-slate-100">
                <th className="py-1.5 pr-2 font-medium">이름</th>
                <th className="py-1.5 pr-2 font-medium">휴대폰</th>
                <th className="py-1.5 pr-2 font-medium">역할</th>
                <th className="py-1.5 pr-2 font-medium">팀</th>
                <th className="py-1.5 pr-2 font-medium">상태</th>
                <th className="py-1.5 pr-2 font-medium">비밀번호</th>
                <th className="py-1.5 pr-2 font-medium">관리</th>
              </tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b border-slate-50">
                    <td className="py-1.5 pr-2 font-medium text-slate-700">{a.name}</td>
                    <td className="py-1.5 pr-2 font-mono text-slate-500">{maskPhone(a.normalizedPhone)}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{ROLE_LABEL[a.role]}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{a.teamName ?? '-'}</td>
                    <td className="py-1.5 pr-2"><span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{STAFF_LOGIN_STATUS_LABEL[a.status]}</span></td>
                    <td className="py-1.5 pr-2 text-slate-500">{PASSWORD_STATUS_LABEL[a.passwordStatus]}</td>
                    <td className="py-1.5 pr-2">
                      {a.status !== 'inactive' ? (
                        <button type="button" onClick={() => setAccountStatus(a.id, 'inactive')} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50"><Ban className="h-3 w-3" /> 비활성화</button>
                      ) : (
                        <button type="button" onClick={() => setAccountStatus(a.id, 'active')} className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">활성화</button>
                      )}
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
