import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Users,
  UserPlus,
  RefreshCw,
  Loader2,
  Copy,
  Check,
  Share2,
  AlertTriangle,
  Lock,
  KeyRound,
  Search
} from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { ROLE_LABEL } from '@renderer/navigation/roleAccess'
import type { StaffRole } from '@shared/commercial/models'
import type { StaffManagementRecord } from '@shared/commercial/teamOps'
import { PhoneSegments } from '@renderer/components/ui/SegmentedInputs'
import { shareMeetingText } from '@renderer/services/share/meetingShare'
import { listStaff, updateStaffStatus, type OpsDataMode } from '@renderer/services/commercial/staffOperationsService'
import { createStaffLoginAccount, issueStaffInviteCode } from '@renderer/services/commercial/staffLoginAccountService'

/**
 * 직원관리(간편) — owner/admin 전용(Router·roleAccess 가드).
 *
 * 1) 새 아이디 등록: 이름·연락처·역할만 입력 → 한 버튼으로 등록 + 초대코드 발급.
 *    직원은 로그인 화면에서 본인 번호 + 초대코드로 **직접 비밀번호를 설정**(claim)한다.
 * 2) 활동/비활동 스위치: updateStaffStatus 로 **profiles.status 와 로그인계정 상태를 함께**
 *    바꿔, 출퇴근 명단·로그인·직원표·현황 등 전산 전체에 즉시 반영한다.
 *
 * 보안: service_role 미사용(계정 생성은 엣지함수, 상태 변경은 owner/admin RLS 범위 내 직접 쓰기).
 * 전화번호는 목록에서 마스킹. 비밀번호는 서버/직원만 설정한다.
 */
