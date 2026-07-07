import { useEffect, useMemo, useState } from 'react'
import { Users2, Plus, RefreshCw, Loader2, Ban, ShieldOff, UserCog, Search, Database, HardDrive, Crown } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import type { StaffRole } from '@shared/commercial/models'
import type { StaffLoginStatus } from '@shared/commercial/phoneLogin'
import type { StaffManagementRecord, TeamRecord } from '@shared/commercial/teamOps'
import { PASSWORD_STATUS_LABEL, STAFF_LOGIN_STATUS_LABEL } from '@shared/commercial/phoneLogin'
import { ROLE_LABEL } from '@renderer/navigation/roleAccess'
import {
  createTeam,
  deactivateTeam,
  getOrganizationSummary,
  listStaff,
  listTeams,
  renameTeam,
  setTeamLeader,
  updateStaffRole,
  updateStaffStatus,
  updateStaffTeam,
  type OpsDataMode
} from '@renderer/services/commercial/staffOperationsService'

/**
 * 직원 / 팀 관리 (owner/admin only; Router-guarded + hidden on mobile). Manages the
 * org structure — teams, leaders, roles, team assignment, staff status — via the
 * staffOperationsService (Supabase when configured, else local-mock). Phones are
 * masked; NEVER creates Auth users / sets passwords / uses service_role / logs PII.
 */
