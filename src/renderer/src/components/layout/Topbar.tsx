import { Bell, Crown, Sparkles } from 'lucide-react'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { View } from '@renderer/navigation/types'
import { approvals, getWorkerById } from '@renderer/data/mockManagement'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'

function titleFor(route: View): { title: string; subtitle: string } {
  switch (route.name) {
    case 'assistant':
      return { title: '경영 비서', subtitle: '한 번의 지시로 회사가 알아서 실행합니다.' }
    case 'dashboard':
      return { title: 'CEO 대시보드', subtitle: '지시 하나면, 회사 전체가 실행합니다.' }
    case 'workers':
      return { title: 'AI 워커', subtitle: 'AI 엔지니어링 팀입니다.' }
    case 'worker': {
      const worker = getWorkerById(route.workerId)
      return { title: worker?.name ?? '워커', subtitle: worker?.title ?? '워커 상세' }
    }
    case 'projects':
      return { title: '프로젝트 매니저', subtitle: '프로젝트, 작업, 그리고 이를 만드는 팀.' }
    case 'approvals':
      return { title: '승인 센터', subtitle: 'CEO의 결정을 기다리는 항목.' }
    case 'activity':
      return { title: '회사 활동 로그', subtitle: '회사가 수행한 모든 활동.' }
    case 'settings':
      return { title: '회사 설정', subtitle: '프로바이더, 정책, 자율성 설정.' }
    default:
      return { title: 'SJ AI 컴퍼니', subtitle: '' }
  }
}

export default function Topbar(): JSX.Element {
  const { route, navigate } = useNavigation()
  const { title, subtitle } = titleFor(route)
  const pending = approvals.filter((a) => a.status === 'pending').length

  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-white/80 px-6 py-4 shadow-sm backdrop-blur">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">{title}</h1>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => {
            jarvisService.open()
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-3.5 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:shadow-lg hover:shadow-indigo-500/40"
          aria-label="자비스 열기"
        >
          <Sparkles className="h-4 w-4 text-[#fcd34d]" />
          자비스
        </button>

        <button
          type="button"
          onClick={() => navigate({ name: 'approvals' })}
          className="relative rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          aria-label="승인 센터"
        >
          <Bell className="h-5 w-5" />
          {pending > 0 && (
            <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-semibold text-white">
              {pending}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2 rounded-lg bg-slate-800/70 px-3 py-1.5">
          <Crown className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-medium text-slate-200">CEO</span>
        </div>
      </div>
    </header>
  )
}
