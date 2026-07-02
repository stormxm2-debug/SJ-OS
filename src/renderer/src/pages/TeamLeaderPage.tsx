import { type ReactNode } from 'react'
import {
  UsersRound,
  UserCheck,
  Clock,
  UserX,
  MapPin,
  Activity,
  Wallet,
  Target,
  Phone,
  MessageSquare,
  AlertOctagon,
  ListTodo,
  Download,
  RotateCcw,
  Plus,
  CheckCircle2,
  Circle
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { useTeamLeader } from '@renderer/services/team-leader/useTeamLeader'
import { teamLeaderRepository } from '@renderer/services/team-leader/TeamLeaderRepository'
import type {
  Blocker,
  BlockerSeverity,
  BlockerStatus,
  TeamMemberRow
} from '@renderer/services/team-leader/types'

const ATTENDANCE_LABEL: Record<string, string> = {
  'not-checked-in': '미출근',
  'checked-in': '출근',
  late: '지각',
  outside: '외근',
  absent: '결근',
  'checked-out': '퇴근'
}

const ATTENDANCE_TONE: Record<string, string> = {
  'not-checked-in': 'border-slate-600/40 bg-slate-600/10 text-slate-400',
  'checked-in': 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  late: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  outside: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  absent: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  'checked-out': 'border-slate-500/30 bg-slate-500/10 text-slate-400'
}

const SEVERITY_TONE: Record<BlockerSeverity, string> = {
  low: 'border-slate-600/40 bg-slate-600/10 text-slate-300',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  high: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const STATUS_LABEL: Record<BlockerStatus, string> = {
  open: '미해결',
  'in-progress': '처리중',
  resolved: '해결'
}

const NEXT_STATUS: Record<BlockerStatus, BlockerStatus> = {
  open: 'in-progress',
  'in-progress': 'resolved',
  resolved: 'open'
}

function won(value: number): string {
  return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만`
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ko-KR')
}

function exportReport(): void {
  const json = teamLeaderRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'team-leader-report.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Team Leader Workspace — the leadership cockpit of SJ Invest. The team roster,
 * attendance, activity and performance are derived live from the FC OS roster
 * via teamLeaderRepository; customer follow-ups come from the Schedule
 * Workspace; coaching notes, blockers and next actions are the leader-owned data
 * in the persisted snapshot (useTeamLeader). All mutations delegate to the
 * repository.
 */
export default function TeamLeaderPage(): JSX.Element {
  useTeamLeader()
  const teams = teamLeaderRepository.listTeams()
  const team = teamLeaderRepository.getSelectedTeam()
  const view = team ? teamLeaderRepository.getTeamView(team) : null

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('팀장 워크스페이스 데모 데이터를 초기화할까요?')) return
    teamLeaderRepository.resetDemoState()
  }

  if (!team || !view) {
    return (
      <Card title="Team Leader Workspace" icon={<UsersRound className="h-4 w-4" />}>
        <p className="text-sm text-slate-500">표시할 팀 데이터가 없습니다.</p>
      </Card>
    )
  }

  const followUps = teamLeaderRepository.getTeamFollowUps(team)
  const notes = teamLeaderRepository.getCoachingNotes(team)
  const blockers = teamLeaderRepository.getBlockers(team)
  const actions = teamLeaderRepository.getNextActions(team)

  const promptNote = (): void => {
    const text = window.prompt(`${team} 코칭 노트`)
    if (text) teamLeaderRepository.addCoachingNote(team, text)
  }
  const promptBlocker = (): void => {
    const title = window.prompt(`${team} 블로커 제목`)
    if (title) teamLeaderRepository.addBlocker(team, title)
  }
  const promptAction = (): void => {
    const label = window.prompt(`${team} 다음 액션`)
    if (label) teamLeaderRepository.addNextAction(team, label)
  }

  return (
    <div className="space-y-5">
      {/* Header + team selector + summary */}
      <Card
        title="Team Leader Workspace — 팀 리더 현황"
        icon={<UsersRound className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
              Export report
            </ActionButton>
            <ActionButton icon={<RotateCcw className="h-4 w-4" />} variant="danger" onClick={handleReset}>
              Reset demo state
            </ActionButton>
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {teams.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => teamLeaderRepository.selectTeam(t)}
              className={[
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition',
                t === team
                  ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200'
                  : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:bg-slate-700/50'
              ].join(' ')}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mb-3 text-sm text-slate-400">
          팀장 <span className="font-medium text-slate-200">{view.leaderName}</span> · FC {view.fcCount}명
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric icon={<UserCheck className="h-4 w-4" />} label="출근" value={`${view.attendance.checkedIn}명`} tone="text-emerald-300" />
          <Metric icon={<Clock className="h-4 w-4" />} label="지각" value={`${view.attendance.late}명`} tone="text-amber-300" />
          <Metric icon={<MapPin className="h-4 w-4" />} label="외근" value={`${view.attendance.outside}명`} tone="text-sky-300" />
          <Metric icon={<UserX className="h-4 w-4" />} label="결근" value={`${view.attendance.absent}명`} tone="text-rose-300" />
          <Metric icon={<Activity className="h-4 w-4" />} label="오늘 활동" value={`${view.todayActivityTotal}건`} />
          <Metric icon={<Wallet className="h-4 w-4" />} label="이번달 보험료" value={`${won(view.monthlyPremium)}원`} tone="text-emerald-300" />
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>목표 {won(view.targetPremium)}원 · 계약 {view.contractTotal}건 · 오늘 활동 미기록 {view.inactiveCount}명</span>
            <span className="text-emerald-300">{view.achievementRate}%</span>
          </div>
          <div className="mt-1">
            <ProgressBar value={Math.min(view.achievementRate, 100)} />
          </div>
        </div>
      </Card>

      {/* Assigned FCs */}
      <Card title="배정 FC 현황" icon={<UsersRound className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{view.members.length}명</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                <th className="py-2 pr-3 font-medium">FC</th>
                <th className="py-2 pr-3 font-medium">직급</th>
                <th className="py-2 pr-3 font-medium">출근</th>
                <th className="py-2 pr-3 font-medium">오늘 활동</th>
                <th className="py-2 pr-3 font-medium">보험료</th>
                <th className="py-2 pr-3 font-medium">달성률</th>
              </tr>
            </thead>
            <tbody>
              {view.members.map((m) => (
                <MemberRow key={m.fcId} member={m} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Customer follow-ups + coaching notes */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="고객 후속 (팀)" icon={<Phone className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{followUps.length}건</span>}>
          {followUps.length === 0 ? (
            <p className="text-sm text-slate-500">예정된 고객 후속 일정이 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {followUps.map((f) => (
                <li key={f.scheduleId} className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-200">{f.title}</div>
                    <div className="text-[11px] text-slate-500">{f.fcName} · {f.customerName ?? '—'}</div>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-500">{formatDateTime(f.startAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="코칭 노트"
          icon={<MessageSquare className="h-4 w-4" />}
          action={<ActionButton icon={<Plus className="h-4 w-4" />} onClick={promptNote}>노트</ActionButton>}
        >
          {notes.length === 0 ? (
            <p className="text-sm text-slate-500">코칭 노트가 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>{n.fcName ?? '팀 전체'} · {n.author}</span>
                    <span>{formatDateTime(n.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-200">{n.text}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Blockers + next actions */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="블로커"
          icon={<AlertOctagon className="h-4 w-4" />}
          action={<ActionButton icon={<Plus className="h-4 w-4" />} onClick={promptBlocker}>블로커</ActionButton>}
        >
          {blockers.length === 0 ? (
            <p className="text-sm text-slate-500">등록된 블로커가 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {blockers.map((b) => (
                <BlockerRow key={b.id} blocker={b} />
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="다음 액션"
          icon={<ListTodo className="h-4 w-4" />}
          action={<ActionButton icon={<Plus className="h-4 w-4" />} onClick={promptAction}>액션</ActionButton>}
        >
          {actions.length === 0 ? (
            <p className="text-sm text-slate-500">예정된 다음 액션이 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {actions.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => teamLeaderRepository.toggleNextAction(a.id)}
                    className="flex w-full items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-left transition hover:bg-slate-800/60"
                  >
                    {a.done ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={['text-sm', a.done ? 'text-slate-500 line-through' : 'text-slate-200'].join(' ')}>{a.label}</div>
                      <div className="text-[11px] text-slate-500">{a.fcName ?? '팀 전체'}{a.due ? ` · ${formatDateTime(a.due)}` : ''}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

// --- member row -------------------------------------------------------------

function MemberRow({ member }: { member: TeamMemberRow }): JSX.Element {
  return (
    <tr className="border-b border-slate-800/60">
      <td className="py-2 pr-3">
        <span className="text-slate-100">{member.name}</span>
        {member.role === 'Team Leader' ? <span className="ml-1.5 text-[10px] text-indigo-300">팀장</span> : null}
      </td>
      <td className="py-2 pr-3 text-slate-400">{member.rank}</td>
      <td className="py-2 pr-3">
        <span className={['rounded-full border px-1.5 py-0.5 text-[10px]', ATTENDANCE_TONE[member.attendanceStatus] ?? ATTENDANCE_TONE['not-checked-in']].join(' ')}>
          {ATTENDANCE_LABEL[member.attendanceStatus] ?? member.attendanceStatus}
        </span>
      </td>
      <td className="py-2 pr-3">
        <span className={member.todayActivityCount === 0 ? 'text-rose-300' : 'text-slate-300'}>{member.todayActivityCount}건</span>
      </td>
      <td className="py-2 pr-3 text-emerald-300">{won(member.monthlyPremium)}원</td>
      <td className="py-2 pr-3">
        <span className={member.achievementRate >= 100 ? 'text-emerald-300' : 'text-slate-300'}>{member.achievementRate}%</span>
      </td>
    </tr>
  )
}

// --- blocker row ------------------------------------------------------------

function BlockerRow({ blocker }: { blocker: Blocker }): JSX.Element {
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={['rounded-full border px-1.5 py-0.5 text-[10px]', SEVERITY_TONE[blocker.severity]].join(' ')}>{blocker.severity}</span>
            <span className="truncate text-sm text-slate-100">{blocker.title}</span>
          </div>
          {blocker.detail ? <p className="mt-1 text-[11px] text-slate-500">{blocker.detail}</p> : null}
          <div className="mt-1 text-[11px] text-slate-500">{blocker.fcName ?? '팀 전체'}</div>
        </div>
        <button
          type="button"
          onClick={() => teamLeaderRepository.setBlockerStatus(blocker.id, NEXT_STATUS[blocker.status])}
          className={[
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium transition hover:opacity-80',
            blocker.status === 'resolved'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : blocker.status === 'in-progress'
                ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          ].join(' ')}
          title="클릭하여 상태 변경"
        >
          {STATUS_LABEL[blocker.status]}
        </button>
      </div>
    </li>
  )
}

// --- presentational helpers -------------------------------------------------

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
      className={['inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition', BUTTON_VARIANTS[variant]].join(' ')}
    >
      {icon}
      {children}
    </button>
  )
}
