import { ChevronRight } from 'lucide-react'
import { useCompanyState } from '@renderer/data/useCompanyState'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import Avatar from '@renderer/components/ui/Avatar'
import StatusBadge from '@renderer/components/ui/StatusBadge'

export default function WorkersPage(): JSX.Element {
  const { workers } = useCompanyState()
  const { navigate } = useNavigation()

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        AI 엔지니어링 팀 — 직원 {workers.length}명. 직원을 선택하면 프로필, 메모리,
        채팅을 볼 수 있습니다.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {workers.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => navigate({ name: 'worker', workerId: w.id, tab: 'profile' })}
            className="group flex flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-left transition hover:border-slate-700 hover:bg-slate-900/70"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar role={w.role} label={w.avatar} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-100">
                    {w.name}
                  </div>
                  <div className="truncate text-xs text-slate-500">{w.title}</div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-600 transition group-hover:text-slate-300" />
            </div>

            <div className="mt-4 flex items-center justify-between">
              <StatusBadge status={w.status} />
              <span className="text-xs text-slate-600">업데이트 {w.lastActivity}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