export default function StaffManagePage(): JSX.Element {
  const { session } = useSession()
  const [staff, setStaff] = useState<StaffManagementRecord[]>([])
  const [mode, setMode] = useState<OpsDataMode>('local-mock')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const [busyId, setBusyId] = useState<string | null>(null)

  // 등록 폼
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<StaffRole>('fc')
  const [team, setTeam] = useState('')
  const [registering, setRegistering] = useState(false)
  const [invite, setInvite] = useState<{ name: string; code: string } | null>(null)

  // 목록 필터
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'fc' | 'team-leader'>('all')

  const roleOptions: StaffRole[] = session.role === 'owner' ? ['fc', 'team-leader', 'back-office', 'admin'] : ['fc', 'team-leader', 'back-office']

  const load = async (): Promise<void> => {
    setLoading(true)
    const res = await listStaff()
    setMode(res.mode)
    setStaff(res.staff)
    setError(res.ok ? undefined : res.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const register = async (): Promise<void> => {
    if (!name.trim()) { setError('이름을 입력해 주세요.'); return }
    if (phone.replace(/\D/g, '').length < 10) { setError('연락처(휴대폰)를 정확히 입력해 주세요.'); return }
    setRegistering(true)
    setError(undefined)
    setNotice(undefined)
    const created = await createStaffLoginAccount({ name: name.trim(), phone, role, teamName: team.trim() || undefined })
    if (!created.ok) { setRegistering(false); setError(created.error ?? '등록에 실패했습니다.'); return }
    let code: string | null = null
    if (mode === 'supabase') {
      const inv = await issueStaffInviteCode(phone)
      if (inv.ok && inv.code) code = inv.code
      else setNotice(`직원은 등록됐지만 초대코드를 받지 못했습니다(${inv.error ?? '오류'}). 목록에서 [초대코드]로 다시 발급해 주세요.`)
    }
    setRegistering(false)
    setInvite(code ? { name: name.trim(), code } : null)
    setName(''); setPhone(''); setTeam('')
    void load()
  }

  const toggleActive = async (s: StaffManagementRecord): Promise<void> => {
    setBusyId(s.id)
    setError(undefined)
    const next = s.status === 'active' ? 'inactive' : 'active'
    const res = await updateStaffStatus(s, next)
    setBusyId(null)
    if (!res.ok) { setError(res.error ?? '상태 변경에 실패했습니다.'); return }
    setNotice(`${s.name}님을 ${next === 'active' ? '활동' : '비활동'}으로 변경했습니다. (전산 전체 반영)`)
    void load()
  }

  const filtered = useMemo(() => {
    const kw = q.trim()
    return staff.filter((s) => {
      if (roleFilter !== 'all' && s.role !== roleFilter) return false
      if (kw && !s.name.includes(kw) && !s.phoneMasked.includes(kw)) return false
      return true
    })
  }, [staff, q, roleFilter])

  const activeCount = staff.filter((s) => s.status === 'active').length

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#0e1e3a] text-white"><Users className="h-4 w-4" /></span>
          <div>
            <h1 className="text-[15px] font-bold text-slate-100">직원관리</h1>
            <p className="text-[11px] text-slate-500">활동/비활동 전환은 전산 전체(출퇴근·로그인·현황)에 바로 반영됩니다.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#475569] transition hover:bg-[#f8fafc]"
        >
          <RefreshCw className="h-3 w-3" /> 새로고침
        </button>
      </div>

      {mode === 'no-session' ? <Banner tone="amber">로그인 후 서버 직원 데이터를 사용할 수 있습니다.</Banner> : null}
      {mode === 'not-configured' ? <Banner tone="amber">서버가 연결되지 않아 임시(로컬) 데이터로 표시됩니다.</Banner> : null}
      {error ? <Banner tone="rose">{error}</Banner> : null}
      {notice ? <Banner tone="emerald">{notice}</Banner> : null}

      {/* 1) 새 아이디 등록 */}
      <section className="rounded-2xl border border-[#e6eaf2] bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-indigo-600" />
          <h2 className="text-[13px] font-bold text-slate-100">새 직원 아이디 등록</h2>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-[#334155]">이름</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="직원 이름"
              className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 text-[13px] text-[#0f172a] placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-[#334155]">연락처(휴대폰)</span>
            <PhoneSegments value={phone} onChange={setPhone} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-[#334155]">역할</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
              className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 text-[13px] font-semibold text-[#0f172a] focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-[#334155]">팀(선택)</span>
            <input
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="예: 1팀 (선택)"
              className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 text-[13px] text-[#0f172a] placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => void register()}
          disabled={registering}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 px-4 py-3 text-[14px] font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60 sm:w-auto"
        >
          {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          등록하고 초대코드 발급
        </button>
        <p className="mt-2 text-[11px] text-slate-500">
          직원은 로그인 화면에서 <b>본인 휴대폰 번호 + 초대코드</b>로 비밀번호를 직접 설정합니다. (비밀번호는 관리자가 보지 않습니다.)
        </p>

        {invite ? <InviteBox name={invite.name} code={invite.code} onClose={() => setInvite(null)} /> : null}
      </section>

      {/* 2) 직원 목록 + 활동/비활동 */}
      <section className="rounded-2xl border border-[#e6eaf2] bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-bold text-slate-100">직원 목록 <span className="text-slate-400">· 활동 {activeCount}/{staff.length}</span></h2>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이름·연락처 검색"
              className="w-44 rounded-lg border border-[#e2e8f0] bg-white py-1.5 pl-8 pr-2 text-[12px] text-[#0f172a] placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {([['all', '전체'], ['fc', 'FC'], ['team-leader', '팀장']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setRoleFilter(key)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${roleFilter === key ? 'border-[#c6982f] bg-[#fdf7ea] text-[#8a6a1f]' : 'border-[#e2e8f0] bg-white text-[#475569]'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e2e8f0] py-8 text-center text-[12px] text-slate-500">표시할 직원이 없습니다.</div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((s) => {
              const joined = s.profileLinked
              const isActive = s.status === 'active'
              const isAdminRole = s.role === 'owner' || s.role === 'admin'
              return (
                <li key={s.id} className="flex items-center gap-2 rounded-xl border border-[#eef1f6] bg-white p-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#eef2f7] text-[12px] font-bold text-[#334155]">
                    {s.name.slice(0, 1) || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-bold text-slate-100">{s.name}</span>
                      <span className="rounded-full bg-[#eef2f7] px-1.5 py-0.5 text-[10px] font-bold text-[#334155]">{ROLE_LABEL[s.role]}</span>
                      {joined ? (
                        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">가입완료</span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">초대 대기</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{s.phoneMasked}</div>
                  </div>

                  {joined ? (
                    isAdminRole ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-400 ring-1 ring-[#e2e8f0]">
                        <Lock className="h-3 w-3" /> 관리자
                      </span>
                    ) : (
                      <StatusToggle active={isActive} busy={busyId === s.id} onToggle={() => void toggleActive(s)} />
                    )
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                      <KeyRound className="h-3 w-3" /> 코드 입력 전
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function StatusToggle({ active, busy, onToggle }: { active: boolean; busy: boolean; onToggle: () => void }): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className={`text-[11px] font-bold ${active ? 'text-emerald-600' : 'text-slate-400'}`}>{active ? '활동' : '비활동'}</span>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label="활동/비활동 전환"
        onClick={onToggle}
        disabled={busy}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-60 ${active ? 'bg-emerald-500' : 'bg-slate-300'}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${active ? 'translate-x-5' : 'translate-x-0.5'}`}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin p-1 text-slate-400" /> : null}
        </span>
      </button>
    </div>
  )
}

function InviteBox({ name, code, onClose }: { name: string; code: string; onClose: () => void }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const guide = [
    `[SJ INVEST] ${name}님, 합류를 환영합니다!`,
    '',
    `1) 폰 브라우저로 접속: ${typeof window !== 'undefined' ? window.location.origin : ''}`,
    '2) 로그인 화면에서 "비밀번호 설정 / 처음 오셨나요"',
    '3) 본인 휴대폰 번호 + 아래 초대코드 입력 후, 새 비밀번호를 설정하세요',
    `   초대코드: ${code}`,
    '',
    '※ 초대코드는 1회용입니다. 받으시면 바로 설정해 주세요.'
  ].join('\n')
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard 불가 시 무시 */
    }
  }
  return (
    <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold text-indigo-700">{name}님 초대코드가 발급되었습니다</div>
        <button type="button" onClick={onClose} className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-slate-400 hover:text-slate-600">닫기</button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-white px-3 py-1.5 text-[22px] font-extrabold tracking-[0.2em] text-indigo-700 ring-1 ring-indigo-200">{code}</span>
        <button type="button" onClick={() => void copy()} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-indigo-600">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? '복사됨' : '복사'}
        </button>
        <button type="button" onClick={() => void shareMeetingText(guide)} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-[#FEE500] px-2.5 py-1.5 text-[11px] font-bold text-[#3c1e1e]">
          <Share2 className="h-3.5 w-3.5" /> 안내 보내기
        </button>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-indigo-700/70">
        직원이 <b>본인 번호 + 이 코드</b>로 비밀번호를 직접 설정하면 바로 로그인됩니다. 코드는 1회용입니다.
      </p>
    </div>
  )
}

function Banner({ tone, children }: { tone: 'amber' | 'rose' | 'emerald'; children: ReactNode }): JSX.Element {
  const c =
    tone === 'rose'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : tone === 'emerald'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-amber-200 bg-amber-50 text-amber-800'
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[12px] font-medium ${c}`}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}