export default function StaffTeamManagementPage(): JSX.Element {
  const { session } = useSession()
  const [staff, setStaff] = useState<StaffManagementRecord[]>([])
  const [teams, setTeams] = useState<TeamRecord[]>([])
  const [mode, setMode] = useState<OpsDataMode>('local-mock')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [newTeam, setNewTeam] = useState('')
  const [leaderConfirm, setLeaderConfirm] = useState<{ team: TeamRecord; staff: StaffManagementRecord } | null>(null)

  // filters
  const [q, setQ] = useState('')
  const [roleF, setRoleF] = useState<StaffRole | 'all'>('all')
  const [teamF, setTeamF] = useState<string>('all')
  const [statusF, setStatusF] = useState<StaffLoginStatus | 'all'>('all')

  const load = async (): Promise<void> => {
    setLoading(true)
    const [s, t] = await Promise.all([listStaff(), listTeams()])
    setMode(s.mode)
    setStaff(s.staff)
    setTeams(t.teams)
    setError(s.ok ? undefined : s.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const summary = useMemo(() => getOrganizationSummary(staff, teams), [staff, teams])
  const teamName = (id?: string): string => (id ? teams.find((t) => t.id === id)?.name ?? '-' : '-')
  const memberCount = (teamId: string): number => staff.filter((s) => s.teamId === teamId).length
  const roleOptions: StaffRole[] = session.role === 'owner' ? ['owner', 'admin', 'team-leader', 'fc'] : ['admin', 'team-leader', 'fc']

  const filtered = useMemo(
    () =>
      staff.filter((s) => {
        if (roleF !== 'all' && s.role !== roleF) return false
        if (teamF !== 'all' && s.teamId !== teamF) return false
        if (statusF !== 'all' && s.status !== statusF) return false
        if (q.trim() && !s.name.toLowerCase().includes(q.trim().toLowerCase())) return false
        return true
      }),
    [staff, q, roleF, teamF, statusF]
  )

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    const res = await fn()
    if (!res.ok) { setError(res.error); return }
    setError(undefined); void load()
  }

  const confirmLeader = async (): Promise<void> => {
    if (!leaderConfirm) return
    const { team, staff: s } = leaderConfirm
    await setTeamLeader(team.id, s)
    // FC → team-leader on assignment (never touch owner/admin).
    if (s.role === 'fc') await updateStaffRole(s, 'team-leader')
    setLeaderConfirm(null)
    void load()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Users2 className="h-6 w-6 text-indigo-500" />
        <h1 className="text-xl font-bold text-slate-100">직원 / 팀 관리</h1>
        <ModeBadge mode={mode} />
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">관리자 전용</span>
      </div>
      <p className="text-xs text-slate-500">조직 구조(팀/역할/배정/상태)를 관리합니다. 휴대폰 번호 등록은 <span className="font-semibold">직원 로그인 관리</span>에서, 실제 계정 생성/비밀번호는 서버 함수에서 처리됩니다.</p>
      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600">{error}</div> : null}

      {/* Org summary */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat label="전체 직원" value={summary.totalStaff} />
        <Stat label="활성" value={summary.activeStaff} tone="emerald" />
        <Stat label="초대됨" value={summary.invited} tone="indigo" />
        <Stat label="비번 미설정" value={summary.passwordNotSet} tone="amber" />
        <Stat label="팀 수" value={summary.teamCount} />
        <Stat label="비활성/차단" value={summary.inactiveOrBlocked} tone="rose" />
      </div>

      {/* Team management */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-300">팀 관리</div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"><RefreshCw className="h-3 w-3" /> 새로고침</button>
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <input value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="새 팀명" className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none" />
          <button type="button" onClick={() => void run(async () => { const r = await createTeam(newTeam); if (r.ok) setNewTeam(''); return r })} className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1.5 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> 팀 생성</button>
        </div>
        {teams.length === 0 ? <p className="py-2 text-center text-xs text-slate-500">등록된 팀이 없습니다.</p> : (
          <div className="space-y-1">
            {teams.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-xs">
                <span className="font-medium text-slate-300">{t.name} <span className="text-slate-400">· 팀장 {t.leaderName ?? (staff.find((s) => s.id === t.leaderId || s.profileId === t.leaderId)?.name ?? '미지정')} · 인원 {memberCount(t.id)} · {t.status === 'active' ? '활성' : '비활성'}</span></span>
                <div className="flex flex-wrap gap-1">
                  <MiniBtn label="이름 변경" onClick={() => { const n = window.prompt('새 팀명', t.name); if (n) void run(() => renameTeam(t.id, n)) }} />
                  {t.status === 'active' ? <MiniBtn label="비활성화" tone="rose" onClick={() => void run(() => deactivateTeam(t.id))} /> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 검색" className="w-28 text-[11px] focus:outline-none" />
        </div>
        <Sel value={roleF} onChange={(v) => setRoleF(v as StaffRole | 'all')} opts={[['all', '전체 역할'], ...(['owner', 'admin', 'team-leader', 'fc'] as StaffRole[]).map((r) => [r, ROLE_LABEL[r]] as [string, string])]} />
        <Sel value={teamF} onChange={setTeamF} opts={[['all', '전체 팀'], ...teams.map((t) => [t.id, t.name] as [string, string])]} />
        <Sel value={statusF} onChange={(v) => setStatusF(v as StaffLoginStatus | 'all')} opts={[['all', '전체 상태'], ...(['invited', 'active', 'inactive', 'blocked'] as StaffLoginStatus[]).map((s) => [s, STAFF_LOGIN_STATUS_LABEL[s]] as [string, string])]} />
      </div>

      {/* Staff management */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-slate-300">직원 관리 ({filtered.length})</div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">직원이 없습니다. 직원 로그인 관리에서 번호를 등록하세요.</p>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((s) => (
              <div key={s.id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2 text-[11px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-300">{s.name}</span>
                    <span className="text-slate-500"> · <span className="font-mono">{s.phoneMasked}</span> · {ROLE_LABEL[s.role]} · {teamName(s.teamId)} · {STAFF_LOGIN_STATUS_LABEL[s.status]} · 비번 {PASSWORD_STATUS_LABEL[s.passwordStatus]} · {s.profileLinked ? '프로필 연결됨' : '프로필 미연결'}</span>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <UserCog className="h-3 w-3 text-slate-400" />
                  <Sel value={s.role} onChange={(v) => void run(() => updateStaffRole(s, v as StaffRole))} opts={roleOptions.map((r) => [r, ROLE_LABEL[r]] as [string, string])} small />
                  <Sel value={s.teamId ?? ''} onChange={(v) => void run(() => updateStaffTeam(s, v || null, teams.find((t) => t.id === v)?.name))} opts={[['', '팀 없음'], ...teams.map((t) => [t.id, t.name] as [string, string])]} small />
                  {s.status !== 'active' ? <MiniBtn label="활성화" tone="emerald" onClick={() => void run(() => updateStaffStatus(s, 'active'))} /> : null}
                  {s.status !== 'inactive' ? <MiniBtn label="비활성화" onClick={() => void run(() => updateStaffStatus(s, 'inactive'))} /> : null}
                  {s.status !== 'blocked' ? <MiniBtn label="차단" tone="rose" icon={<ShieldOff className="h-3 w-3" />} onClick={() => void run(() => updateStaffStatus(s, 'blocked'))} /> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Team leader assignment */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-300"><Crown className="h-4 w-4 text-amber-500" /> 팀장 지정</div>
        <p className="mb-2 text-[11px] text-amber-600">팀장 지정 시 해당 직원의 역할이 팀장으로 변경될 수 있습니다.</p>
        <div className="flex flex-wrap gap-2">
          {teams.filter((t) => t.status === 'active').map((t) => (
            <div key={t.id} className="rounded-lg border border-slate-200 p-2">
              <div className="mb-1 text-[11px] font-semibold text-slate-300">{t.name}</div>
              <Sel value="" onChange={(v) => { const s = staff.find((x) => x.id === v); if (s) setLeaderConfirm({ team: t, staff: s }) }} opts={[['', '팀장 선택'], ...staff.filter((s) => s.role !== 'owner' && s.role !== 'admin').map((s) => [s.id, s.name] as [string, string])]} small />
            </div>
          ))}
        </div>
        {leaderConfirm ? (
          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px]">
            <p className="font-semibold text-amber-800">{leaderConfirm.team.name} 팀장을 {leaderConfirm.staff.name}(으)로 지정합니다. 역할이 팀장으로 변경될 수 있습니다. 계속하시겠습니까?</p>
            <div className="mt-1.5 flex gap-2">
              <button type="button" onClick={() => void confirmLeader()} className="rounded-md bg-amber-600 px-3 py-1 text-[11px] font-semibold text-white">지정</button>
              <button type="button" onClick={() => setLeaderConfirm(null)} className="rounded-md border border-slate-300 px-3 py-1 text-[11px] text-slate-600">취소</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'indigo' | 'amber' | 'rose' }): JSX.Element {
  const t = tone === 'emerald' ? 'text-emerald-600' : tone === 'indigo' ? 'text-indigo-600' : tone === 'amber' ? 'text-amber-600' : tone === 'rose' ? 'text-rose-600' : 'text-slate-300'
  return <div className="rounded-xl border border-slate-200 bg-white p-3 text-center"><div className={['text-lg font-bold', t].join(' ')}>{value}</div><div className="text-[10px] text-slate-500">{label}</div></div>
}
function Sel({ value, onChange, opts, small }: { value: string; onChange: (v: string) => void; opts: [string, string][]; small?: boolean }): JSX.Element {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className={['rounded-lg border border-slate-200 bg-white text-slate-300 focus:outline-none', small ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1.5 text-[11px]'].join(' ')}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
}
function MiniBtn({ label, onClick, tone, icon }: { label: string; onClick: () => void; tone?: 'emerald' | 'rose'; icon?: JSX.Element }): JSX.Element {
  const t = tone === 'emerald' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : tone === 'rose' ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
  return <button type="button" onClick={onClick} className={['inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium', t].join(' ')}>{icon ?? <Ban className="hidden" />}{label}</button>
}
function ModeBadge({ mode }: { mode: OpsDataMode }): JSX.Element {
  const supa = mode === 'supabase'
  return <span className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold', supa ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-blue-200 bg-blue-50 text-blue-600'].join(' ')}>{supa ? <Database className="h-3 w-3" /> : <HardDrive className="h-3 w-3" />}{supa ? 'Supabase 공용 DB' : '로컬 MVP 데이터'}</span>
}
