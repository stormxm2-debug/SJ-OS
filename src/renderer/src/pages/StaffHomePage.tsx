import { useState, type ReactNode } from 'react'
import {
  CalendarDays,
  ClipboardList,
  BarChart3,
  UserRound,
  Activity,
  FileSearch,
  Bot,
  UserPlus,
  Target,
  TrendingUp,
  Users,
  Megaphone,
  Clock,
  CheckCircle2,
  Copy,
  Check,
  Sparkles,
  ArrowRight
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { View } from '@renderer/navigation/types'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'

/**
 * Staff Home Dashboard — a bright, staff-facing overview for FCs, team leaders,
 * and office staff. UI/layout only: it uses safe local preview data, navigates
 * via the existing navigation, and opens Jarvis via the existing service. No
 * overlays, no global listeners, no timers loops, no command-engine changes.
 */

// --- safe local preview data (no backend, no external API) -----------------
const SUMMARY = [
  { key: 'schedule', label: '오늘 일정', value: '3건', icon: <CalendarDays className="h-4 w-4" />, tone: 'text-blue-600' },
  { key: 'consultation', label: '예정 상담', value: '2건', icon: <ClipboardList className="h-4 w-4" />, tone: 'text-indigo-600' },
  { key: 'activity', label: '미완료 활동', value: '5건', icon: <Activity className="h-4 w-4" />, tone: 'text-amber-600' },
  { key: 'performance', label: '이번 달 실적', value: '72%', icon: <BarChart3 className="h-4 w-4" />, tone: 'text-emerald-600' },
  { key: 'closing', label: '클로징 예정 고객', value: '4명', icon: <Target className="h-4 w-4" />, tone: 'text-rose-600' }
]

const TEAM_NOTICE = '이번 주 목표 달성률 점검 미팅 — 금요일 오후 3시. 미완료 활동 마감 부탁드립니다.'
const WEEK_FOCUS = ['신규 고객 3명 상담 완료', '보장 분석 리포트 2건 발송', '클로징 예정 고객 팔로업']
const PENDING_WORK = ['활동 입력 미완료 5건', '상담 준비 자료 2건', '증권 분석 요청 1건']
const ATTENDANCE = { total: 12, checkedIn: 9 }

interface QuickAction {
  key: string
  label: string
  icon: ReactNode
  onClick: (nav: (v: View) => void) => void
  tone: string
}

const QUICK_ACTIONS: QuickAction[] = [
  { key: 'customer', label: '고객 등록', icon: <UserPlus className="h-5 w-5" />, tone: 'from-blue-500 to-indigo-600', onClick: (n) => n({ name: 'customer' }) },
  { key: 'schedule', label: '일정 확인', icon: <CalendarDays className="h-5 w-5" />, tone: 'from-sky-500 to-blue-600', onClick: (n) => n({ name: 'schedule' }) },
  { key: 'sales-activity', label: '영업활동 입력', icon: <Activity className="h-5 w-5" />, tone: 'from-indigo-500 to-violet-600', onClick: (n) => n({ name: 'sales-activity' }) },
  { key: 'performance', label: '실적 확인', icon: <BarChart3 className="h-5 w-5" />, tone: 'from-emerald-500 to-teal-600', onClick: (n) => n({ name: 'performance' }) },
  { key: 'insurance-analysis', label: '보험분석 시작', icon: <FileSearch className="h-5 w-5" />, tone: 'from-amber-500 to-orange-600', onClick: (n) => n({ name: 'insurance-analysis' }) },
  { key: 'jarvis', label: '자비스에게 요청', icon: <Bot className="h-5 w-5" />, tone: 'from-violet-500 to-fuchsia-600', onClick: () => jarvisService.open() }
]

const JARVIS_COMMANDS = [
  '오늘 일정 알려줘',
  '이번 달 실적 보여줘',
  '미완료 활동 정리해줘',
  '클로징 예정 고객 알려줘',
  '고객 상담 준비해줘'
]

export default function StaffHomePage(): JSX.Element {
  const { navigate } = useNavigation()
  const [copied, setCopied] = useState<string | null>(null)

  // Copy an example command to the clipboard and open Jarvis. Uses only the
  // guarded Clipboard API + the existing jarvisService.open(); no engine change.
  const useCommand = (command: string): void => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard
        .writeText(command)
        .then(() => {
          setCopied(command)
          window.setTimeout(() => setCopied((c) => (c === command ? null : c)), 1500)
        })
        .catch(() => undefined)
    }
    jarvisService.open()
  }

  const remaining = Math.max(0, 100 - 72)

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="rounded-2xl border border-indigo-700/40 bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 p-6 shadow-lg shadow-indigo-500/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-3 py-1 text-xs font-semibold text-white">
              <Sparkles className="h-3.5 w-3.5" />
              직원 홈
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-white">오늘도 좋은 하루 되세요 👋</h1>
            <p className="mt-1 text-sm text-indigo-100">오늘 해야 할 업무와 고객 일정을 한눈에 확인하세요.</p>
          </div>
          <button
            type="button"
            onClick={() => jarvisService.open()}
            className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/15 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/25"
          >
            <Bot className="h-4 w-4" />
            자비스에게 요청
          </button>
        </div>
      </section>

      {/* A. Today Summary */}
      <Card title="오늘 업무 요약" icon={<Clock className="h-4 w-4 text-indigo-300" />} action={<PreviewTag />}>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {SUMMARY.map((s) => (
            <div key={s.key} className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="text-slate-400">{s.icon}</span>
                {s.label}
              </div>
              <div className={['mt-1 text-2xl font-bold', s.tone].join(' ')}>{s.value}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* B. Quick Action Cards */}
      <Card title="빠른 작업" icon={<Sparkles className="h-4 w-4 text-indigo-300" />}>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => a.onClick(navigate)}
              className="group flex flex-col items-center gap-2 rounded-xl border border-slate-800 bg-white px-3 py-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-500/30 hover:shadow-md"
            >
              <span className={['flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm', a.tone].join(' ')}>
                {a.icon}
              </span>
              <span className="text-sm font-semibold text-slate-200">{a.label}</span>
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* C. Sales Focus */}
        <Card title="이번 달 영업 집중" icon={<TrendingUp className="h-4 w-4 text-emerald-300" />} action={<PreviewTag />}>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">이번 달 목표 달성</span>
                <span className="font-bold text-emerald-600">72%</span>
              </div>
              <div className="mt-2">
                <ProgressBar value={72} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <MiniStat label="이번 달 목표" value="100%" />
              <MiniStat label="현재 달성" value="72%" tone="text-emerald-600" />
              <MiniStat label="남은 목표" value={`${remaining}%`} tone="text-amber-600" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="집중 고객" value="6명" tone="text-blue-600" />
              <MiniStat label="클로징 예정" value="4명" tone="text-rose-600" />
            </div>
          </div>
        </Card>

        {/* D. Team / FC friendly area */}
        <Card title="팀 · FC 현황" icon={<Users className="h-4 w-4 text-indigo-300" />} action={<PreviewTag />}>
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-sm text-slate-300">
              <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <div className="text-xs font-semibold text-amber-600">팀 공지</div>
                {TEAM_NOTICE}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-slate-500"><Users className="h-4 w-4" /> 오늘 출근 현황</span>
                <span className="font-bold text-slate-200">{ATTENDANCE.checkedIn}/{ATTENDANCE.total}명</span>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ListBlock title="이번 주 집중 업무" items={WEEK_FOCUS} icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />} />
              <ListBlock title="미처리 업무" items={PENDING_WORK} icon={<Clock className="h-3.5 w-3.5 text-amber-500" />} />
            </div>
          </div>
        </Card>
      </div>

      {/* E. Jarvis Quick Commands */}
      <Card title="자비스 빠른 명령" icon={<Bot className="h-4 w-4 text-indigo-300" />} action={<span className="text-xs text-slate-500">클릭하면 복사 + 자비스 열기</span>}>
        <div className="flex flex-wrap gap-2">
          {JARVIS_COMMANDS.map((cmd) => (
            <button
              key={cmd}
              type="button"
              onClick={() => useCommand(cmd)}
              className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-sm font-medium text-indigo-300 transition hover:bg-indigo-500/20"
            >
              {copied === cmd ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {cmd}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => jarvisService.open()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 transition hover:bg-indigo-500/20"
        >
          <ArrowRight className="h-3.5 w-3.5" />
          자비스 열기
        </button>
      </Card>

      <p className="pb-2 text-center text-[10px] text-slate-500">직원 홈 안전 빌드 · 미리보기 데이터</p>
    </div>
  )
}

// --- presentational helpers ------------------------------------------------

function PreviewTag(): JSX.Element {
  return <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium text-slate-500">미리보기</span>
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={['mt-0.5 text-lg font-bold', tone ?? 'text-slate-200'].join(' ')}>{value}</div>
    </div>
  )
}

function ListBlock({ title, items, icon }: { title: string; items: string[]; icon: ReactNode }): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div className="mb-1.5 text-xs font-semibold text-slate-500">{title}</div>
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it} className="flex items-start gap-1.5 text-xs text-slate-300">
            <span className="mt-0.5 shrink-0">{icon}</span>
            {it}
          </li>
        ))}
      </ul>
    </div>
  )
}
