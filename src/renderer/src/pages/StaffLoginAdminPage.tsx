import { useEffect, useState, type ReactNode } from 'react'
import { UserCog, Plus, RefreshCw, Ban, CheckCircle2, KeyRound, ShieldOff, Database, HardDrive, Loader2, Share2 } from 'lucide-react'
import { PhoneSegments } from '@renderer/components/ui/SegmentedInputs'
import { shareMeetingText } from '@renderer/services/share/meetingShare'
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
  createStaffAccountWithPassword,
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
  const [initPw, setInitPw] = useState('')
  const [busy, setBusy] = useState(false)

  // 등록 직후: 새 직원에게 보낼 입장 안내 (로그인까지 이어지는 마지막 연결 고리)
  const [lastAdded, setLastAdded] = useState<string | null>(null)
  const [lastInitPw, setLastInitPw] = useState<string | null>(null)
  const [shareNote, setShareNote] = useState<string | null>(null)

  // 초기 비밀번호 방식은 관리자 전용 + 대표(owner) 계정 생성은 항상 초대 방식.
  const canUseInitPw = (session.role === 'owner' || session.role === 'admin') && role !== 'owner'

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
  // 총무비서는 staff-login을 열 수 있어도 '계정 추가만' 원칙 — FC만 등록 가능(승격 불가).
  // (서버 RLS도 등급 변경을 관리자 전용으로 막으므로 이는 UI 방어선이다.)
  const roleOptions: StaffRole[] =
    session.role === 'owner'
      ? ['owner', 'admin', 'team-leader', 'fc', 'back-office']
      : session.role === 'back-office'
        ? ['fc']
        : ['admin', 'team-leader', 'fc', 'back-office']

  /** 초기 비밀번호 자동 생성 — 영문+숫자 8자, 헷갈리는 글자(l/1/O/0) 제외. */
  const genInitPw = (): void => {
    const letters = 'abcdefghjkmnpqrstuvwxyz'
    const digits = '23456789'
    const all = letters + digits
    const rnd = new Uint8Array(8)
    crypto.getRandomValues(rnd)
    const body = Array.from(rnd, (b) => all[b % all.length]).join('')
    // 영문·숫자 최소 1자 보장: 첫 글자=영문, 마지막=숫자로 고정 치환
    setInitPw(letters[rnd[0] % letters.length] + body.slice(1, 7) + digits[rnd[7] % digits.length])
  }

  const add = async (): Promise<void> => {
    setBusy(true)
    const usePw = canUseInitPw && initPw.trim().length > 0 && mode === 'supabase'
    const res = usePw
      ? await createStaffAccountWithPassword({ name, phone, role, password: initPw.trim() })
      : await createStaffLoginAccount({ name, phone, role, teamName: team })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    setError(undefined)
    setLastAdded(name.trim() || '새 직원')
    setLastInitPw(usePw ? initPw.trim() : null)
    setShareNote(null)
    setName(''); setPhone(''); setTeam(''); setInitPw(''); void load()
  }

  /** 새 직원에게 보낼 입장 안내 문구 — 초기 비밀번호 유무에 따라 두 버전. */
  const guideText = (staffName: string, pw: string | null): string =>
    pw
      ? [
          `[SJ INVEST] ${staffName}님, 합류를 환영합니다!`,
          '',
          `1) 폰 브라우저로 접속: ${window.location.origin}`,
          '2) 본인 휴대폰 번호 + 아래 초기 비밀번호로 바로 로그인',
          `   초기 비밀번호: ${pw}`,
          '3) 첫 접속 때 안내가 뜨면 비밀번호를 본인 것으로 꼭 바꿔주세요',
          '',
          '※ 브라우저 메뉴에서 "홈 화면에 추가"하면 앱처럼 쓸 수 있어요'
        ].join('\n')
      : [
          `[SJ INVEST] ${staffName}님, 합류를 환영합니다!`,
          '',
          `1) 폰 브라우저로 접속: ${window.location.origin}`,
          '2) 로그인 화면에 본인 휴대폰 번호 입력',
          '3) 첫 로그인이라 비밀번호를 새로 만들면 바로 입장됩니다',
          '',
          '※ 브라우저 메뉴에서 "홈 화면에 추가"하면 앱처럼 쓸 수 있어요'
        ].join('\n')

  const sendGuide = async (): Promise<void> => {
    if (!lastAdded) return
    const outcome = await shareMeetingText(guideText(lastAdded, lastInitPw))
    setShareNote(outcome === 'copied' ? '안내문이 복사됐어요 — 카톡에 붙여넣어 보내세요.' : null)
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
        <h1 className="text-xl font-bold text-slate-100">직원 로그인 관리</h1>
        <ModeBadge mode={mode} />
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">관리자 전용</span>
      </div>
      <p className="text-xs text-slate-500">
        등록된 휴대폰 번호만 SJ OS에 접속할 수 있습니다.
        <span className="hidden sm:inline"> 여기서는 허용 번호만 등록하며, 실제 계정 생성/비밀번호 설정은 서버 함수(claim-phone-account)에서 처리됩니다. (service_role은 서버에만 저장)</span>
      </p>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600">{error}</div> : null}

      {/* Server function status — 개발자용 정보라 모바일에서는 숨긴다(데스크톱만 표시) */}
      <div className="hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:block">
        <div className="mb-2 text-sm font-semibold text-slate-300">서버 함수 상태</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <FnStatus name="claim-phone-account" ready={isClaimFunctionConfigured()} />
          <FnStatus name="request-phone-password-reset" ready={isClaimFunctionConfigured()} />
        </div>
        <p className="mt-2 text-[10px] text-slate-400">배포 가이드: docs/supabase/SUPABASE_EDGE_FUNCTION_DEPLOYMENT_GUIDE.md · 프론트엔드는 anon key만 사용, service_role은 서버(Edge Function)에만 저장.</p>
      </div>

      {/* Add staff */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-slate-300">직원 번호 등록</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="직원명" maxLength={50} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
          <PhoneSegments value={phone} onChange={setPhone} />
          <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="팀 (선택)" className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
        </div>
        {canUseInitPw ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={initPw}
              onChange={(e) => setInitPw(e.target.value)}
              placeholder="초기 비밀번호 (입력 시 등록 즉시 로그인 가능)"
              maxLength={72}
              className="w-64 rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:outline-none"
            />
            <button
              type="button"
              onClick={genInitPw}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-2 text-[11px] font-bold text-indigo-600 hover:brightness-95"
            >
              <KeyRound className="h-3 w-3" /> 자동생성
            </button>
            <span className="text-[10px] text-slate-500">
              비워두면 기존처럼 직원이 첫 로그인 때 직접 만듭니다 · 첫 접속 시 변경 안내가 뜹니다
            </span>
          </div>
        ) : null}
        <button type="button" onClick={() => void add()} disabled={busy} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} 직원 등록
        </button>

        {/* 등록 완료 → 새 직원에게 입장 안내 보내기 (여기까지 해야 "로그인까지" 완결) */}
        {lastAdded ? (
          <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
            <div className="flex items-center gap-1.5 text-[13px] font-bold text-emerald-800">
              <CheckCircle2 className="h-4 w-4" /> {lastAdded} 님 등록 완료 — 이제 본인 폰에서 바로 로그인할 수 있습니다
            </div>
            {lastInitPw ? (
              <p className="mt-1 text-[11px] leading-5 text-emerald-700">
                초기 비밀번호: <span className="rounded bg-white px-1.5 py-0.5 font-mono font-bold">{lastInitPw}</span>
                {' '}— 번호+이 비밀번호로 즉시 로그인됩니다. 첫 접속 때 본인 비밀번호로 바꾸라는 안내가 뜹니다.
              </p>
            ) : (
              <p className="mt-1 text-[11px] leading-5 text-emerald-700">
                직원이 할 일: 앱 주소 접속 → 휴대폰 번호 입력 → 첫 로그인 비밀번호 만들기 (끝). 아래 버튼으로 안내문을 카톡으로 보내주세요.
              </p>
            )}
            <button
              type="button"
              onClick={() => void sendGuide()}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#fee500] px-3 py-2 text-xs font-bold text-[#191919] transition hover:brightness-95"
            >
              <Share2 className="h-3.5 w-3.5" /> 입장 안내 카톡 보내기
            </button>
            {shareNote ? <p className="mt-1.5 text-[11px] font-semibold text-amber-700">{shareNote}</p> : null}
          </div>
        ) : null}
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
          <div className="text-sm font-semibold text-slate-300">등록된 직원 ({accounts.length})</div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"><RefreshCw className="h-3 w-3" /> 새로고침</button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…</div>
        ) : accounts.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">등록된 직원이 없습니다. 직원 번호를 등록해주세요.</p>
        ) : (
          <>
            {/* 모바일: 카드형 (가로 스크롤·8칸 표의 뭉개짐 제거) */}
            <div className="space-y-2 sm:hidden">
              {accounts.map((a) => (
                <StaffCard
                  key={a.id}
                  a={a}
                  onDeactivate={() => void setStatus(a.id, deactivateStaffLoginAccount)}
                  onActivate={() => void setStatus(a.id, (id) => updateStaffLoginStatus(id, 'active'))}
                  onBlock={() => void setStatus(a.id, blockStaffLoginAccount)}
                />
              ))}
            </div>

            {/* 데스크톱: 기존 표 유지 */}
            <div className="hidden overflow-x-auto sm:block">
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
                      <td className="py-1.5 pr-2 font-medium text-slate-300">{a.name}</td>
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
          </>
        )}
      </div>
    </div>
  )
}

