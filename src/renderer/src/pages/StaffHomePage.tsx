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
  Check,
  Sparkles,
  ArrowRight
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { View } from '@renderer/navigation/types'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'

/**
 * Staff Home — quick-action launcher + Jarvis command shortcuts. Sits below the
 * role dashboard (StaffMvpDashboard). Demo/preview numbers were removed so the home
 * starts clean; this section is purely navigation + Jarvis prefill (no fake data,
 * no backend, no global listeners). Styling follows Direction A (bright surfaces).
 */

interface QuickAction {
  key: string
  label: string
  icon: ReactNode
  onClick: (nav: (v: View) => void) => void
  tone: string
}

const QUICK_ACTIONS: QuickAction[] = [
  { key: 'schedule', label: '오늘 일정 보기', icon: <CalendarDays className="h-5 w-5" />, tone: 'from-sky-500 to-blue-600', onClick: (n) => n({ name: 'schedule' }) },
  { key: 'customer-new', label: '고객 등록', icon: <UserPlus className="h-5 w-5" />, tone: 'from-blue-500 to-indigo-600', onClick: (n) => n({ name: 'customer' }) },
  { key: 'customer', label: '고객 관리', icon: <UserRound className="h-5 w-5" />, tone: 'from-indigo-500 to-blue-600', onClick: (n) => n({ name: 'customer' }) },
  { key: 'sales-activity', label: '영업활동 입력', icon: <Activity className="h-5 w-5" />, tone: 'from-indigo-500 to-violet-600', onClick: (n) => n({ name: 'sales-activity' }) },
  { key: 'performance', label: '실적 확인', icon: <BarChart3 className="h-5 w-5" />, tone: 'from-emerald-500 to-teal-600', onClick: (n) => n({ name: 'performance' }) },
  { key: 'consultation', label: '상담 준비', icon: <ClipboardList className="h-5 w-5" />, tone: 'from-cyan-500 to-sky-600', onClick: (n) => n({ name: 'consultation' }) },
  { key: 'insurance-analysis', label: '보험분석 시작', icon: <FileSearch className="h-5 w-5" />, tone: 'from-amber-500 to-orange-600', onClick: (n) => n({ name: 'insurance-analysis' }) },
  { key: 'jarvis', label: '자비스에게 요청', icon: <Bot className="h-5 w-5" />, tone: 'from-indigo-600 to-blue-700', onClick: () => jarvisService.open() }
]

const JARVIS_COMMANDS = [
  '오늘 일정 알려줘',
  '이번 달 실적 보여줘',
  '미완료 영업활동 정리해줘',
  '클로징 예정 고객 알려줘',
  '고객 상담 준비해줘',
  '보험분석 시작해줘',
  '오늘 해야 할 일 정리해줘',
  '팀 실적 요약해줘'
]

export default function StaffHomePage(): JSX.Element {
  const { navigate } = useNavigation()
  const [copied, setCopied] = useState<string | null>(null)

  // Open Jarvis and prefill its input with the command (NOT auto-executed).
  const useCommand = (command: string): void => {
    jarvisService.openWithDraft(command)
    setCopied(command)
    window.setTimeout(() => setCopied((c) => (c === command ? null : c)), 2500)
  }

  return (
    <div className="space-y-5">
      {/* Quick Action launcher */}
      <Card title="빠른 실행" icon={<Sparkles className="h-4 w-4 text-indigo-600" />}>
        <p className="mb-3 text-xs text-slate-500">자주 쓰는 업무를 빠르게 실행하세요.</p>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => a.onClick(navigate)}
              className="group flex flex-col items-center gap-2 rounded-xl border border-slate-800 bg-white px-3 py-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-400 hover:shadow-md"
            >
              <span className={['flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm', a.tone].join(' ')}>
                {a.icon}
              </span>
              <span className="text-sm font-semibold text-slate-200">{a.label}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* Jarvis recommended commands */}
      <Card title="자비스 추천 명령" icon={<Bot className="h-4 w-4 text-indigo-600" />} action={<span className="text-xs text-slate-500">클릭하면 자비스 입력창에 넣기</span>}>
        <p className="mb-3 text-xs text-slate-500">자비스에게 자연어로 요청할 수 있습니다. 예: 오늘 일정 알려줘 / 이번 달 실적 보여줘</p>
        <div className="flex flex-wrap gap-2">
          {JARVIS_COMMANDS.map((cmd) => (
            <button
              key={cmd}
              type="button"
              onClick={() => useCommand(cmd)}
              title="자비스 입력창에 넣기"
              className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
            >
              {copied === cmd ? <Check className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
              {cmd}
            </button>
          ))}
        </div>
        {copied ? (
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
            <Check className="h-3.5 w-3.5" />
            명령이 자비스에 준비되었습니다. Enter로 실행하세요.
          </div>
        ) : null}
      </Card>
    </div>
  )
}
