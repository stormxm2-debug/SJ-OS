import type { ReactNode } from 'react'
import { CalendarDays, ClipboardList, BarChart3, UserRound, FileSearch, UserPlus, Sparkles } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { useSession } from '@renderer/navigation/SessionContext'
import { canAccessRoute } from '@renderer/navigation/roleAccess'
import type { View } from '@renderer/navigation/types'

/**
 * 빠른 실행 — 홈에 늘 떠 있던 런처를 메뉴에서 눌러 여는 화면으로 옮겼다
 * (대표 지시). 역할상 못 여는 화면(예: 총무의 일정)은 버튼에서 뺀다.
 */

interface QuickAction {
  key: string
  label: string
  icon: ReactNode
  view: View
  tone: string
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    key: 'schedule',
    label: '오늘 일정 보기',
    icon: <CalendarDays className="h-5 w-5" />,
    tone: 'from-sky-500 to-blue-600',
    view: { name: 'schedule' }
  },
  {
    key: 'customer-new',
    label: '고객 등록',
    icon: <UserPlus className="h-5 w-5" />,
    tone: 'from-blue-500 to-indigo-600',
    view: { name: 'customer' }
  },
  {
    key: 'customer',
    label: '고객 관리',
    icon: <UserRound className="h-5 w-5" />,
    tone: 'from-indigo-500 to-blue-600',
    view: { name: 'customer' }
  },
  {
    key: 'performance',
    label: '실적 확인',
    icon: <BarChart3 className="h-5 w-5" />,
    tone: 'from-emerald-500 to-teal-600',
    view: { name: 'performance' }
  },
  {
    key: 'consultation',
    label: '상담 준비',
    icon: <ClipboardList className="h-5 w-5" />,
    tone: 'from-cyan-500 to-sky-600',
    view: { name: 'consultation' }
  },
  {
    key: 'insurance-analysis',
    label: '보험분석 시작',
    icon: <FileSearch className="h-5 w-5" />,
    tone: 'from-amber-500 to-orange-600',
    view: { name: 'insurance-analysis' }
  }
]

export default function QuickActionsPage(): JSX.Element {
  const { navigate } = useNavigation()
  const { session } = useSession()
  const actions = QUICK_ACTIONS.filter((a) => canAccessRoute(session.role, a.view.name))
  return (
    <Card title="빠른 실행" icon={<Sparkles className="h-4 w-4 text-indigo-600" />}>
      <p className="mb-3 text-xs text-slate-500">자주 쓰는 업무를 빠르게 실행하세요.</p>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => navigate(a.view)}
            className="group flex flex-col items-center gap-2 rounded-xl border border-slate-800 bg-white px-3 py-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-400 hover:shadow-md"
          >
            <span className={['flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm', a.tone].join(' ')}>{a.icon}</span>
            <span className="text-sm font-semibold text-slate-200">{a.label}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}