/** 모바일 직원 카드 — 8칸 표 대신 폰에서 깔끔하게 읽히는 카드 한 장. */
function StaffCard({
  a,
  onDeactivate,
  onActivate,
  onBlock
}: {
  a: StaffLoginAccount
  onDeactivate: () => void
  onActivate: () => void
  onBlock: () => void
}): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm font-bold text-slate-100">{a.name}</span>
        <span className="shrink-0 rounded-full bg-[#0e1e3a] px-2 py-0.5 text-[10px] font-bold text-[#e6c877]">{ROLE_LABEL[a.role]}</span>
      </div>
      <div className="mt-0.5 font-mono text-[12px] text-slate-500">
        {maskKoreanPhoneDisplay(a.normalizedPhone)}{a.teamName ? ` · ${a.teamName}` : ''}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Chip>{STAFF_LOGIN_STATUS_LABEL[a.status]}</Chip>
        <Chip>비번 {PASSWORD_STATUS_LABEL[a.passwordStatus]}</Chip>
        <Chip>{a.profileId ? '프로필 연결됨' : '프로필 미연결'}</Chip>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
        {a.status !== 'inactive' ? (
          <ActBtn icon={<Ban className="h-3 w-3" />} label="비활성화" onClick={onDeactivate} />
        ) : (
          <ActBtn icon={<CheckCircle2 className="h-3 w-3" />} label="활성화" tone="emerald" onClick={onActivate} />
        )}
        {a.status !== 'blocked' ? <ActBtn icon={<ShieldOff className="h-3 w-3" />} label="차단" tone="rose" onClick={onBlock} /> : null}
      </div>
    </div>
  )
}
function Chip({ children }: { children: ReactNode }): JSX.Element {
  return <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{children}</span>
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
