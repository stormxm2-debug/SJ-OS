import { type ReactNode } from 'react'
import {
  Building2,
  Users,
  UserCheck,
  UserX,
  CalendarDays,
  Activity,
  CircleDollarSign,
  Target,
  Trophy,
  ClipboardList,
  Download,
  RotateCcw,
  LogIn,
  LogOut,
  Clock,
  Ban,
  MapPin,
  Plus,
  ArrowRightLeft,
  AlertTriangle,
  CheckCircle2,
  Info
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { useFc } from '@renderer/services/fc/useFc'
import { fcRepository, formatKrw } from '@renderer/services/fc/FcRepository'
import { useCustomer } from '@renderer/services/customer/useCustomer'
import { customerRepository } from '@renderer/services/customer/CustomerRepository'
import type { FcCustomerSummary } from '@renderer/services/customer/types'
import { useSalesActivity } from '@renderer/services/sales-activity/useSalesActivity'
import { salesActivityRepository } from '@renderer/services/sales-activity/SalesActivityRepository'
import type { FcActivityRank } from '@renderer/services/sales-activity/types'
import type {
  FcAttendanceStatus,
  FcMember,
  FcPriorityAction,
  FcStatus,
  TeamSummary
} from '@renderer/services/fc/types'

// --- label + tone maps -----------------------------------------------------

const ATTENDANCE_LABEL: Record<FcAttendanceStatus, string> = {
  'not-checked-in': '미출근',
  'checked-in': '출근',
  late: '지각',
  outside: '외근',
  absent: '결근',
  'checked-out': '퇴근'
}

const ATTENDANCE_TONE: Record<FcAttendanceStatus, string> = {
  'not-checked-in': 'border-slate-600/40 bg-slate-600/10 text-slate-300',
  'checked-in': 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  late: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  outside: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  absent: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  'checked-out': 'border-slate-500/30 bg-slate-500/10 text-slate-300'
}

const STATUS_LABEL: Record<FcStatus, string> = {
  active: '활동',
  inactive: '비활동',
  onboarding: '온보딩',
  training: '교육',
  suspended: '정지'
}

const ACTION_TONE: Record<FcPriorityAction['tone'], { border: string; icon: ReactNode }> = {
  info: { border: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-200', icon: <Info className="h-3.5 w-3.5" /> },
  warning: { border: 'border-amber-500/20 bg-amber-500/10 text-amber-200', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  success: { border: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200', icon: <CheckCircle2 className="h-3.5 w-3.5" /> }
}

function achievementTone(value: number): string {
  if (value >= 100) return 'text-emerald-300'
  if (value >= 70) return 'text-amber-300'
  return 'text-rose-300'
}

/** Trigger a client-side download of the FC OS report as JSON. */
function exportReport(): void {
  const json = fcRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'fc-os-report.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Prompt for a KRW premium and apply it (safe, local). */
function promptPremium(member: FcMember): void {
  if (typeof window === 'undefined') return
  const raw = window.prompt(`${member.name} 이번 달 실적(원 단위) 입력`, String(member.monthlyPremium))
  if (raw === null) return
  const value = Number(raw.replace(/[^0-9]/g, ''))
  if (Number.isNaN(value)) return
  fcRepository.updateMonthlyPremium(member.fcId, value)
}

/** Prompt for a new team and reassign (safe, local). */
function promptTeam(member: FcMember): void {
  if (typeof window === 'undefined') return
  const raw = window.prompt(`${member.name} 팀 이동 — 새 팀 이름`, member.team)
  if (raw === null) return
  const next = raw.trim()
  if (!next) return
  fcRepository.assignToTeam(member.fcId, next)
}

/**
 * FC OS Home — the first view of SJ Invest as a real insurance organization.
 * Reads the FC roster (via useFc) and every rollup from fcRepository. All
 * mutations delegate to the repository; no business logic lives here.
 */
export default function FcOsPage(): JSX.Element {
  useFc() // re-render on any FC OS change
  useCustomer() // re-render when the customer pipeline changes
  const summary = fcRepository.getSummary()
  const members = fcRepository.listMembers()
  const topPerformers = fcRepository.getTopPerformers()
  const teams = fcRepository.getTeamSummaries()
  const priorityActions = fcRepository.getPriorityActions()
  const fcCustomers = customerRepository.getFcCustomerSummaries()
  useSalesActivity() // re-render when sales activity changes
  const activitySummary = salesActivityRepository.getSummary()
  const activityRanking = salesActivityRepository.getFcActivityRanking()

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('FC OS 데모 데이터를 초기값으로 리셋할까요?')) {
      return
    }
    fcRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      {/* Organization summary */}
      <Card
        title="FC OS — SJ Invest 조직 현황"
        icon={<Building2 className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
              Export FC OS report
            </ActionButton>
            <ActionButton variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={handleReset}>
              Reset demo state
            </ActionButton>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <Metric icon={<Users className="h-4 w-4" />} label="전체 FC" value={`${summary.totalFc}명`} />
            <Metric icon={<UserCheck className="h-4 w-4" />} label="출근" value={`${summary.checkedIn}명`} tone="text-emerald-300" />
            <Metric icon={<UserX className="h-4 w-4" />} label="지각/결근" value={`${summary.late}/${summary.absent}`} tone="text-rose-300" />
            <Metric icon={<CalendarDays className="h-4 w-4" />} label="오늘 일정" value={`${summary.todayScheduleTotal}건`} />
            <Metric icon={<Activity className="h-4 w-4" />} label="오늘 활동" value={`${summary.todayActivityTotal}건`} />
            <Metric icon={<CircleDollarSign className="h-4 w-4" />} label="이번 달 실적" value={formatKrw(summary.monthlyPremiumTotal)} />
            <Metric icon={<Target className="h-4 w-4" />} label="목표 달성률" value={`${summary.achievementRate}%`} tone={achievementTone(summary.achievementRate)} />
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                월 목표 {formatKrw(summary.targetPremiumTotal)} · 계약 {summary.monthlyContractTotal}건 · 미활동 FC {summary.inactiveFcCount}명
              </span>
              <span className={achievementTone(summary.achievementRate)}>{summary.achievementRate}%</span>
            </div>
            <div className="mt-1">
              <ProgressBar value={summary.achievementRate} />
            </div>
          </div>
        </div>
      </Card>

      {/* Top performers + Today priority actions */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="상위 실적 FC" icon={<Trophy className="h-4 w-4" />} className="lg:col-span-2">
          {topPerformers.length === 0 ? (
            <p className="text-sm text-slate-500">실적 데이터가 없습니다.</p>
          ) : (
            <ol className="space-y-2">
              {topPerformers.map((m, i) => (
                <li key={m.fcId} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                  <span className="w-5 shrink-0 text-center text-sm font-semibold text-slate-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-100">
                      {m.name} <span className="text-xs text-slate-500">· {m.team} · {m.rank}</span>
                    </div>
                    <div className="text-xs text-slate-500">계약 {m.monthlyContractCount}건</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium text-slate-200">{formatKrw(m.monthlyPremium)}</div>
                    <div className={['text-xs', achievementTone(m.achievementRate)].join(' ')}>{m.achievementRate}%</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="오늘의 우선 조치" icon={<ClipboardList className="h-4 w-4" />}>
          <ul className="space-y-2">
            {priorityActions.map((a) => {
              const tone = ACTION_TONE[a.tone]
              return (
                <li key={a.id} className={['flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs', tone.border].join(' ')}>
                  <span className="mt-0.5 shrink-0">{tone.icon}</span>
                  <div className="min-w-0">
                    <div className="font-medium">{a.label}</div>
                    <div className="mt-0.5 text-[11px] opacity-80">{a.detail}</div>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      {/* Team performance summary */}
      <Card title="팀별 실적" icon={<Building2 className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{teams.length} teams</span>}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <TeamCard key={team.team} team={team} />
          ))}
        </div>
      </Card>

      {/* FC customer pipeline (Customer Workspace integration) */}
      <Card
        title="FC별 고객 현황"
        icon={<Users className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{fcCustomers.length} FC</span>}
      >
        {fcCustomers.length === 0 ? (
          <p className="text-sm text-slate-500">배정된 고객이 없습니다.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fcCustomers.map((fc) => (
              <FcCustomerCard key={fc.assignedFcId} fc={fc} />
            ))}
          </div>
        )}
      </Card>

      {/* Sales activity summary (Sales Activity Workspace integration) */}
      <Card
        title="영업활동 요약"
        icon={<Activity className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">오늘 {activitySummary.today}건</span>}
      >
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric icon={<Activity className="h-4 w-4" />} label="오늘 활동" value={`${activitySummary.today}건`} tone="text-sky-300" />
          <Metric icon={<Activity className="h-4 w-4" />} label="완료" value={`${activitySummary.completed}건`} tone="text-emerald-300" />
          <Metric icon={<Activity className="h-4 w-4" />} label="연기/노쇼" value={`${activitySummary.delayed}/${activitySummary.noShow}`} tone="text-rose-300" />
          <Metric icon={<Activity className="h-4 w-4" />} label="클로징 파이프라인" value={`${activitySummary.closingPipeline}건`} tone="text-amber-300" />
        </div>
        {activityRanking.length === 0 ? (
          <p className="text-sm text-slate-500">기록된 영업활동이 없습니다.</p>
        ) : (
          <ol className="space-y-1.5">
            {activityRanking.map((r, i) => (
              <FcActivityRankRow key={r.fcId} rank={r} index={i} />
            ))}
          </ol>
        )}
      </Card>

      {/* FC attendance board (with actions) */}
      <Card
        title="FC 출근 보드"
        icon={<UserCheck className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{members.length}명</span>}
      >
        <div className="space-y-2">
          {members.map((m) => (
            <AttendanceRow key={m.fcId} member={m} />
          ))}
        </div>
      </Card>

      {/* FC activity summary */}
      <Card
        title="FC 활동 요약"
        icon={<Activity className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">미활동 {summary.inactiveFcCount}명</span>}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <ActivityCard key={m.fcId} member={m} />
          ))}
        </div>
      </Card>
    </div>
  )
}

// --- attendance row --------------------------------------------------------

function AttendanceRow({ member }: { member: FcMember }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-100">
          {member.name} <span className="text-xs text-slate-500">· {member.role} · {member.rank}</span>
        </div>
        <div className="text-xs text-slate-500">
          {member.team} · {STATUS_LABEL[member.status]} · 일정 {member.todayScheduleCount} · 활동 {member.todayActivityCount}
        </div>
      </div>
      <span className={['shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium', ATTENDANCE_TONE[member.attendanceStatus]].join(' ')}>
        {ATTENDANCE_LABEL[member.attendanceStatus]}
      </span>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <IconAction title="출근" icon={<LogIn className="h-3.5 w-3.5" />} onClick={() => fcRepository.checkIn(member.fcId)} />
        <IconAction title="지각" icon={<Clock className="h-3.5 w-3.5" />} onClick={() => fcRepository.markLate(member.fcId)} />
        <IconAction title="결근" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => fcRepository.markAbsent(member.fcId)} />
        <IconAction title="퇴근" icon={<LogOut className="h-3.5 w-3.5" />} onClick={() => fcRepository.checkOut(member.fcId)} />
      </div>
    </div>
  )
}

// --- activity card ---------------------------------------------------------

function ActivityCard({ member }: { member: FcMember }): JSX.Element {
  const inactive = member.role === 'FC' && member.todayActivityCount === 0
  return (
    <div className={['rounded-lg border bg-slate-900/40 p-3', inactive ? 'border-rose-500/30' : 'border-slate-800'].join(' ')}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-100">{member.name}</div>
          <div className="text-[11px] text-slate-500">{member.team} · {member.rank}</div>
        </div>
        {inactive ? <MapPin className="h-3.5 w-3.5 shrink-0 text-rose-400" /> : null}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-slate-400">활동 {member.todayActivityCount}건 · 일정 {member.todayScheduleCount}건</span>
        <span className={achievementTone(member.achievementRate)}>{member.achievementRate}%</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <IconAction title="활동 +1" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => fcRepository.updateActivityCount(member.fcId, member.todayActivityCount + 1)} />
        <IconAction title="실적 입력" icon={<CircleDollarSign className="h-3.5 w-3.5" />} onClick={() => promptPremium(member)} />
        <IconAction title="팀 이동" icon={<ArrowRightLeft className="h-3.5 w-3.5" />} onClick={() => promptTeam(member)} />
      </div>
    </div>
  )
}

// --- FC customer card ------------------------------------------------------

function FcCustomerCard({ fc }: { fc: FcCustomerSummary }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-slate-100">{fc.assignedFcName}</div>
        <span className="text-[11px] text-slate-500">{fc.team} · 고객 {fc.total}명</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
        <span className="text-sky-300">활동 {fc.active}</span>
        <span className="text-amber-300">후속 {fc.followUpNeeded}</span>
        <span className="text-violet-300">제안 {fc.proposalReady}</span>
        <span className="text-rose-300">휴면 {fc.dormant}</span>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">월 보험료 {formatKrw(fc.monthlyPremium)}</div>
    </div>
  )
}

// --- FC activity rank row --------------------------------------------------

function FcActivityRankRow({ rank, index }: { rank: FcActivityRank; index: number }): JSX.Element {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
      <span className="w-5 shrink-0 text-center text-sm font-semibold text-slate-500">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-100">{rank.fcName} <span className="text-xs text-slate-500">· {rank.team}</span></div>
        <div className="text-[11px] text-slate-500">오늘 {rank.today} · 완료 {rank.completed}/{rank.total} · 연기 {rank.delayed} · 노쇼 {rank.noShow}</div>
      </div>
      <span className="shrink-0 text-sm font-medium text-emerald-300">{rank.completionRate}%</span>
    </li>
  )
}

// --- team card -------------------------------------------------------------

function TeamCard({ team }: { team: TeamSummary }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-slate-100">{team.team}</div>
        <span className="text-[11px] text-slate-500">{team.memberCount}명 · 출근 {team.checkedIn}</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>{formatKrw(team.monthlyPremium)} / {formatKrw(team.targetPremium)}</span>
        <span className={achievementTone(team.achievementRate)}>{team.achievementRate}%</span>
      </div>
      <div className="mt-1">
        <ProgressBar value={team.achievementRate} />
      </div>
      <div className="mt-2 text-[11px] text-slate-500">오늘 활동 {team.activityTotal}건</div>
    </div>
  )
}

// --- presentational helpers ------------------------------------------------

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className={['mt-1 truncate text-sm font-medium', tone ?? 'text-slate-200'].join(' ')}>{value}</div>
    </div>
  )
}

function IconAction({ title, icon, onClick }: { title: string; icon: ReactNode; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] text-slate-300 transition hover:bg-slate-700/60"
    >
      {icon}
      <span className="hidden sm:inline">{title}</span>
    </button>
  )
}

type ButtonVariant = 'default' | 'primary' | 'danger'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default: 'border-slate-700 bg-slate-800/60 text-slate-200 hover:bg-slate-700/60',
  primary: 'border-indigo-500/30 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25',
  danger: 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
}

function ActionButton({
  children,
  onClick,
  icon,
  variant = 'default'
}: {
  children: ReactNode
  onClick: () => void
  icon?: ReactNode
  variant?: ButtonVariant
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition',
        BUTTON_VARIANTS[variant]
      ].join(' ')}
    >
      {icon}
      {children}
    </button>
  )
}
