import { ArrowLeft, User, Brain, MessageSquare } from 'lucide-react'
import { useCompanyState } from '@renderer/data/useCompanyState'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { WorkerTab } from '@renderer/navigation/types'
import Avatar from '@renderer/components/ui/Avatar'
import StatusBadge from '@renderer/components/ui/StatusBadge'
import WorkerProfile from '@renderer/components/worker/WorkerProfile'
import WorkerMemory from '@renderer/components/worker/WorkerMemory'
import WorkerChat from '@renderer/components/worker/WorkerChat'

interface WorkerDetailPageProps {
  workerId: string
  tab: WorkerTab
}

const TABS: { key: WorkerTab; label: string; icon: typeof User }[] = [
  { key: 'profile', label: '프로필', icon: User },
  { key: 'memory', label: '메모리', icon: Brain },
  { key: 'chat', label: '채팅', icon: MessageSquare }
]

export default function WorkerDetailPage({
  workerId,
  tab
}: WorkerDetailPageProps): JSX.Element {
  const { workers } = useCompanyState()
  const { navigate } = useNavigation()
  const worker = workers.find((w) => w.id === workerId)

  if (!worker) {
    return (
      <div className="text-sm text-slate-400">
        워커를 찾을 수 없습니다.{' '}
        <button
          type="button"
          onClick={() => navigate({ name: 'workers' })}
          className="text-indigo-400 hover:underline"
        >
          워커 목록으로
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => navigate({ name: 'workers' })}
        className="flex items-center gap-1 text-xs text-slate-500 transition hover:text-slate-300"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> 전체 워커
      </button>

      <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <Avatar role={worker.role} label={worker.avatar} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold text-slate-100">
            {worker.name}
          </div>
          <div className="truncate text-sm text-slate-500">{worker.title}</div>
        </div>
        <StatusBadge status={worker.status} />
      </div>

      <div className="flex gap-1 border-b border-slate-800">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => navigate({ name: 'worker', workerId, tab: key })}
            className={[
              '-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm transition',
              tab === key
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            ].join(' ')}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && <WorkerProfile worker={worker} />}
      {tab === 'memory' && <WorkerMemory worker={worker} />}
      {tab === 'chat' && <WorkerChat worker={worker} />}
    </div>
  )
}
